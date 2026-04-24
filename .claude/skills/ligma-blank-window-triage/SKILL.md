---
name: ligma-blank-window-triage
description: Diagnose a blank/white Electron window after `pnpm dev` in ligma. Use when the desktop app shows a fully blank (not "Loading…") window, the Vite renderer port is not listening, multiple `pnpm dev` sessions have been started/killed across the day, or when the Electron main logs stop at `claude-cli.prewarm` with no subsequent renderer activity. Trigger words — "blank screen", "white window", "ligma dev blank", "Electron blank", "single instance lock", "renderer port dead", "5173 in use, trying another one".
allowed-tools: Bash, Grep, Read
---

# Ligma blank-window triage

## Symptom signature

You run `pnpm dev`; an Electron window appears and is **fully white** (not the "Loading…" fallback from `App.tsx:223`). The main-process log stops cleanly at `[info] (main:boot) claude-cli.prewarm` with no error, no `did-finish-load`, and no renderer logs. `curl http://localhost:5173/` and `curl http://localhost:5174/` both fail with connection-refused.

## Root cause (not-obvious)

`apps/desktop/src/main/index.ts` calls `app.requestSingleInstanceLock()` and `app.quit()`s the new process if another ligma Electron already holds the lock (see comment at `:1261` — the lock exists to prevent SQLite WAL collisions). When a **stale ligma Electron from an earlier session is still running**, the Electron spawned by your new `pnpm dev` hits the lock, quits silently with no error dialog, and takes its Vite renderer dev server down with it. The *old* Electron you're looking at is `loadURL`'d against a Vite dev server that died hours ago → permanent blank white page.

This is invisible because:
- The new Electron's `app.quit()` path emits nothing user-visible.
- `electron-vite` tears down its dev server when its child Electron exits.
- The *old* Electron has no way to know its renderer URL is dead — it just sits on the last (failed) load.

## Diagnostic procedure

```bash
# 1) Is there a ligma Electron main whose start time predates your pnpm dev?
ps -ef | grep -E "Electron\.app/Contents/MacOS/Electron" | grep -v grep
#    PID   PPID   STIME   (old STIME = stale session)

# 2) Is the renderer Vite port actually listening?
lsof -nP -iTCP -sTCP:LISTEN | awk '$9 ~ /:(517[0-9]|5180)$/'
#    Expect: the dev server your current `pnpm dev` log said it bound to.
#    Nothing listening → confirms the new Electron already exited.

# 3) Is turbo's docs workspace holding 5173?
pgrep -lf "vitepress.*dev"
#    `pnpm dev` fans out to `ligma/website` (VitePress). A zombie from a
#    prior session will keep 5173 busy and push the renderer Vite to 5174.
```

If the Electron PID's STIME predates your `pnpm dev` invocation, the single-instance-lock trap is your root cause.

## Fix

```bash
# Kill the stale Electron main first — its helpers will be adopted/killed.
# SIGTERM is often ignored by Electron; use SIGKILL.
kill -9 <stale_electron_main_pid>

# Reap any stubborn helpers (GPU / utility / renderer).
pgrep -lf "Electron.*ligma" | awk '{print $1}' | xargs -r kill -9

# Also kill any stale `turbo run dev` + `vitepress dev` chain.
pgrep -lf "turbo run dev|vitepress.*dev" | awk '{print $1}' | xargs -r kill -9

# Verify clean.
pgrep -lf "Electron.app.*ligma|@ligma/desktop"           # should be empty
lsof -nP -iTCP -sTCP:LISTEN | awk '$9 ~ /:517[0-9]$/'   # should be empty

# Fresh start.
pnpm dev
```

## Why not less-destructive alternatives?

- **Cmd+Q the visible Electron window**: doesn't work — the stale window isn't responding to input cleanly in this state; and even if it did, the orphan `turbo run dev`/`vitepress` chain from an earlier session stays alive.
- **Kill by port only** (`lsof -ti:5173 | xargs kill`): only reaps VitePress; leaves the real culprit (stale Electron holding the instance lock) running.
- **Restart `pnpm dev` repeatedly**: each attempt silently exits on the lock; you'll keep staring at the same dead window.

## Guardrails

- Only kill processes whose path contains `ligma/node_modules/.pnpm/electron@` or `ligma/website/...vitepress` — do **not** mass-kill by name `Electron` (Slack, Cursor, Discord, VSCode, etc. all ship their own Electron builds).
- On macOS, newly-forked Electron helpers can re-spawn with **very low PIDs** (e.g. 232, 606) after a main was killed; this is PID reuse, not a new app. Expect to need a second sweep.

## Related files

- `apps/desktop/src/main/index.ts:1261-1268` — the `requestSingleInstanceLock` / `app.quit()` branch.
- `apps/desktop/src/main/index.ts:209-213` — renderer URL load (`ELECTRON_RENDERER_URL` or bundled file).
- `apps/desktop/src/renderer/src/main.tsx:16-27` — `bootstrap()` awaits `window.codesign.locale.getCurrent()` before `root.render()`; if that IPC never resolves you get a blank window too, but in *that* case the Electron main logs continue normally past `claude-cli.prewarm` and `did-finish-load` fires. The stale-lock signature is distinguished by the main logs *stopping* right after `claude-cli.prewarm`.
