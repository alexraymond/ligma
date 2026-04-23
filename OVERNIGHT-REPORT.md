# Ligma Overnight Report

_Generated: 2026-04-23, ~4h runtime end-to-end (plan → swarm → merges → final gates)._

All six workstreams merged to `overnight`. `main` untouched. No remote pushes. Every commit conventional-format, zero AI co-author trailers.

## Summary

| WS | Story | Teammate commits | Reviews | Merged | Post-merge gates |
|----|-------|---|---|---|---|
| W1 | Reliability Foundation | 3 | architect PASS, QA PASS (5 suggestions) | ✓ `5f5b2f3` | ✓ |
| W2 | Agent Loop + Typed Events | 7 | architect PASS, QA PASS (6 suggestions) | ✓ `5e0cbe4` | ✓ |
| W3 | Ligma Rebrand | 5 + 1 remediation | architect APPROVE-WITH-BLOCKER → PASS, QA APPROVE | ✓ `0503e37` (with conflict resolution) | ✓ |
| W4 | Session Log + Versioning | 4 + 3 remediation | architect APPROVE-WITH-CHANGES, QA REQUEST-CHANGES → PASS | ✓ `e973344` (with conflict resolution) | ✓ |
| W6 | Docs + NOTICE + Architecture | 6 | (waived round 1; diff is additive) | ✓ `be7a5df` (clean ff) | ✓ |
| W7 | UI Reskin | 5 + 3 remediation | architect PASS, QA BLOCKED → PASS round 2 | ✓ `d778c28` (with conflict resolution) | ✓ |

**Final gates on `overnight`:** `pnpm typecheck` 11/11, `pnpm lint` 408 files 0 errors, `pnpm test` 11/11 (898+ tests).
**Grep audit (`rg -i 'open.codesign|opencoworkai'`):** `LICENSE` (legally required) + one meta-reference inside `TODO-MORNING.md` (the audit command itself). No product-code or user-visible brand hits.

## Integration branch

```
$ git log --oneline overnight ^main
9e9b419 chore: untrack tasks/ swarm scratch directory
9cd90ac docs: add session-log section to 0.1.0 CHANGELOG
be7a5df Merge branch 'ligma/overnight/w6' into overnight
e973344 Merge branch 'ligma/overnight/w4' into overnight
d778c28 Merge branch 'ligma/overnight/w7' into overnight
0503e37 Merge branch 'ligma/overnight/w3' into overnight
5f5b2f3 Merge branch 'ligma/overnight/w1' into overnight
5e0cbe4 Merge branch 'ligma/overnight/w2' into overnight
```

(Plus each workstream's own commits inside their merge bubbles — see `git log --oneline --graph overnight ^main`.)

## What shipped

### W1 — Reliability Foundation (`packages/providers/src/claude-cli/`, `apps/desktop/src/main/`, `packages/shared/`)
- Pre-warm `claude` CLI path once at boot (first-request latency drops sub-200ms).
- Typed `FsUpdatedV1` / `FsUpdatedAckV1` IPC contract (`packages/shared/src/ipc-ack.ts`). Main awaits ACK with 2000ms bounded timeout; `CoreLogger.warn` on miss — **no silent fallback**.
- Stream truncation detection: new `PROVIDER_STREAM_TRUNCATED` error code; thrown when stream yields zero assistant events OR empty `textChunks`.
- 5s heartbeat warns on SDK iterator stalls.
- `fsMap.view()` warns on unknown paths with path + known-paths list.
- `allowedTools` now a parameter on `completeViaClaudeCli` — hand-off seam for W2.

### W2 — Agent Loop + Typed Events (`packages/core/src/agent/`)
- Async generator `runTurn()` yielding discriminated `AgentEvent` union (`TextChunk | ThinkingChunk | ToolStart | ToolEnd | PermissionRequest | TurnDone`), every event carrying `schemaVersion: 1`.
- Concurrency-safe tool orchestration (`batchAndRun`): read-only batches with Promise.all capped at 10 (`LIGMA_MAX_TOOL_USE_CONCURRENCY`), mutating serialises, one failure doesn't poison siblings, AbortSignal propagates.
- SDK→AgentEvent adapter in `packages/providers/src/claude-cli/sdk-to-agent-events.ts`.
- `agent.ts` re-exports new API via `export * as AgentLoop` — zero caller regressions.
- `useNewLoop?: boolean` seam declared for the UI opt-in button (dispatcher wiring is a morning task — see below).

### W3 — Ligma Rebrand
- `com.ligma.app` appId, productName `Ligma`, `~/.config/ligma/` paths.
- Every workspace renamed to `@ligma/*`; `pnpm-lock.yaml` regenerated.
- Chinese-translation content deleted (README.zh-CN.md, website/zh/*).
- LICENSE byte-identical (`sha1: fb62c684f3950c740e79d7da7ae4cbd849e5c5c9`).

### W4 — Session Log + File Versioning (`packages/session/`)
- New `@ligma/session` package: append-only JSONL transcript + content-addressed SHA-256 blob store under `~/.config/ligma/sessions/<id>/`.
- Sibling entry types (`transcript | file_history_snapshot | custom_title | tool_use_summary | turn_done`) with `schemaVersion: 1`.
- Cursor pagination (`fetchLatest`, `fetchOlder`), forward-replay resume with truncated-tail and mid-stream-corruption recovery.
- `fsync` only on turn-boundary entries; test seam via optional `onFsync` hook.
- IPC handlers: `session:list`, `session:open`, `session:append`, `session:fetchOlder`.

### W7 — UI Reskin
- Dark theme default in `packages/ui/src/tokens.css` (muted teal `#2EB5A8` placeholder accent — **TODO-MORNING**).
- Two-circle placeholder icon at `apps/desktop/resources/icons/ligma.svg` + PNG renditions 16..1024.
- Window chrome inside `// region:window-chrome` anchors: title "Ligma", About dialog, app menu.
- Tightened header + preview-pane spacing.
- Extracted `window-chrome.ts` helper for behavioral testing; mocked `electron-runtime` in tests.
- Self-hosted Inter Variable (via `@fontsource-variable/inter` in `@ligma/ui`).

### W6 — Docs + NOTICE + Architecture
- `NOTICE.md` — third-party OSS notices (runtime + fonts + build tooling).
- `docs/LIGMA-ARCHITECTURE.md` (~115 lines) — agent loop, event schema, IPC-ACK, session log, tool orchestration, workstream map, "Why these choices?" with Claude Code source references.
- `docs/RELIABILITY-AUDIT-2026-04.md` — five root-cause reports driving W1.
- `README.md` polished; `CHANGELOG.md` enriched per-workstream.

## Morning TODO (prioritised)

See `TODO-MORNING.md` for the full accumulated notes from W3 and W6. Highlights:

1. **Create the GitHub repo** for Ligma and replace every `TODO-MORNING/ligma` placeholder in `package.json` URLs, packaging manifests (homebrew, scoop, flatpak, winget), and `.github/`. `git remote add origin` + `git push -u origin main` from the fresh repo.
2. **Replace placeholder emails** (`conduct@todo-morning.local`, `maintainers@todo-morning.local`).
3. **Final palette decision** — replace the placeholder muted-teal `#2EB5A8` in `packages/ui/src/tokens.css` (marked with `TODO-MORNING` comments next to both `:root` and `.light` blocks). Also pick real icon artwork to replace the two-circle placeholder.
4. **Wire `useNewLoop: true` dispatch** — W2 declared the seam; the UI "Run with new loop (beta)" button needs the dispatcher to actually route through `runTurn`. Today only legacy `generate()` runs. This is the last mile for the morning golden-path demo.
5. **Merge `overnight` into `main`** once you've validated the golden path (see below). Tag `v0.1.0`.

## Golden-path smoke test (for you, in the morning)

```bash
cd ~/ligma
git checkout overnight
pnpm i
pnpm dev
```

Expected:
- Window titled **Ligma** opens (dark theme, two-circle icon in the dock).
- Type a prompt → streamed response visible.
- If the UI exposes "Run with new loop (beta)", at least one `ToolStart`/`ToolEnd` fires end-to-end (note: dispatcher wiring is item #4 above; without it, the button is a no-op).
- `~/.config/ligma/sessions/<id>/transcript.jsonl` gets appended entries.
- Grep: `rg -i 'open.codesign|opencoworkai' ~/ligma` returns hits ONLY in LICENSE and the meta-reference in TODO-MORNING.md.

## Deferred (follow-up specs)

Per the plan's "Deferred to Morning Human Review" section:

- **Claude Design / Google Stitch feature parity** — top-10 MVP features (prompt→prototype, multi-screen flow, design-system extraction, iterative editing, tokens + dark mode, PDF/PPTX, marketing assets, image-to-design, handoff bundle, component variants). Needs its own spec.
- **Permission UI** — W2 shipped the orchestration partitioner; the three-tier approve/deny/classifier UI needs design work.
- **Playwright Electron launch harness** — W7's "smoke" test is a synthetic screenshot composition, not a real Electron capture. Noted as tech debt.
- **Architect-suggested tidies** — single-source-of-truth for the accent token, `.cjs` convention for scripts, IPC channel versioning (`session:v1:*`), `registerSessionIpc` idempotence guard, Windows `fs.appendFile` atomicity instrumentation, internal `CodesignError` class rename, `codesign-*` CSS class names in website.

## Known deliberate trade-offs (not bugs)

- W4's `packages/session/package.json` dependency-declares `@open-codesign/shared` at the source commits; the post-merge rename sweep fixed it to `@ligma/shared`. This asymmetry is recorded in the commit messages for the conductor-session merge commits.
- W2 introduced `packages/core/src/agent/_stub-ipc-types.ts` as a temporary shadow of W1's IPC-ACK types (W1 hadn't merged yet when W2 worked). Post-merge, both W1's real types AND W2's stub are on `overnight`. The 2-line swap (replace stub import with real import, delete the stub file) is a clean follow-up commit — queued as a morning task.
