---
name: vite-stale-dep-cache-after-lockfile-change
description: Diagnose and fix Vite's `Failed to resolve import "@scope/pkg/subpath.css"` error when the package and file genuinely exist on disk, typically right after adding a new dependency (e.g. a fontsource CSS subpath, a Radix subcomponent, any CSS side-effect import). Vite's `Re-optimizing dependencies because lockfile has changed` message fires but the new subpath exports don't land in the pre-bundle, and reloading the page just re-shows the overlay. Trigger words — "Failed to resolve import", "Does the file exist", "plugin:vite:import-analysis", "fontsource CSS subpath", "vite dep cache", "stale optimizeDeps", ".vite cache", "added a dep and Vite broke", "lockfile has changed but still broken".
allowed-tools: Read, Bash, Edit
---

# Vite's dep cache goes stale on new subpath imports

## The bug

You add a dependency that ships CSS subpath exports:

```ts
import '@fontsource/kalam/300.css';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';
```

Vite's HMR shows a red overlay:

```
[plugin:vite:import-analysis] Failed to resolve import "@fontsource/kalam/300.css"
from "../../packages/ui/src/fonts.ts". Does the file exist?
```

But the file **does** exist:

```sh
$ ls node_modules/@fontsource/kalam/300.css
-rw-r--r-- 1 you staff 1281 … 300.css
```

The lockfile changed, the package's `exports` field correctly maps `./*.css`, the file is physically present, and Node/TS would resolve it fine. Vite still refuses.

## Why

Vite pre-bundles deps on first startup into `node_modules/.vite/`. When the lockfile changes mid-session, Vite logs `Re-optimizing dependencies because lockfile has changed` and *starts* a re-bundle — but the re-bundle only touches deps referenced in files Vite has already scanned. CSS *subpath* imports (`@scope/pkg/variant.css`) aren't always picked up by the optimizer's entry scan, especially when the importing file lives inside a workspace package that was already pre-bundled once. The cache then reports "resolved: no" for the new subpath even though the package is in place.

Related trigger: importing a new CSS-only side-effect from a path the optimizer didn't list in `optimizeDeps.include` gives the same symptom.

## The fix

1. **Stop the dev process.** HMR alone cannot rebuild its own cache.

   ```sh
   pkill -f "electron-vite dev"      # or whatever your Vite runner is
   pkill -f "Electron.app/Contents/MacOS/Electron "   # clean Electron child
   ```

2. **Nuke the Vite dep cache.**

   ```sh
   rm -rf apps/<your-app>/node_modules/.vite
   ```

   (For pure `vite` projects, the cache is at the project root's `node_modules/.vite`.)

3. **Restart.** Vite re-runs optimizeDeps from scratch and the subpath resolves.

   ```sh
   pnpm dev
   ```

If the error recurs after a second lockfile change, same three steps again — don't waste time on `--force`, `optimizeDeps.include`, or `exports`-field edits first.

## When to suspect this

- The lockfile just changed (via `pnpm add` / `pnpm install` for a fresh dep).
- The error message form is exactly `Failed to resolve import "X"` / `Does the file exist?`.
- `ls node_modules/<path>` confirms the file is there.
- The package's `package.json` `exports` field correctly maps the subpath (verify with `cat node_modules/<pkg>/package.json`).
- HMR alone (saving the importing file again) does NOT clear the overlay.

If the file is *genuinely missing*, the imports are mis-typed, or the `exports` field doesn't match the path — those are real resolution bugs, not this one.

## When to skip this fix

- Monorepo linking issue: the new dep lives in a workspace package's `node_modules` but Vite's roots don't cover it. Check `pnpm list @scope/pkg` from the *importing* package — if missing, add the dep to that package's `package.json`, not just the consumer.
- Missing `exports` field: the package is pre-`exports` and Node's classic resolution is failing. Install a different package or pin to a newer version.

## Concrete example (this repo)

Added `@fontsource/kalam` to `packages/ui/package.json`, imported `300.css`/`400.css`/`700.css` in `packages/ui/src/fonts.ts`. Vite overlay: `Failed to resolve import "@fontsource/kalam/300.css"`. Files were on disk under `packages/ui/node_modules/@fontsource/kalam/300.css`. Fix:

```sh
pkill -f "electron-vite dev"
pkill -f "Electron.app/Contents/MacOS/Electron "
rm -rf apps/desktop/node_modules/.vite
pnpm dev
```

Came back clean. No source changes required.

## Prevention (if it bites you repeatedly)

- Add the new dep path to `optimizeDeps.include` in `vite.config.ts` *before* restarting — Vite then scans it on the next startup.
- For fontsource packages specifically: prefer `import '@fontsource/<family>'` (the index default) when a single weight is acceptable — it's more bundler-universal than subpath `*.css` imports.
- After any `pnpm add` involving CSS side-effects in a long-running dev session, make killing + cache-wipe the default move, not HMR reload.
