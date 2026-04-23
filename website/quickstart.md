---
title: Quickstart
description: Install Ligma and render your first AI-generated prototype in 90 seconds.
---

# Quickstart

Get Ligma running on macOS, Windows, or Linux in three steps.

## 1. Install

### Via package manager (recommended)

```sh
# macOS
brew install --cask alexraymond/tap/ligma

# Windows — Scoop
scoop bucket add alexraymond https://github.com/alexraymond/scoop-bucket
scoop install ligma

# Windows — winget  (pending microsoft/winget-pkgs#363055)
winget install alexraymond.Ligma
```

### Or direct download

Pick the matching installer from [GitHub Releases](https://github.com/alexraymond/ligma/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `ligma-*-arm64.dmg` |
| macOS (Intel) | `ligma-*-x64.dmg` |
| Windows (x64) | `ligma-*-x64-setup.exe` |
| Windows (ARM64) | `ligma-*-arm64-setup.exe` |
| Linux (AppImage) | `ligma-*-x64.AppImage` |
| Linux (Debian/Ubuntu) | `ligma-*-x64.deb` |
| Linux (Fedora/RHEL) | `ligma-*-x64.rpm` |

::: tip v0.1 note
v0.1 installers are unsigned. **macOS Sequoia 15+**: right-click → Open no longer bypasses Gatekeeper; run `xattr -cr "/Applications/Ligma.app"` once after installing (0.1.2 and earlier used `/Applications/ligma.app`). **Windows**: SmartScreen → More info → Run anyway. Prefer a verified build? Compile from source — see [Architecture](./architecture).
:::

## 2. Add a provider

First launch opens the Settings page. Pick one path:

- **Import from Claude Code or Codex** — one click, we read your existing config (`~/.codex/config.toml`, `~/.claude/settings.json`) and bring every provider, model, and key over.
- **Manual** — paste any API key. Provider is auto-detected from prefix (`sk-ant-…` → Anthropic, `sk-…` → OpenAI, etc.).
- **Keyless** — for IP-allowlisted proxies (enterprise gateways, local Ollama), leave the key blank.

Supported out of the box: Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, OpenRouter, SiliconFlow, local Ollama, and any OpenAI-compatible endpoint. Credentials stay in `~/.config/ligma/config.toml`, encrypted via Electron `safeStorage`. Nothing is uploaded.

## 3. Type your first prompt

Pick one of eight built-in demos from the Hub, or type your own. The first artifact renders in seconds inside a sandboxed iframe — HTML or a live React component, depending on what the prompt calls for.

## What to try next

- **Inline comment** — click any element in the preview, leave a note. The model rewrites only that region.
- **Tunable sliders** — the model exposes the parameters worth tuning (color, spacing, font). Drag to refine without round-tripping.
- **Switch designs** — the last five designs keep their preview iframes alive for zero-delay switching.
- **Export** — HTML, PDF (via your local Chrome), PPTX, ZIP, or Markdown, all generated on-device.

## Build from source

```bash
git clone https://github.com/alexraymond/ligma.git
cd ligma
pnpm install
pnpm dev
```

Requires Node 22 LTS and pnpm 9.15+. See [Architecture](./architecture) for the repo layout.

## Going further

- [Architecture](./architecture) — how the packages fit together.
- [Roadmap](./roadmap) — what ships when.
- [GitHub Issues](https://github.com/alexraymond/ligma/issues) — bug reports and feature requests.
