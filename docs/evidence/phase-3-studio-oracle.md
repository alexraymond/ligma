# Phase 3 — Studio, shapes, design-as-oracle, twin primitives: structural evidence

Date: 2026-08-11 · Tag: `phase-3-structural`

Phase 3's gate (brief §6) is "the §7 walkthroughs pass as recorded journey runs." Those
walkthroughs (D1–D3) require live model spawns; they run once, in the acceptance campaign,
rather than twice at double quota cost (decision logged in DECISIONS.md). What is proven NOW,
with the LLM layer stubbed and everything else real, is the entire machine those walkthroughs
ride on. This document records that structural evidence; the campaign's signed journey runs
complete the gate.

## Suites at phase close (all exit 0, verified by the conductor)

| Suite | Count |
|---|---|
| daemon unit | **708** (43 files) |
| daemon integration | **117** (12 files) |
| web unit | **82** (7 files) |
| web e2e | **21** (20 pass + 1 data-dependent skip) |
| cli unit | 7 |

Growth since Phase 2 close: +208 daemon unit, +51 daemon integration, +62 web unit, +12 e2e.

## What landed (workstreams A–F, all accepted)

- **Twin primitives (A):** `.ligma/` in-repo knowledge (boot.json argv-array schema, journeys,
  project.md); central builder-denied baselines/probes (`--disallowedTools` enforced on real
  argv); boot-recipe env adapter; journey runs = verification runs with nullable taskId;
  brownfield adoption pipeline (structured-output inference, governed spawns, nothing written
  until review applied); **ligma adopted itself** (dogfood boot.json + 3 journeys committed).
  Key test: journey end-to-end with baseline landing centrally and a recursive repo walk
  finding **zero** baseline files in-repo.
- **Consumer personas (B):** HTTP + PTY bridges as siblings of the browser bridge over one
  hardened bridge-server core; naive-developer (README-only, 25 source extensions denied at
  argv level); explorer charter; saboteur playbooks per transport; shape-aware panel
  selection; baselines record response schemas/exit codes. Key test: headless journey 9/9 —
  real bridges, real Ed25519 signing, tamper-refusal, central-only baselines.
- **Studio backend (C):** design sessions with the ported agent loop wired through an
  in-process MCP bridge to directory-scoped tools; SSE streaming (file progress, critic,
  status); single-critic critique against craft/ + design-system manifests; content-addressed
  snapshots (SHA-256, session-pattern, no SQLite); pins → compiled-instruction preview;
  approve → design baseline INSIDE the signed contract (ratified); promote with 70% holdout
  and governor estimate; file-body route serving head and history from immutable blobs.
- **Studio frontend (D):** Wall canvas, gesture machine and throttle ported verbatim with
  their tests; iframe pool; overlay pins (three-state, live rects) via @ligma/runtime
  unmodified; apply-preview before send; tweaks panel; critique lane visible by default;
  version rail with exact file-level diff; promote sheet (reused by both entrances);
  shape-gated tab (ui/mixed only, absent on headless).
- **Product flows (E):** Home composer (prompt-first, Adopt-a-repo chip, gating that names
  the missing field); discovery question-forms with appended shape-confirm; brief lock/edit
  with stale-flag Deck cards; adoption review sheet; Verify journeys + Prove it; evidence
  pins compiling into builder instructions; Knowledge tab; Deck widened to five card kinds
  with inline evidence and deterministic 1-in-10 verdict spot-checks.
- **Build wiring (F):** greenfield repo provisioning (`~/ligma-products/<slug>`); builders
  run in the product repo with unchanged deny rules; build must leave the product bootable
  (blocking boot-recipe gate, failure-class honest); task verification boots the product from
  its own recipe with the shape-appropriate panel. Key test: D1 skeleton 10/10 — provision →
  contract → build gate → product env → consumer panel → signed verdict → green check WITH
  verdict link.

## Deliberately not yet proven (owed by the acceptance campaign)

Live model behavior end to end: real discovery, real studio generation (the MCP bridge's
first live run), real critique scores, real persona walks, real judge verdicts — D1, D2
(including the capped critique retry, which has no stubbed rehearsal), D3 against a real
external repo, and everything D4–D7. No green claim is made here for any of it.
