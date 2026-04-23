# Reliability Audit — April 2026

Snapshot of the five root-cause bugs that drove the W1 reliability workstream. Captured here as a durable record so future maintenance has a reference for why the provider + fs-ack machinery looks the way it does.

Each bug is recorded with (a) root cause + file:line at the time of the audit, (b) minimum fix, (c) thorough fix, (d) test coverage that locks the behaviour in.

The code references below point at the starting code the audit was run against — pre-W1 line numbers. W1 is the implementation that closed all five items; current line numbers in the repo will differ.

## 1. `which claude` on every request

**Root cause.** `execFileSync("which claude")` ran once per generate call at `packages/providers/src/claude-cli/sdk-runtime.ts:30-40`. That's a 50–200 ms synchronous syscall bolted onto the critical path of every prompt.

**Minimum fix.** Cache the resolved path in a module-level `let cachedClaudePath: string | null | undefined` and check before shelling out.

**Thorough fix.** Export `prewarmClaudeExecutable()` as the sole place that shells out, have main call it from a `// region:boot-init` block at startup, and change `completeViaClaudeCli` to accept the resolved path as a parameter so the hot path never resolves. Surface a typed `PROVIDER_AUTH_MISSING` error when the CLI is not on PATH.

**Tests.** Vitest with mocked `node:child_process` asserts we call `which` exactly once regardless of how many completions run. A second test asserts `completeViaClaudeCli` never shells out when `claudePath` is passed.

## 2. Claude-CLI path bypasses the agent loop (`allowedTools: []`)

**Root cause.** `sdk-runtime.ts:211` hard-coded `allowedTools: []` with the comment *"Tool-using agent flow lives in packages/core once the MCP bridge is wired up."* Every "why can't Ligma run more than one command" report traced to this line — no tool ever fired because none were allowed.

**Minimum fix.** Expose `allowedTools` as an option on `completeViaClaudeCli` with a default of `[]` to preserve the single-turn behaviour callers expected.

**Thorough fix.** Make `allowedTools` a first-class parameter, leave the default `[]` for non-agent use, and document the seam as the hand-off point for the agent loop in W2. W2 then wires real tool names in via the MCP bridge without re-touching this file.

**Tests.** Vitest confirms `allowedTools` is forwarded verbatim to the SDK `query` call, and defaults to `[]` when the caller omits it.

## 3. Fire-and-forget IPC for fs writes (no ACK)

**Root cause.** `apps/desktop/src/main/index.ts:323-334` emitted `webContents.send(...)` for every fs mutation with no acknowledgement. If the renderer was mid-reflow, slow, or simply busy with another frame, the event was silently dropped and the preview fell out of sync with the virtual FS. There was no telemetry to even detect the drop.

**Minimum fix.** Have main await a promise that resolves when the renderer echoes back an `fs_updated_ack` with the matching `seq`, with a bounded timeout on the wait.

**Thorough fix.** Define a versioned contract in `packages/shared/src/ipc-ack.ts` (`FsUpdatedV1` + `FsUpdatedAckV1`, both `schemaVersion: 1`). Ship a `createFsAckTracker()` coordinator in `apps/desktop/src/main/fs-ack.ts` that allocates monotonic `seq` values, resolves per-seq waiters, times out after `timeoutMs` with a loud `CoreLogger.warn` (no silent fallback), and releases every pending waiter on `abort()`. Main uses the tracker from the fsmap callback region (anchor `// region:fsmap-callbacks`).

**Tests.** Vitest drives the tracker without Electron: round-trip ack resolves, timeout logs + resolves, `abort()` clears pending waiters, duplicate acks are idempotent.

## 4. In-memory `fsMap` with no unknown-path warnings

**Root cause.** `apps/desktop/src/main/index.ts` (~line 296) and `packages/core/src/agent.ts:911-915` kept the virtual filesystem in an in-memory map per generation. `fs.view()` calls for an unknown path silently returned nothing — no warn, no auto-create, no clue for the user that a referenced file didn't exist yet.

**Minimum fix.** Log `CoreLogger.warn` from `fs.view()` on unknown path, including the requested path and the list of known paths so the user can see the shape of the mismatch.

**Thorough fix.** Same as minimum — unknown paths are an observability problem, not a semantic one. The warn lets users diagnose "agent referenced a file I didn't create" without digging through provider traces. Do NOT auto-create the file: that hides the error from the model, which would then proceed on stale assumptions.

**Tests.** Vitest for `fs.view()` on an unknown path asserts a single `CoreLogger.warn` call with the path + known-paths list and that the return value is unchanged.

## 5. Stream loop cannot detect truncation

**Root cause.** `sdk-runtime.ts:199-236, 248` iterated the SDK's async iterable and returned `textChunks.join('')` — with no assertion that any assistant event arrived, no heartbeat, and no check that the iterable wasn't cut short by a crashed child, a proxy 502, or a dropped network connection. The caller saw a clean success response with a partial (or empty) string.

**Minimum fix.** Before returning, assert `sawAssistantEvent === true` and `textChunks.length > 0`. Throw a typed error (`PROVIDER_STREAM_TRUNCATED`) otherwise.

**Thorough fix.** Add a 5-second heartbeat timer that warns via `CoreLogger.warn('claude-cli.stream.heartbeat', {...})` when no event has arrived within the interval — makes a hung child visible in logs. Wrap the iteration so the heartbeat is cleared in a `finally` block even on early return / throw. Add `PROVIDER_STREAM_TRUNCATED` to `ERROR_CODES` in `packages/shared/src/index.ts` so callers can branch on it (retry vs surface to user).

**Tests.** Vitest: (a) mock SDK producing zero assistant events throws `PROVIDER_STREAM_TRUNCATED`; (b) mock producing assistant events with zero text throws the same; (c) heartbeat timer fires the warn after the configured interval without events; (d) the `finally` block always clears the heartbeat — no orphaned timers after throw.

## Combined outcome

All five issues land in a single W1 merge. The observable change: first-request latency drops under 200 ms (pre-warmed path), dropped preview updates now surface as warnings rather than silent data loss, truncated responses become a typed error the UI can handle, and the `allowedTools` seam is ready for the W2 agent loop to wire tools through it.
