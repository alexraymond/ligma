# Changelog

All notable changes to Ligma are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 — Initial Ligma release

First public release. Prompt-to-design desktop app targeting Claude Max subscription by default, BYO Anthropic API key as fallback, local-first storage, MIT license.

### Reliability

- Pre-warm the `claude` CLI path once at boot instead of resolving per request (first-request latency drops under 200 ms).
- Typed IPC-ACK contract (`FsUpdatedV1` / `FsUpdatedAckV1`) for filesystem updates between main and renderer. Main awaits a matching `seq` with a bounded timeout.
- `createFsAckTracker()` coordinator logs `claude-cli.fs_ack.timeout` on missed acks — no silent fallback, every drop is observable.
- Stream-truncation detection: completions that end with no assistant text throw `PROVIDER_STREAM_TRUNCATED` rather than returning a partial string.
- 5-second heartbeat timer warns via `CoreLogger` when the SDK iterator stalls, so hung child processes surface in logs instead of blocking silently.
- `fs.view()` warns on unknown paths with the requested path and the list of known paths — makes model-vs-reality mismatches diagnosable without tracing.
- `allowedTools` is now a parameter on the Claude CLI provider, ready for the agent loop to wire tools through.

### Agent loop

- New `runTurn(..)` async generator in `packages/core/src/agent/loop.ts` yields typed `AgentEvent`s and returns a `TurnDone`. Streaming consumers and structured loggers subscribe to the same stream independently.
- Discriminated `AgentEvent` union (`text_chunk`, `thinking_chunk`, `tool_start`, `tool_end`, `permission_request`, `turn_done`). Every event carries `schemaVersion: 1`.
- Concurrency-safe tool orchestration (`batchAndRun`): read-only batches run with a bounded worker pool (default cap 10, override via `LIGMA_MAX_TOOL_USE_CONCURRENCY`); mutating batches serialise; one failing tool does not poison its siblings; abort propagates to every in-flight call.
- SDK-to-agent-events adapter (`packages/providers/src/claude-cli/sdk-to-agent-events.ts`) maps the Claude Code SDK stream onto `ProviderStreamItem` so the loop stays provider-agnostic.
- Opt-in "Run with new loop (beta)" seam exposed from `@ligma/core` so the UI can drive end-to-end runs through the new path without retiring the legacy `generate()` entrypoint yet.

### Session log

- New `@ligma/session` package: append-only JSONL transcript at `~/.config/ligma/sessions/<id>/transcript.jsonl` with sibling entry types (`transcript`, `file_history_snapshot`, `custom_title`, `tool_use_summary`, `turn_done`), each carrying `schemaVersion: 1`.
- Cursor-paginated reader (`fetchLatest`, `fetchOlder`) and forward-replay resume with truncated-last-line recovery and mid-stream corruption tolerance.
- Content-addressed file-body blobs via SHA-256 fingerprints under `sessions/<id>/files/<hex>`; identical file versions across turns dedupe to one blob.
- `fsync` on turn-boundary entries (`turn_done`, `custom_title`) only — others batch; a test seam lets the behavior be asserted without OS-level syscall instrumentation.
- Main-process IPC handlers: `session:list`, `session:open`, `session:append`, `session:fetchOlder`.

### UI reskin

- Dark theme is now the default. Light theme remains available via toggle.
- Placeholder Ligma accent color in `packages/ui/src/tokens.css`, marked with a `TODO` for the final palette decision.
- New two-circle placeholder app icon at `apps/desktop/resources/icons/ligma.svg` with PNG renditions for each OS-required size.
- Window chrome updated: title bar reads "Ligma", About dialog shows "Ligma v0.1.0" with a copyright-year pass.
- Tightened header + preview-pane spacing.
- Playwright launch-smoke test asserts the window title contains "Ligma" and saves a screenshot. Token-drift test guards against brand-color regressions.
