# UX rebuild scoreboard

Per-phase evidence for docs/design/UX-REBUILD-BRIEF.md. Same tier discipline as
DONE.md: name what is proven and how, never more. Suites/drills/audits are
plumbing proof, not acceptance evidence.

## Phase 0 — fix-now list (brief §Phase 0) — DONE 2026-08-14

Seven fixes, each with a regression test that fails without it. Contract:
docs/history/CONTRACTS-phase0.md (two agents, zero shared files).

| Fix | What shipped | Regression test |
|-----|--------------|-----------------|
| F1 | Dispatcher skips tasks (and leaves due retries queued) for projects with `status === "paused"`; read once per poll cycle, fail-open on a broken projects.json; running agents untouched. `apps/daemon/src/engine/dispatcher.ts` | `apps/daemon/src/engine/dispatcher.test.ts` (6 tests: paused-id extraction, missing/corrupt fail-open, isDeferred untouched) |
| F2 | Checkpoint restore no longer wipes the activity log (`loadCoreData`); `/api/checkpoints/load` refuses 409 while the engine runs or a run is live (`restoreBlockedReason`, pure). Dialog copy names the true scope. `apps/daemon/src/store/data.ts`, `apps/daemon/src/routes/checkpoints/load/route.ts`, `apps/web/src/app/settings/checkpoints/page.tsx` | `apps/daemon/src/store/data.checkpoint.test.ts` (activity log survives restore; 3-case decision table) |
| F3 | Handoff prompt is project-scoped — the workspace-wide `ai-context-readable.md` digest is removed from `/api/mcp/handoff-prompt/:id`. | `route.test.ts`: seeds a cross-project sentinel into the digest, asserts it never reaches the prompt |
| F4 | Per-project board Done column sorts by completed recency and collapses past 20 behind Show all/Show recent, same helpers as the global board. `apps/web/src/app/projects/[id]/board/page.tsx` | `board-helpers.test.ts` (wiring proof on the page source; 25→20/25 behavior already pinned by board-view tests) |
| F5 | Use-everywhere guide stops denying the MCP server exists; new MCP tab documents the six real tools (list_projects, create_project, list_tasks, list_decisions, answer_decision, get_run_status) and the real launch/registration commands. `sections.ts` | `sections.test.ts`: 4 tabs, all six tool names present, no section claims "no MCP server" |
| F6 | Version rail renders each version's `createdAt` — relative label, absolute on hover — via `versionTimeLabel` on lib/time.ts. `version-rail.tsx`, `studio/api.ts` | `studio/api.test.ts` (pinned-now cases) |
| F7 | Kill-switch checkbox removed from governor-card; save payload never carries `killSwitch`; read-only banner/badge/file-instruction kept, why-line added ("a stop a browser can reach is a stop an agent can un-press"). Owner decision 2, audit §4. | `governor-card.test.ts` (source proof: no checkbox, no killSwitch in payload; read-only surfaces remain) |

Also: nav-crawl now clicks visible tabs before harvesting anchors — the
Library's contextual "+ New Skill" CTA (tab-gated since the master-detail
rework) had silently re-orphaned `/library/new`, the exact regression adda77f
fixed once at page level. Crawler-level fix covers the class.

Proof tails (2026-08-14):
- daemon: 107 files, 1146 passed / 1 skipped; tsc clean
- web: 47 files, 429 passed; tsc + next lint clean (pre-existing warnings only, none in touched files)
- api: 4 passed
- drills: D1, D2, D4 all PASS (zero tokens — not acceptance evidence)
- seam-audit: PASS (4/4 rules, zero new exemptions)
- nav-crawl: PASS (orphans: [], 8/8 redirects, /verification/[id] gate superseded by 7 real runs)

Deferred: nothing.

## Phase 1 — interrupt layer + the machine — DONE 2026-08-14

Contract: docs/history/CONTRACTS-phase1.md (four agents, zero shared files).

| Piece | What shipped |
|-------|--------------|
| Tray v2 | `/needs-you`: Blocking (decision, design-approval, promote-pending, adoption-review, machine-down) vs FYI (stale-brief, verdict-spot-check, unread inbox as items); age on every item; "since you were last here" divider off one `lastSeenAt` (localStorage, hints.ts pattern); focus mode < 8 items / grouped-by-project list with select-all + bulk at ≥ 8 (hardcoded `FOCUS_THRESHOLD`); Running + Activity tabs mounting the extracted `runs-list.tsx` / `activity-list.tsx`; single column at phone width; fetch failure → ErrorState, never an empty tray; unreachable daemon inserts a blocking machine item. Pure classification in `lib/needs-you.ts` (20 tests). |
| Redirects | `/deck` and `/inbox` are redirect shells to `/needs-you` (repo's exact legacy pattern); rail collapsed to one "Needs you" entry whose badge counts blocking only; `lib/nav.ts` IA updated (`needs-you` RailKey; brain-dump moves to Home/Capture). |
| The machine | One heartbeat in the top bar (state precedence: unreachable > kill-switch > running/starting/stopped) opening the machine overlay: daemon state, governor window with a derived one-sentence deny reason, backends with cooling, kill switch read-only + why, `/api/logs` tail (first UI consumer, 5s refresh while open), stated safety posture. Old sidebar GovernorGauge removed. |
| Stop/start verbs | "Stop starting new work" / "Resume" on the project page (never bare "Pause"; wired to F1's paused semantics); edit dialog's Paused option states the true semantic; "Stop everything now" in the overlay with an aftermath panel that names sessions ended and links /runs, /activity, /settings/checkpoints — copy hedges where a snapshot can't know task state; promote sheet rewritten in plain language with a **source-verified** isolation sentence and a reversibility line; session estimate on RunButton and the dashboard Launch tip. |
| 24h ping | Daemon-side: reuses the deck route's own composition (all four blocking kinds, no silent caps), pings once per item ever (`needs-you-pings.json`), >3 items rolls up into one notification, hourly self-throttle inside the scheduler poll, failure never breaks dispatch. 11 tests. |

**Truth correction found during this phase:** the spec's isolation sentence
("agents work in an isolated copy; your files and GitHub are untouched") is FALSE
for builders — `builderCwd` is the project's real repoPath; only
verification/journey runs use a throwaway worktree; nothing pushes to GitHub. The
shipped promote-sheet copy states the truth; the brief now carries the correction
so no later phase reintroduces the claim.

Proof tails (2026-08-14):
- daemon: 108 files, 1157 passed / 1 skipped; tsc clean
- web: 55 files, 475 passed; tsc + next lint clean (pre-existing warnings only)
- drills: D1, D2, D4 PASS — d4 now opens by proving /needs-you serves and /deck + /inbox hand off
- seam-audit: PASS, zero new exemptions (three painted lines in the merged tray were fixed to borrow, not exempted)
- nav-crawl: PASS — /needs-you in inventory, /deck → /needs-you, /inbox → /needs-you, /decisions asserted against its terminal landing
- Screenshots: phase-1-needs-you-phone.png (390px, single column), phase-1-needs-you-desktop.png

Deferred (named, per no-silent-caps): inbox reply/compose UI retired with /inbox —
tray items are read-only mark-read + deep-link; the human→system channel returns as
Talk in Phase 2 (spec §10). The last-seen divider does not render inside the focus
swipe stack (one card at a time leaves no room for a divider).

## Phase 2 — conversation + data model — DONE 2026-08-14

Contract: docs/history/CONTRACTS-phase2.md (four agents, fixed cross-agent shapes, zero
shared files; conductor merged the two shared registries).

| Piece | What shipped |
|-------|--------------|
| Data model | `projectId` on ActivityEvent + four new event kinds (run, verdict, promote, design_turn) with real writers; `consequenceTaskIds` on DecisionItem; commit SHA on runs (read at spawn, before the builder touches anything) and verdicts (passed into the judge so it lives inside the signed payload); prompt persisted at spawn + diff/status captured at run end (512KB cap, truncation flagged, `.changes.json` because re-parsing text is banned); `GET /api/runs/:id/prompt` + `/changes`; ledger entries annotated with durationMs + real token usage parsed from each backend's actual envelope (cache tokens counted as input — dropping them under-reports ~50x; fake-claude → nulls, drills never manufacture numbers); `GovernorRole "human"` exempt from the reserve floor only. Old-format fixtures load everywhere (readOrDefault + row tolerance). |
| Talk | Per-project thread at `data/projects/<id>/talk.json` (corrupt files quarantined, never clobbered); ⌘J drawer in every project surface; @role addressing; replies dispatched via `claimSpawn("human")` — deny appends a system message naming the reason, never silence; model output parsed against a strict schema, dead chips dropped, kept chips relabelled from the store — **the daemon writes the store, the model never touches a data file** (the inbox path's flaw, not copied); "Remember this" → `.ligma/project.md` Quirks with the destination named on the button; quirks now genuinely injected into builder prompts (the spec's "planning already injects it" was false — now it's true). |
| Discovery thread | Brief page re-presents discovery as a conversation keeping the form's scaffolding (Still needed: N of M, per-question Skip, "You decide" sentinel excluded from locked constraints, typed widgets inline, "I'll write the brief myself" exit); answered answers editable → new amend route: applies in place, re-derives shape, flips `staleFlaggedAt` on a locked brief, appends an answered DecisionItem with `consequenceTaskIds` — the stale-client "form is no longer the open one" throw untouched. |
| Task detail | Changes · Log · Prompt tabs; Log default, never auto-expands; 404 → "not recorded", never blank or invented. |
| Proof | `codeMovedSince(verdictSha, currentSha)` replaces the 7-day timer wherever a SHA exists (timer survives only SHA-less verdicts); `stale` joined the Verify header counts; "code moved since" badge borrows existing paint. Current-HEAD signal is the project's latest run SHA — weak until a builder has run; noted inline. |
| Brief drift | Age trigger live: 90+ days unchanged AND ≥25 tasks completed since → stale-brief card with "Re-run discovery / Still true (snooze 90 days)"; snooze writes `staleSnoozedUntil`. The previously dead stale-brief machinery now fires from two real causes. |

Proof tails (2026-08-14):
- daemon: 122 files, 1280 passed / 1 skipped; tsc clean (incl. a latent fresh-install ENOENT bug in `mutateActivityLog` found and fixed)
- api: 41 passed; web: 60 files, 516 passed; tsc + lint clean
- drills: D1, D2, D4, D5 all PASS — new D5 walks Talk (reply through the human role, dead chip dropped, chip resolves against the store, repo-less remember 409s) and the discovery thread (ask → You-decide skip → answer → lock → amend → consequence: decision row + consequenceTaskIds + staleFlaggedAt + deck card), all at zero tokens
- seam-audit: PASS, zero new exemptions; nav-crawl: PASS

Deferred (named): notes-panel folding into Talk (spec §10) — not in the brief's
Phase 2 list; Talk and notes coexist until Phase 3+. `consequenceTaskIds` is `[]`
from the amend path today — no flow re-plans tasks from an answer yet; the field
and its audit trail exist so the first such flow writes facts, not prose.

## Phase 3 — the shell — DONE 2026-08-14

Contract: docs/history/CONTRACTS-phase3.md (four agents; one lost its session to the org
spend limit mid-verification — its work was complete on disk and the conductor
finished its verification).

| Piece | What shipped |
|-------|--------------|
| Project rail | Replaces the sidebar: mark at top, Needs-you entry (blocking badge), project avatars pinned-first then most-recently-visited (localStorage MRU, cap 8, "+N" → portfolio), "+" opens the composer modal, status rings borrowed from status-pill (running / needs-you / quiet) with a desaturated no-signal state when the daemon poll fails — and every ring state is a WORD in the tooltip, the expanded rail, and ⌘K. Library/Crew/Settings drop to the housekeeping cluster. |
| Stage bar | Brief · Studio · Build · Proof replaces the eleven tabs; shape-adaptive (Studio only for design shapes); Build/Proof always render, quiet when empty. The seven absorbed tabs are `?panel=` drawers (references→Brief, design-files→Studio, notes/terminal/runs→Build, knowledge→Proof) and their old routes are redirect shells. `/projects/:id` client-redirects to the default stage (one rule, `defaultStageSegment`, shared by the rail, ⌘K, and the page). |
| Build | Flow (kanban, DnD intact) · Plan (goal → milestone → tasks, derived status only, "No goal" bucket); Priority Matrix demoted to a Flow lens; running/queued/deferred counts + the stop/start verb in the header; "we don't estimate dates" stated in Plan. |
| Proof | Summary-first: health board on top, stale in the counts; Ship panel with the honest no-preview sentence (no env-URL source exists — verified, not assumed), Share design, Open in editor (only when a vscodeUrl exists), Hand off (project-scoped prompt), "what travels" line, and the "still unproven" list with attempt counters. |
| Studio | Tweaks open by default for design shapes; export group named "Share design"; "Review canvas — you shape it by asking, not by dragging" + a "Two things this does not do" box — both claims verified against the component (only Wall cards reorder; the canvas renders the design's own files). |
| Portfolio grid | /projects gains ?view=projects|goals|tasks: sortable project cards + pin-to-rail; the Objectives page re-homed under goals (project-less goals included, ?goal= focus); the cross-project task table with the existing bulk bar (?task= opens the panel). /objectives, /board, /board/matrix are redirect shells. `recordHref` retargeted; both deck-card builders follow. |
| Home + keyboard | "/" is a door: empty workspace → composer over the welcome; with projects → the last-used project's default stage. The 851-line dashboard retired into the surfaces that own its parts (851 → 168 lines; orphaned hook/components deleted). ⌘K is a command palette (projects → stages → verbs incl. both stop verbs with an in-palette confirm); G-chords remapped in the same wave as the rail; the ? sheet lists exactly what is wired (one array drives both, pinned by keyboard-map.test.ts) and documents ⌘K/⌘P/⌘J. |

Crawler honesty fix found during this phase: client-redirect doors ("/" and
"/projects/:id") rendered and handed off, so their own pathnames never entered
the reached set and read as orphans — the crawl now credits a served door that
hands off, and the adoption gate's wiring proofs were re-pinned to their new
lines.

Proof tails (2026-08-14):
- web: 73 files, 617 passed; daemon: 123 files, 1282 passed / 1 skipped; api: 41; tsc 0 errors, lint clean
- seam-audit: PASS, zero new exemptions (the Build page's column dots moved into board-view.tsx and the one raw amber literal now reads from lib/kanban's exempt table — borrowed, not repainted)
- nav-crawl: PASS — full new inventory, zero orphans, every old route redirecting (10 legacy + 3 global retirements + 6 project-tab absorptions), /decisions and /status-board asserted at their terminal landings
- drills: D1, D2, D4, D5, D6 all PASS at zero tokens — D6 is the fresh-install walkthrough: empty data dir → composer (POST /api/briefs) → discovery thread (You-decide skip + shape answer + lock) → stub design → approve → Start building (promote, signed contract) → blocking decision reaches the tray queue → answer → consequence recorded (live undo window + decision_answered activity event carrying the projectId)
- Screenshots: phase-3-shell-build.png (rail + stage bar + Flow/Plan + stop verb + heartbeat), phase-3-portfolio.png (cross-project task view)

Deferred (named): Brain-dump stays a Home tab rather than becoming a Talk
affordance (spec §12 lists it; the brief's Phase 3 scope does not) — its engine
is untouched and the fold-in is a small follow-up. The rail's per-avatar context
menu (pin/unpin in place) lives in the portfolio card dropdown instead.
