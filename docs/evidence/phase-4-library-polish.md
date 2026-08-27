# Phase 4 — Library, polish, onboarding, smoke digest: structural evidence

Date: 2026-08-12 · Tag: `phase-4-structural`

Phase 4's gate (brief §6) is "the §7 completeness matrix has no open cells" — the matrix
itself (D6) is assembled in the acceptance campaign from recorded evidence. This document
records the phase's construction evidence; the matrix completes the gate.

## Suites at phase close (all exit 0, conductor-verified)

| Suite | Count |
|---|---|
| daemon unit | **787** (48 files) |
| daemon integration | **118** (12 files) |
| web unit | **126** (11 files) |
| web e2e | **31 passed** + 1 pre-existing env-gated skip |
| cli | 7 |
| root lint (biome) | green (436 files) |

## What landed

- **Library (P4-A):** master–detail catalogs — design systems (live sandboxed preview,
  swatches from tokens.css, DESIGN.md, used-by backlinks), skills, craft rules; one
  `MasterDetail` shell (filter box, keyboard model); ONE picker component shared everywhere
  (the studio picker is a re-export); `GET /api/design-systems` + `GET /api/craft-rules`
  serving the vendored triads read-only with path safety.
- **Failure-class recovery (P4-B):** one card family with one right action per class
  (auth/re-auth · rate-limit/calm-deferred · parse/retry · backend/switch · env/fix-boot ·
  harness/amber-not-a-verdict), wired at every site with structured cause data; structured
  `causeKind` + `resumesAt` added daemon-side at the classifying sites (P4-C), never derived
  from prose — `auth` deliberately unwired until a structured signal exists (regex over CLI
  output refused).
- **Onboarding (P4-B):** five milestone-scoped one-shot hints (first-visit replaces the old
  modal; first-project, first-design, first-promote, first-verdict), non-modal, persisted,
  never shown to returning users past the milestone. "＋ Design" affordance on Overview.
- **Smoke digest (P4-C):** journeys with cron smoke schedules ride the existing scheduler,
  governor-gated (denial → calm deferral); one morning Inbox digest per window from
  structured run+verdict data only (`error` ≠ `failed` preserved as data; no runs → no
  digest). SSE end-frame duplicate fixed; project hard-delete removes central data under the
  store mutex and never touches the product repo; journeys list exposes staleness fields.
- **Seam enforcement (D5 groundwork):** `scripts/audit/seam-audit.ts` — all four rules PASS
  on the tree (one pill vocabulary after routing five rogue sites through it; one shimmer
  primitive; green check never without verdict link — banner, criterion chips, persona cells
  all carry links; error visually distinct from failed). `scripts/audit/nav-crawl.ts` — PASS:
  36/36 surfaces reached, zero orphans, two explicitly-registered data-gated families
  (`/adoption/[runId]`, `/verification/[id]`) each with re-verified wiring proofs, 8/8
  redirects, no leaked servers, pure-JSON output.

## Open cells owed to the campaign

D6's matrix rows for these surfaces cite journey runs from the live campaign; the data-gated
register empties itself the moment live runs produce adoption/verification instances.
