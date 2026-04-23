# Ligma

Local-first AI design tool. Natural-language prompts, interactive HTML prototypes, and multi-format export — running on your laptop.

## What it is

Ligma is an Electron desktop app that turns prompts into design artifacts (HTML prototypes, PDFs, PPTX decks, marketing assets). The default model path is your Claude Max subscription via the `@anthropic-ai/claude-agent-sdk` runtime — no API key required. Bring-your-own Anthropic API key is supported as a fallback for users without a subscription.

- **Local-first.** Designs, history, and codebase scans live on disk (SQLite). No mandatory cloud sync.
- **BYOK fallback.** If you prefer an Anthropic API key over the Claude CLI / Max subscription, point Ligma at it in Settings.
- **No telemetry by default.** Credentials stay in `~/.config/ligma/config.toml` (file mode 0600).
- **MIT licensed.**

## Install

> TODO: set real GitHub org URL — the repo currently lives at `github.com/TODO-MORNING/ligma` as a placeholder.

From source:

```bash
pnpm i
pnpm dev
```

Requires Node 22 LTS and pnpm 9. Full build targets and signed installers ship later; overnight builds are developer-only.

## License

MIT. See [LICENSE](./LICENSE).
