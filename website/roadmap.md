---
title: Roadmap
description: What ships when. Living document, tracked alongside the code.
---

# Roadmap

Living plan from v0.1 → v1.0. Phases are cumulative — each stage builds on the last.

## v0.1 — Shipped (April 2026)

First public release, installers for macOS (DMG), Windows (EXE), and Linux (AppImage).

- Unified provider model — Anthropic, OpenAI, Gemini, DeepSeek, or any OpenAI-compatible relay; keyless (IP-allowlisted) proxies supported
- One-click import from Claude Code and Codex configs
- Dynamic model picker — every provider exposes its real model catalogue
- Prompt → HTML **or JSX/React component** prototype in a sandboxed iframe (vendored React 18 + Babel)
- Live agent panel — tool calls stream in real time
- AI-generated sliders and inline comment mode (pin + AI region-rewrite)
- Instant design switching via preview pool
- Five export formats — HTML, PDF, PPTX, ZIP, Markdown
- Bilingual UI (English + 简体中文)
- Built-in anti-AI-slop design Skill

## v0.2 — Cost + versions (next)

Pre-generation token estimate and weekly spend budget (per-generation token counter already ships in the sidebar), version snapshots with side-by-side diff and rollback, three-style parallel exploration.

## v0.3 — Codebase → design system

Point at a local repo; we extract Tailwind tokens, CSS variables, and W3C design tokens, and every subsequent generation respects them. The extractors (`tailwindExtractor`, `cssVarExtractor`, `dtcgImporter`) are already implemented library-side with full test coverage; v0.3 wires them to the desktop UI.

## v0.4 — Web capture + handoff

Playwright-powered web capture (on-demand), handoff bundle to open-cowork, external skill packs.

## v0.5 — Signing + distribution

Apple Developer ID + Windows Authenticode code-signing, opt-in auto-update, Homebrew Cask + winget + Scoop manifests verified.

## v1.0 — Public milestone

Onboarding ≤ 3 steps, full bilingual docs, stable public API for packages/core and packages/providers.

## Deferred (post-1.0)

Real-time collaboration, MCP server interface, Claude Artifacts `<artifact>` import, plugin loading inside open-cowork, hosted demo site, mobile companion (read-only).

## Anti-goals

Built-in payment, user accounts, cloud sync, stock asset library, custom model fine-tuning, team admin console.

