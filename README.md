# Ligma

Local-first AI design tool. Natural-language prompts, interactive HTML prototypes, and multi-format export — all running on your laptop.

Ligma is an Electron desktop app that turns prompts into design artifacts: HTML prototypes, PDFs, PPTX decks, marketing assets. Designs, history, and codebase scans live on disk (SQLite). No mandatory cloud sync, no telemetry by default.

## Install

```bash
pnpm i
pnpm dev
```

Requires Node 22 LTS and pnpm 9. Signed installers ship later in the 0.1.x line; until then, running from source is the supported path.

> The repo URL currently points at `github.com/TODO-MORNING/ligma` as a placeholder. The first public release will update `package.json` to the real GitHub org.

## Model access

Ligma supports two paths to Claude. Pick one in **Settings → Provider**.

### Claude Max subscription (default)

Ligma drives the locally-installed `claude` CLI via `@anthropic-ai/claude-agent-sdk`, which uses your existing Claude Code login (Keychain on macOS, file on Linux). No API key required — if you already run `claude` from the terminal, Ligma picks it up automatically.

One-time setup:

```bash
npm i -g @anthropic-ai/claude-code
claude   # sign in once, then quit
```

### Bring-your-own Anthropic API key (fallback)

Prefer an API key over a subscription? Set it under **Settings → Provider → API key**. Credentials are stored at `~/.config/ligma/config.toml` (file mode `0600`, plaintext, matching the Claude Code / Codex / `gh` CLI convention).

## Storage

- **Config.** `~/.config/ligma/config.toml` — provider settings, API keys, theme preference.
- **Sessions.** `~/.config/ligma/sessions/<session-id>/transcript.jsonl` — append-only log; `files/` subdirectory holds content-addressed blobs referenced by the transcript.
- **Database.** `~/.config/ligma/ligma.db` (better-sqlite3) — design history index.

On macOS, Electron's `userData` path is `~/Library/Application Support/Ligma`; the TOML config lives at the XDG path above so it's portable across platforms.

## License

MIT — see [LICENSE](./LICENSE).

Ligma bundles third-party open-source software; see [NOTICE.md](./NOTICE.md) for attribution and license information for each bundled package.

## Documentation

- [Architecture overview](./docs/LIGMA-ARCHITECTURE.md) — agent loop, event schema, session log, IPC-ACK protocol.
- [Reliability audit (April 2026)](./docs/RELIABILITY-AUDIT-2026-04.md) — the five root-cause fixes that shipped in 0.1.0.
- [Changelog](./CHANGELOG.md) — per-release change list.
- [Contributing](./CONTRIBUTING.md) — workflow, commit conventions, test requirements.
- [Code of Conduct](./CODE_OF_CONDUCT.md).
- [Security policy](./SECURITY.md).
