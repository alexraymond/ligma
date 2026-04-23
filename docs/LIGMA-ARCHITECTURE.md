# Ligma Architecture Overview

One-page tour of the moving parts that matter. This is a map, not a manual — each section points at the source file(s) that own the details.

## Shape at a glance

```
  renderer (React)              main process (Electron)              child (claude CLI)
  ┌──────────────┐    IPC-ACK    ┌──────────────────┐   stdio / SDK    ┌────────────┐
  │  chat UI     │ ◄──────────► │  agent loop      │ ◄──────────────► │  @anthropic│
  │  preview     │               │  tool registry   │                  │  claude-   │
  │  settings    │               │  session log     │                  │  agent-sdk │
  └──────────────┘               │  fs-ack tracker  │                  └────────────┘
                                 └──────────────────┘
                                         │
                                         ▼
                               ~/.config/ligma/* (TOML + SQLite + JSONL)
```

Everything runs locally. The claude CLI child holds the user's Claude Max subscription session; Ligma never sees the auth token.

## Async-generator agent loop

`packages/core/src/agent/loop.ts` exports `runTurn(opts): AsyncGenerator<AgentEvent, TurnDone>`. One turn corresponds to one model round-trip plus any tool batches the model asks for. The loop:

- Consumes a `ProviderTurn` — an `AsyncIterable<ProviderStreamItem>` produced by the provider adapter (`packages/providers/src/claude-cli/sdk-to-agent-events.ts`).
- Yields typed `AgentEvent`s as the provider streams (`text_chunk`, `thinking_chunk`, `permission_request`, `tool_start`, `tool_end`) and finishes with `turn_done`.
- Drives tool execution through `batchAndRun(..)` whenever the provider surfaces a `tool_call_batch` item, feeding results back via `provider.provideToolResults()`.
- Honours an `AbortSignal` on every iteration: a cancelled run emits `turn_done` with `stopReason: 'aborted'` the moment abort is observed.
- Caps tool batches per turn at `maxToolBatches` (default 32) so a runaway model cannot lock a turn open forever.

`TurnDone` is both yielded (so streaming consumers don't need a separate return-value handler) and returned (so callers that `await generator.next().value` get it without double-iterating).

## AgentEvent schema

`packages/core/src/agent/events.ts` defines a discriminated union `AgentEvent = TextChunk | ThinkingChunk | ToolStart | ToolEnd | PermissionRequest | TurnDone`. Each event:

- Carries only the fields its consumer needs. UI, session log, and hooks subscribe independently without cross-leaking concerns.
- Is serialisable — `ToolEnd.error` is a string, never an `Error` instance, because events cross an IPC boundary to the renderer.
- Declares `schemaVersion: AGENT_EVENT_SCHEMA_VERSION` (currently `1`) so we can evolve the payload without breaking older renderers held hot in memory during an update.
- Correlates `tool_start` / `tool_end` via a provider-issued `toolUseId` plus a turn-local monotonic `seq` so the UI can order interleaved tool output.

## Concurrency-safe tool orchestration

`packages/core/src/agent/tools/orchestration.ts` owns `batchAndRun(toolCalls, registry, options)`:

1. Walks the tool-call list and partitions into contiguous batches that share a concurrency-safe flag. A tool declares the flag via `Tool.isConcurrencySafe(input)`.
2. Read-only batches run with a bounded worker pool capped at `LIGMA_MAX_TOOL_USE_CONCURRENCY` (default 10, overridable per-call).
3. Mutating batches serialise — one call at a time.
4. A failing tool in a read-only batch does not poison siblings; the failure surfaces per-call as `{ ok: false, error }`.
5. The caller's `AbortSignal` propagates into every in-flight tool via `ctx.signal`. Post-abort batches are skipped and reported as `{ ok: false, error: 'aborted' }` so the loop can emit clean `ToolEnd` events without losing the correlation id.

Result ordering matches input order (not execution order). Real-time visibility comes from the `onStart` / `onEnd` callbacks that the loop uses to emit `tool_start` / `tool_end` as they happen.

## IPC-ACK protocol + fs-ack tracker

`packages/shared/src/ipc-ack.ts` defines the typed contract:

- `FsUpdatedV1 { schemaVersion: 1, seq: number }` — main fires this to the renderer whenever the agent's virtual FS mutates.
- `FsUpdatedAckV1 { schemaVersion: 1, seq: number }` — renderer responds with the matching `seq`.

`apps/desktop/src/main/fs-ack.ts` runs the coordinator. `createFsAckTracker({ logger, timeoutMs, generationId })` hands back an object with `nextSeq()`, `wait(seq)`, `ack(seq)`, and `abort()`. The tracker:

- Allocates monotonic `seq` values per agent run.
- Resolves `wait(seq)` when the renderer acks within the bounded timeout.
- On timeout, emits `claude-cli.fs_ack.timeout` via `CoreLogger.warn` and resolves (never rejects) — the caller treats timeouts as telemetry, not a failure path. No silent fallback: the log is loud enough to find in the next debug session.
- `abort()` releases every pending waiter so an aborted generation cannot leak pending promises.

## Session log — append-only JSONL

`packages/session/` (see `packages/session/src/{schema,writer,reader,resume,paths,index}.ts`) stores the transcript:

```
~/.config/ligma/sessions/<session-id>/
  transcript.jsonl   # append-only, one JSON object per line
  files/             # content-addressed blobs referenced by FileHistorySnapshot entries
```

Key properties:

- Every entry carries `schemaVersion: 1`. Future changes add new entry types rather than mutating existing ones.
- `writer` performs atomic appends with `fsync` on turn boundaries. Partial-write recovery drops a truncated last line with a warning rather than corrupting the stream.
- `reader` exposes cursor pagination: `fetchLatest(limit)` and `fetchOlder(beforeId, limit)` — the transcript scales without loading the whole file into memory.
- `resume` replays entries in order and applies last-wins rules for file snapshots so session resume is deterministic.
- IPC surface lives in `apps/desktop/src/main/session-ipc.ts` and follows the same `registerOnboardingIpc` pattern used everywhere else in main.

## Stream validation + heartbeat

`packages/providers/src/claude-cli/sdk-runtime.ts` wraps the SDK's async iterator with two guardrails:

- A 5-second heartbeat timer logs `claude-cli.stream.heartbeat` when no event has arrived within the interval, so a stuck child is visible in logs rather than hanging invisibly.
- After the loop drains, a post-assertion requires at least one `assistant` event carrying text. If the pipe closed early (network blip, SDK subprocess crash, proxy 502), the runtime throws `CodesignError(PROVIDER_STREAM_TRUNCATED)` rather than silently returning a partial string.

`prewarmClaudeExecutable()` resolves `which claude` exactly once at boot and memoises the result. Per-request resolution is banned — `completeViaClaudeCli` takes the resolved path as a parameter.

Each architectural pattern above is chosen because it cleanly separates concerns that otherwise tangle: UI, session log, and permission gating subscribe to the same event stream without stepping on each other; read-only tools fan out without stalling behind a single slow write; the loop stays a generator so abort, error, and completion are all the same kind of control-flow event.
