# Changelog

All notable changes to Ligma are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **`apps/desktop`** — the legacy 0.1.0 Electron desktop app is no longer in
  this repo. It was unwired from the daemon and shared nothing with the
  factory; its heritage lives on in the separate `ligma-classic` repo, and
  `docs/ligma-classic/LIGMA-ARCHITECTURE.md` is kept here as its frozen
  architecture record.
- The four workspace packages only the desktop app consumed, removed with it:
  `@ligma/i18n`, `@ligma/session`, `@ligma/templates`, `@ligma/ui`. No daemon,
  web, or CLI code imported any of them. The nine remaining packages (`api`,
  `artifacts`, `core`, `deez`, `exporters`, `nuts`, `providers`, `runtime`,
  `shared`) are unchanged.
- Desktop-only repo wiring: the `apps/desktop` workspace entry, the
  `dist-electron`/`release/` build-output paths in `.gitignore`, `turbo.json`,
  and `tsconfig.base.json`, the `apps/desktop/src/main/**` Biome override, and
  the now-unused `better-sqlite3` `neverBuiltDependencies` pin. Electron and
  its build toolchain drop out of the lockfile, cutting install cost.

## 0.2.0 — The factory era

The product pivoted from a prompt-to-design desktop app (0.1.0, below) to a
local-first, daemon-driven "app factory": a monorepo merge of three
codebases — the original ligma desktop app, `mission-control`'s daemon/engine
(dispatcher, quota governor, acceptance harness), and vendored content from
`open-design` (craft rules, design systems, skills, templates). The 0.1.0
desktop app rode along in the tree for this release (`apps/desktop`, legacy,
unwired to the rest) but was no longer the product, and has since been removed
(see [Unreleased] above); see [`docs/architecture.md`](./docs/architecture.md)
for what the product is.

### Added

- **`apps/daemon`** — the new product core: an HTTP+SSE API, a dispatcher
  loop that spawns builder agents (Claude Code / Codex / Gemini CLIs),
  a quota governor, and an acceptance harness that verifies a build with an
  independent persona panel plus a different-model judge before marking
  anything done (Ed25519-signed verdicts). See `docs/architecture.md` §3.
- **`apps/web`** rebuilt as the daemon's cockpit — composer-first home, Deck
  (decision queue), Runs, Verify, and a full-screen Studio for design
  generation/critique/export.
- **`apps/cli`** (`ligma`) — a small HTTP-client CLI over the same route
  registry web uses; see `docs/configuration.md` §5.
- An MCP server (`apps/daemon/src/mcp-server.ts`) so external coding agents
  can drive ligma directly over stdio.
- Vendored content libraries: `craft/` (anti-slop rules), `design-systems/`
  (152 packages), `skills/`, `design-templates/` — each with its own
  consumption story documented in its README/AGENTS.md.
- Project lifecycle: discovery → brief → optional design stage → promote →
  contract-compiled build → verify, with design treated as a frozen oracle
  once approved (`docs/architecture.md` §4).

### Changed

- Data root moved out of the checkout by default (`~/.ligma/data`); this
  repo's own dev scripts pin it back to `<repo>/data` for dogfooding (see
  README "Where data lives").
- Route surface consolidated behind `packages/api`'s typed registry, shared
  by daemon, web, and cli.

See [`docs/evidence/`](./docs/evidence/) for the acceptance campaign that
closed this rebuild (`DONE.md`, `DONE-UX.md`) and
[`docs/audits/`](./docs/audits/) for the most recent whole-repo review.

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
