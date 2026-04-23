# Changelog

All notable changes to Open CoDesign are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-04-21

Post-v0.1.0 maintenance release. No breaking changes. Focused on runtime correctness, release-pipeline polish, and prompt quality.

### Highlights

- **JSX previews unblocked** — replaced the broken React UMD vendor bundle so React/JSX artifacts render reliably.
- **Context pruning** — size-based prune of tool-call input and tool-result payloads during orchestration, with an artifact-wrapper override, so long agent sessions no longer balloon the prompt.
- **Interactive depth mandate** — prompts now require a craft-surplus minimum across every artifact type (real interactions, real states, not a wireframe).
- **Keyless providers in Codex import** — the Claude Code / Codex import flow now correctly pulls in IP-allowlisted proxies that have no API key.
- **Release pipeline** — workspace build + bundler smoke test added to CI; electron-builder auto-update metadata disabled until signing ships; all i18n menu keys supplied.
- **Packaging manifests** scaffolded for Homebrew Cask, winget, and Scoop.

### All changes

- feat(prompts): mandate interactive depth + craft-surplus minimums (1f3b913)
- fix(core): size-based context pruning + artifact-wrapper override (b692ec7)
- fix(core): aggressive context-prune — compact `toolCall.input` + `toolResult` (b614196)
- fix(desktop): support imported Codex keyless providers (1cdf006)
- fix(runtime): inject comment overlay into HTML previews (bed4458)
- fix(runtime): replace broken React UMD vendor + unblock JSX previews (4536297)
- fix(release): disable electron-builder auto-update metadata (16be6cc)
- fix(i18n): add provider import menu keys (29a3f97)
- fix(ci): release workspace build + add bundler smoke to CI (4cc21df)
- docs(packaging): scaffold Homebrew / winget / Scoop manifests (d342eae)

---

## [0.1.0] — 2026-04-18

First public release. Electron desktop app, GitHub releases for macOS (DMG), Windows (EXE), and Linux (AppImage). Installers are unsigned in v0.1 — code-signing + opt-in auto-update land in v0.5.

### Added

- **Unified provider model** — Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, SiliconFlow, local Ollama, and any OpenAI-compatible relay. Switch in Settings with no hardcoded shortlists.
- **Dynamic model picker** — every provider exposes its real model catalogue fetched at connect time.
- **Keyless providers** — IP-allowlisted proxies (enterprise gateways, local Ollama) supported with empty API key.
- **Claude Code + Codex config import** — one-click import reads `~/.codex/config.toml` and `~/.claude/settings.json` and pulls in every provider, model, and key.
- **Prompt → HTML or JSX/React component** — rendered in a sandboxed iframe with vendored React 18 + Babel, fully on-device.
- **Twelve built-in design skill modules** — slide decks, dashboards, landing pages, SVG charts, glassmorphism, editorial typography, heroes, pricing, footers, chat UIs, data tables, calendars. The agent picks the skill that matches the brief.
- **Fifteen ready-to-edit demo prompts** — cosmic animation, organic loaders, landing page, case study, dashboard, pitch slide, email, mobile app, pricing page, blog article, event calendar, chat interface, portfolio gallery, receipt/invoice, settings panel. All localized EN + 简体中文.
- **Anti-AI-slop design Skill** injected into every generation.
- **Inline comment → AI patch loop** — click any element in the preview, leave a note, the model rewrites only that region (str_replace against stable `data-codesign-id`).
- **AI-generated tunable sliders** — the model emits the parameters worth tweaking (color, spacing, font); drag to refine without re-prompting.
- **Live agent panel** — streaming tool calls rendered in real time while the model edits files.
- **Instant design switching** — preview-iframe pool keeps the last five designs hot in memory, Hub ↔ Workspace switching is zero-delay.
- **Phone / tablet / desktop preview frames** — true responsive canvas switching.
- **Files panel** — inspect multi-file artifacts (HTML, CSS, JS) before export.
- **Connection diagnostic panel** — one-click test for any provider with actionable errors.
- **Light + dark themes**; **English + 简体中文 UI** with live language toggle.
- **Five export formats** — HTML (inlined CSS), PDF (via user's local Chrome through puppeteer-core), PPTX (pptxgenjs), ZIP asset bundle, Markdown. All exporters lazy-loaded.
- **Generation cancellation** — stop mid-stream without losing prior turns.
- **Four-tab Settings** — Models, Appearance, Storage, Advanced.
- **Local-first storage** — SQLite (better-sqlite3) for design history and snapshots; TOML (encrypted via Electron `safeStorage`) for config. No electron-store blob. XDG-compliant paths.
- **Zero mandatory telemetry, zero cloud account, zero API proxy.**
- **Install size ≤ 80 MB** across macOS and Windows installers (CI-enforced).
- **MIT license** with third-party NOTICE file and machine-readable `CITATION.cff`.

### Technical foundation

- pnpm workspace + Turborepo + Biome + TypeScript (`strict: true`, `verbatimModuleSyntax: true`)
- Electron + React 19 + Vite 6 + Tailwind v4
- `@mariozechner/pi-ai` as the multi-provider abstraction
- Vitest for unit tests (~700 tests across 11 packages), Playwright for E2E
- Sandboxed iframe renderer using esbuild-wasm + import maps

[0.1.1]: https://github.com/OpenCoworkAI/open-codesign/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/OpenCoworkAI/open-codesign/releases/tag/v0.1.0
