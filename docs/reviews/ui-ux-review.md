# Ligma UI/UX review — 2026-08-13

Two independent passes, synthesized: an **experiential walkthrough** (all 34 real surfaces
against the dogfood store, plus a fresh-install first run; 92 screenshots) and a
**mechanical code review** (refresh mechanics, workflow completeness, error presentation,
information architecture). Full reports, each with per-finding evidence:

- [walkthrough/findings.md](walkthrough/findings.md) — screenshots in [walkthrough/shots/](walkthrough/shots/)
- [mechanics/findings.md](mechanics/findings.md)

## The one-paragraph verdict

The surfaces are individually well built and the writing is unusually honest — the product
names its own limits, which is exactly right for an autonomous system. Two structural gaps
undercut it: **the plumbing between surfaces** (29 independent fetch mechanisms, no shared
invalidation, so answers/promotions/run-completions don't propagate without a reload) and
**the unhappy paths** (a fresh install errors on nine screens; fetch failures render as
confident emptiness; waiting has no vocabulary — spinners that never resolve wherever the
governor defers or a process dies). Three or four surfaces were *designed* — Deck, Library,
Brief, Settings — and the rest were assembled.

## Blockers — ALL SIX FIXED (ae907d8, 0249bab)

| # | Finding | Source |
|---|---|---|
| B1 | Fresh install renders "Something went wrong" on nine surfaces: seven store readers throw ENOENT where four siblings default to empty | walkthrough |
| B2 | Notes tab 405s on every project: route mounting sorts by path length, so `/:refId` swallows `/notes` | walkthrough |
| B3 | Composer's Start spins silently through synchronous discovery; the project already exists but the user isn't taken to it | walkthrough |
| B4 | Verify hides a project's evidence once 50 runs exist workspace-wide, and claims none exist | mechanics F1 |
| B5 | Fetch failure rendered as confident emptiness in seven hooks — two of them silently delete navigation tabs | mechanics F2 |
| B6 | Activity-log Undo offers an action the server 405s (no PUT route) | mechanics F4 |

## Majors — ALL TEN FIXED (owner directive 2026-08-13; waves in CONTRACTS-uifix.md)

Commits: 4f9ddbd (M1+M9: shared collection cache, invalidation, visibility-gated
polling, run-output SSE; M5+M10 components), c0f5bce (M4, M6, M7, M8 + waiting/error
wiring + meta-pagination for the 208-vs-200 count), 4559a43 (M2, M3), 60f40f1
(minors + M5/M10 call-site closure). Verified: web 412, daemon 1135, api 4 tests;
typecheck/lint clean; drills 3/3; seam audit PASS with zero new exemptions
(status-pill.tsx now exports its tables so satellites borrow, never repaint);
nav-crawl PASS — /verification/[id]'s data gate retired, reached by real navigation.

1. **Cross-surface staleness is one systemic bug** (mechanics F5–F8, F16): mutations refresh
   the hook that owns the change; every derived surface goes stale. Deck list-mode leaves the
   rail badge frozen; promote refreshes nothing; "Prove it" never updates its own row; Home's
   "needs you" is frozen at page load. The structural fix is one shared provider + explicit
   invalidation for the four always-on collections.
2. **The rebrand is unfinished where it matters most** (walkthrough M1): "Welcome to Mission
   Control" is the first-run headline; a live agent system prompt points builders at a dead
   `mission-control/` path; tab title, Autopilot card, demo copy.
3. **One concept, four names** (M2): Projects/Missions, Board/Status Board, Deck/Decisions,
   Crew vs `/team/`, Home vs Dashboard — sometimes on one screen.
4. **Status badges contradict their own data** (M3): "Not Started" over 7/7 complete; 0/4
   milestones over 78/78 tasks; a journey both done and failed; 208 vs 200 done. Fastest way
   to lose trust in an autonomous product.
5. **Waiting has no vocabulary** (M8 + B3): stuck Running with a dead pid, Terminal
   `connecting…` forever, silent SSE death on the Wall (mechanics F9). One shared waiting/
   staleness component: queued · deferred (resumes ~HH:MM) · running 4m · stalled.
6. **Runs shows no runs; Board renders 36,900px of Done** (M4, M5): two surfaces failing
   their one job in opposite directions.
7. **Raw internals as user copy** (M6, M7, mechanics vocabulary list): `vrun_…` breadcrumbs,
   `task_…` as titles, an SDK JSON transcript as an activity summary stretching the page to
   4,019px, unrendered markdown, PIDs in prose.
8. **Health table is a spec dump** (M9): the most valuable table in the product, least
   readable — needs summary-first with detail on demand.
9. **Polling economics** (mechanics F11, F16): `/api/runs` every 3s from background tabs,
   duplicated mounts multiplying identical requests (~50 req/min idle); SSE endpoint for run
   output exists, proven by the CLI, unused by the web.
10. **Error idiom sprawl** (mechanics F18, walkthrough m2): four competing error presentations,
    four dead classifiers, three hardcoded failure classes.

## Minor + polish — FIXED (60f40f1)

Deliberate keeps, argued: evidence timestamps stay year-explicit (a D6 test pins it);
`notes-panel`'s timestamp and `task-card`'s due date keep their distinct semantics;
the "dead" snapshots GET is exercised by a daemon integration test, so it stays.

Original list — see the two reports' full ranked lists: empty states with no way out ("Drag tasks here" with
no source), icon-only action rows, five date formats and no relative time, mid-word
truncation, inconsistent container insets, the olive Studio canvas, primary buttons that
ignore context (+ New Skill on the Design systems tab), dead `use-dashboard.ts`, six comments
asserting their own code is unwired when it is, and the unconsumed-routes list (12 endpoints
with no UI consumer — the run-output SSE being the highest-value wire-up).

## What is genuinely good (keep it)

The writing (Runs preflight, brief empty state, "Two things this does not do", "This is a
verdict — signed evidence, not a claim"); Deck's one-card model; Library's live sandbox
preview and the wizard; the shape-adaptive pipeline; total-Record status rendering (a missing
state is a compile error); eight legacy redirects with zero URL dead-ends; zero console-error
swallows outside the boundaries.
