# DONE.md — the factory's own inspection

**Status: CLOSED (2026-08-14) — all seven deliverables resolved; D1/D2/D4 closed at drill
tier by owner decision, live-signed verdicts waived.** This file states exactly what is
proven, at which tier, and what is not. Nothing here is marked done without a linked record;
records name their tier: **live-signed** (Ed25519 verdict from a booted instance), **drill**
(real boot/daemon/dispatch, canned intelligence, zero tokens — wiring proof, never
acceptance), or **suite** (unit/integration). The owner did not upgrade drill to acceptance;
the owner waived live acceptance itself, reversibly — a future campaign can still mint the
verdicts. (Brief §7; owner decisions in [DECISIONS.md](../DECISIONS.md) 2026-08-13 and
2026-08-14.)

## The scoreboard

| D | Claim | State | Evidence |
|---|---|---|---|
| D1 | Headless greenfield, composer→verdict, zero CLI | **CLOSED at drill tier (owner decision 2026-08-14)** — the full seam path (brief→discovery→lock→promote→dispatch) passes the zero-token drill; a live attempt found and fixed real defects (`249b01f` dispatchability, `7239a74` id-as-brief) | drill `scripts/acceptance/drill-d1.ts` (7/7) · attempt [1](campaign/d1-attempt-1/manifest.json) (a `d1-attempt-2` was previously cited here but never existed in git history — corrected 2026-08-27, see `docs/audits/docs-audit-2026-08-27.md` D21) |
| D2 | UI greenfield, Wall→critique→promote→browser persona→capped retry | **CLOSED at drill tier (owner decision 2026-08-14); best live evidence: judged verdict 4/8 met (attempt 6), live retry waived** — six attempts each rooted out a committed defect: scenario pin, quota-claim leak `8ca6b3f`, 429≠failed `36e09bd`, partial-Task cast `4cbe59b`, binary-swap retry `e91af53`, locked answers `86cce9c`; builders took 5 promoted tasks to awaiting-verification live; the full design loop (Wall→critique→pin→apply-preview→apply→approve→promote w/ signed designBaseline) passes the zero-token drill 12/12 | attempts [1](campaign/d2-attempt-1/NOTE.md)–[6](campaign/d2-attempt-6/manifest.json) · drill `drill-d2.ts` |
| D3 | Brownfield adoption | **GREEN** (attempt 4) — 9/9 criteria, signed verdict verified, boot confirmed once, crawl-proposed journeys, Verify+Knowledge populated, characterization baseline recorded centrally and proven never-in-repo | [manifest](campaign/d3/manifest.json) · attempts [1](campaign/d3-attempt-1/manifest.json)/[2](campaign/d3-attempt-2/manifest.json)/[3](campaign/d3-attempt-3/manifest.json) |
| D4 | Daily loop from Deck cards alone | **CLOSED at drill tier (owner decision 2026-08-14); best live evidence: attempt 4 (committed `5b9ff39`, after this closure decision) met 7/8, live re-run waived** — every named defect fixed since (plain-click answering, server-derived undo, criterion on card, badge unification); deck loop drill 5/5 (answer, server-derived undo, re-answer, 5-item clear); two seam gaps documented in the drill: no server deck-queue route, no batch decisions endpoint | attempts [1](campaign/d4-attempt-1/manifest.json)/[2](campaign/d4-attempt-2/manifest.json)/[3](campaign/d4-attempt-3/manifest.json)/[4](campaign/d4-attempt-4/manifest.json) · drill `drill-d4.ts` (attempt 4 postdates the closure decision — corrected 2026-08-27, see `docs/audits/docs-audit-2026-08-27.md` D21) |
| D5 | Seam audit: zero orphans, one vocabulary, no unbacked green | **GREEN** (re-run 2026-08-13) — nav-crawl 33/33 + 8/8 redirects after the crawler learned to seed every project subtree (the original PASS was true for its data state; the blind spot surfaced once verification runs existed); seam audit 4/4 after one argued exemption (run-row: logic words + an action button, not a second pill) | [manifest](campaign/d5/manifest.json) · [attempt 1](campaign/d5-attempt-1/manifest.json) |
| D6 | Completeness matrix, no open cells | **0 MISSING — CLOSED** after 17 gap cells were built (`2e96172`…`af7a758`); the 34 rows that awaited live-chain citations are owner-waived (2026-08-14), reversible by a future campaign | [matrix](completeness-matrix.md) |
| D7 | Capability-parity matrix, no unapproved reductions | **0 REDUCED** of 503 rows (416 work, 87 waived — 67 argued + 16 automatic + 4 pending-live rows owner-waived 2026-08-14) — forty-seven rows closed 2026-08-13 (catalogs, discovery controls, Settings sections, live agent-backend probe, export diagnostics, Terminal, studio deep links, composer garnish, critique replay, workspace reference/design-files/notes stages, MCP server + registry + handoff, cross-session agent memory, library facets/ranking/use-tracking/bookmarks/authoring guides, design-system creation wizard + brand extraction); one ⚠ card needs Alex: BYOK remainder (W-43) | [matrix](parity-matrix.md) |

## How to read the attempts

Every red attempt is preserved, not erased: each produced named defects, each defect was
root-caused and fixed forward, and the fix is cited next to the re-run. That loop — persona
walks, judge rules with screenshots, builder gets the reasoning, capped retry — is the
product's own thesis applied to itself. Highlights:

- d3 attempt 1 → the env health check polled a port the server never bound + SPA-shell
  health markers (`341d4c1`); attempt 2 → `next dev` dies under panel load → production-build
  harness with process-death watch (`07f8c0e`); attempt 3 → install-failure dead ends →
  recovery card + adoption runs on Runs + lockfile/subdir-aware inference (`004e0cd`,
  `c89b18d`, `ff79b0c`).
- d4 attempt 1 → seed predated the widened Deck + `next dev` flakiness → signed-verdict seed,
  all card kinds (`8bd4bb3`); attempt 2 → pointer-capture swallowed plain clicks, fabricated
  undo countdown, criterion missing from spot-check card (`e98cd34`, `89825f8`, `ed5a3e3`),
  badge/list honesty (`a7d975e`).
- The live campaign also exposed: promoted tasks were never dispatchable (`249b01f`) — masked
  by every stubbed test, caught only by running the product for real.
- d2's six attempts, one committed defect each: unbounded scenario → journey pinned; dispatcher
  leaked a governor slot per failed dispatch per tick (`8ca6b3f`); credits exhaustion judged
  `failed` instead of `error` (`36e09bd`); promote smuggled a partial Task past strict TS with a
  double cast (`4cbe59b`); the CLI's self-update swapped its binary under the judge (`e91af53`);
  the user's locked discovery answers never reached the promote planner (`86cce9c`) — plus the
  headless entrance planned from a `brf_…` id instead of the brief (`7239a74`). Attempt 6 ended
  in the first real judged verdict: 4/8 met, builders proven live.
- The cost lesson is recorded as its own tier: seam bugs are found by drills (zero tokens),
  environmental faults by preflight (one probe), and live spawns run on cheap models with a
  minimal panel — proof runs are for minting evidence, not for debugging.

## Ground rules this file obeys

Signed verdicts only (Ed25519, verified against the booted instance's own key on import);
`error` ≠ `failed` everywhere; a chain is green only when every link is; matrices cite runs,
never memory. The quota governor gated every spawn in every attempt — including deferring the
campaign itself when Alex's reserve floor was at risk (30/40 window observed during d4
attempt 3; the campaign waits rather than borrowing from the reserve).

## Phase evidence (structural, pre-campaign)

[Phase 1 consolidation](phase-1-consolidation.md) · [Phase 2 daemon+IA](phase-2-daemon-ia.md)
· [Phase 3 studio/oracle](phase-3-studio-oracle.md) · [Phase 4 library/polish](phase-4-library-polish.md)
· [Decision log](../DECISIONS.md) · Contracts:
[phase2](../history/CONTRACTS-phase2.md) · [phase3](../history/CONTRACTS-phase3.md)
· [phase4](../history/CONTRACTS-phase4.md) · [campaign](../history/CONTRACTS-campaign.md)
