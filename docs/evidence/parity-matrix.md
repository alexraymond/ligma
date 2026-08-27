# D7 — Capability-Parity Matrix

> **FROZEN — 2026-08-12, superseded by `docs/parity/feature-track.md` for "does
> it have X today".** This matrix is not maintained after its freeze date: rows
> recorded `works` for capabilities retired days later (inbox compose/reply/
> forward, deck swipe, board/matrix pages), and waivers W-13/W-14/W-16/W-40/W-44
> now name capabilities that have since shipped. Row-by-row edits are
> deliberately not made here (they would break the citation stability the
> evidence culture depends on) — see the "Overtaken events" addendum at the end
> of this file for the specific reversals, and `docs/audits/docs-audit-2026-08-27.md`
> findings D3/D19/D27 for the full audit trail. `docs/CONTRACTS-*.md` and
> other historical citations elsewhere in this repo now live under
> `docs/history/`.

Date: 2026-08-12 · Branch: `main` · Owner: C3-D7

**Closure note (2026-08-14):** the `works-pending-live` rows below are closed as
**owner-waived** — Alex chose to close D1–D7 acceptance on drill evidence rather than run the
live campaign (DECISIONS.md 2026-08-14). Rows keep their markers and named chains; the waiver
is reversible in place. MC-298 stays flagged for re-triage on its own merits (unreachable
code, not a missing chain).

Build brief §7 D7: *"Every row maps to its working ligma equivalent with evidence, or to an
explicit argued waiver (automatic only for §8's multi-user exclusions; 'later' deferrals need a
roadmap home). A row where ligma does less than the parent did is failing unless Alex approved
the reduction by decision card."*

One row per row of `docs/parity/mission-control-capabilities.md` (332) and
`docs/parity/open-design-capabilities.md` (171) — **503 rows**, IDs preserved. Every mapping was
verified by opening ligma's source; the inventories' Notes column was used to state the parent's
behaviour, never to certify ligma's.

## Status vocabulary

| Status | Meaning |
|---|---|
| `works` | Verified in ligma: cited file:line of the working code, plus the test/e2e/audit that exercises it or the phase-evidence section that recorded it. |
| `works-pending-live` | Structurally complete and wired, but its only real exercise is a campaign chain that has not landed. The chain is named in the row. |
| `waived-multiuser` | Automatic waiver — the inventory marks the row **MULTI-USER**; brief §8 excludes RBAC/auth/multi-tenancy. |
| `waived` | Explicit argued waiver. The argument is in the row or its footnote; deferrals name a roadmap home. |
| `REDUCED` | **Failing.** Ligma does less than the parent. **Zero rows carry it today** — the 33 from the first pass were resolved on 2026-08-12 (§D7.1). |
| `unverified` | Could not be confirmed from source; the row says what is missing. Never used as a soft green. |

## Shared evidence keys

Cited by ID in the Evidence column instead of repeating the path on 300 rows.

| Key | What it is |
|---|---|
| **E-crawl** | `docs/evidence/campaign/d5/audits/d5-nav-crawl.json` — chain **d5**, green: 37/37 route surfaces reached from the rail, `"orphans": []`, 8/8 retired-URL redirects, two registered data-gated families with wiring proofs. |
| **E-seam** | `docs/evidence/campaign/d5/audits/d5-seam-audit.json` — chain **d5**, green: one status-pill vocabulary, one shimmer primitive, no green check without a verdict link, `error` styled distinctly from `failed`. |
| **E-p1** | `docs/evidence/phase-1-consolidation.md` — both histories intact; parent suites green in the new home. |
| **E-p2** | `docs/evidence/phase-2-daemon-ia.md` — 35 routes ported byte-identically; CLI transcripts against the live daemon. |
| **E-p3** | `docs/evidence/phase-3-studio-oracle.md` — daemon 708 unit / 117 integration, web 82 unit, 21 e2e at phase close. |
| **E-p4** | `docs/evidence/phase-4-library-polish.md` — daemon 787 unit / 118 integration, web 126 unit, 31 e2e, biome green at phase close. |
| **E-rail** | `apps/web/src/components/app-sidebar.tsx:20` — the seven-destination global rail, present on every route. |

Chains not yet landed at the time of writing: **d1**, **d2**, **d3** (in flight — `data/contracts/proj_ligma__d3-adopt.jsonl` exists), **d4**. Chain **d5** is green. Rows that
depend on them carry `works-pending-live` with the chain id.

---

# Part 1 — Mission Control (MC-001 … MC-332)

## Pages · Dashboard → Home (`/`)

All sixteen rows live on ligma's Home, reached first by E-crawl.

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-001 | Create task (dialog) | Home "New Task" → `CreateTaskDialog` | `apps/web/src/app/page.tsx:540` (dialog `:823`) | works |
| MC-002 | Create project/mission (dialog) | Home "New Project" → `CreateProjectDialog` | `apps/web/src/app/page.tsx:545`; `apps/web/src/components/create-project-dialog.tsx:39` | works |
| MC-003 | Create goal (dialog) | Home "New Goal" → `CreateGoalDialog` | `apps/web/src/app/page.tsx:550` (dialog `:835`) | works |
| MC-004 | Load demo data | Empty-workspace welcome → `POST /api/seed-demo` | `apps/web/src/app/page.tsx:352`; `apps/daemon/src/routes/seed-demo/route.ts:7` | works |
| MC-005 | Start/stop Autopilot from dashboard | Home Autopilot card (`useDaemon`) | `apps/web/src/app/page.tsx:430` (stop `:441`) | works |
| MC-006 | Stats bar counts | Home stats bar | `apps/web/src/app/page.tsx:455` (brain-dump tile `:504`) | works |
| MC-007 | "Attention Required" with deep links | Home attention list | `apps/web/src/app/page.tsx:155` | works |
| MC-008 | Inbox widget preview | Home inbox widget → `/inbox` | `apps/web/src/app/page.tsx:559` | works |
| MC-009 | Decisions widget preview | Home decisions widget → `/deck` | `apps/web/src/app/page.tsx:602` | works |
| MC-010 | Recent Activity preview | Home activity widget → `/activity` | `apps/web/src/app/page.tsx:648` | works |
| MC-011 | Crew Status workload panel | Home crew panel → `/team/[id]` | `apps/web/src/app/page.tsx:130` (link `:702`) | works |
| MC-012 | Missions grid | Home missions grid (`ProjectCardLarge`) | `apps/web/src/app/page.tsx:754` | works |
| MC-013 | Long-Term Objectives grid | Home objectives grid (`GoalCard`) | `apps/web/src/app/page.tsx:781` | works |
| MC-014 | Eisenhower summary widget | `EisenhowerSummary` on Home | `apps/web/src/app/page.tsx:789` | works |
| MC-015 | Recent Brain Dump preview | Home brain-dump card | `apps/web/src/app/page.tsx:793` | works |
| MC-016 | Empty-state onboarding cards | Home empty state (3 cards) | `apps/web/src/app/page.tsx:300` (deploy-agents `:330`) | works |

## Pages · Priority Matrix → `/board/matrix`

Re-homed under Board; `/priority-matrix` still redirects (E-crawl redirect 3/8).

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-017 | Drag task between quadrants | `/board/matrix` dnd-kit board | `apps/web/src/app/board/matrix/page.tsx:77` (wrapper `:145`); e2e `apps/web/e2e/smoke.spec.ts:103` | works |
| MC-018 | Filter by project | Matrix project select | `apps/web/src/app/board/matrix/page.tsx:114` | works |
| MC-019 | Filter by assignee | Matrix assignee select | `apps/web/src/app/board/matrix/page.tsx:125` | works |
| MC-020 | Create task from matrix | Matrix header button | `apps/web/src/app/board/matrix/page.tsx:138` | works |
| MC-021 | Multi-select + bulk done/delete | `BulkActionBar` on matrix | `apps/web/src/app/board/matrix/page.tsx:164` | works |
| MC-022 | Card click → detail panel | `BoardPanels` → `TaskDetailPanel` | `apps/web/src/components/board-view.tsx:156` (panel `:288`) | works |
| MC-023 | Run task inline from card | `RunButton` on `TaskCard`, blocked-dep gated | `apps/web/src/components/task-card.tsx:93` | works |

## Pages · Status Board → `/board`

`/status-board` still redirects (E-crawl redirect 2/8).

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-024 | Drag between kanban columns | `/board` four-column kanban | `apps/web/src/app/board/page.tsx:71` (columns `:32`); e2e `apps/web/e2e/smoke.spec.ts:26` | works |
| MC-025 | Filter by project | Board project select | `apps/web/src/app/board/page.tsx:107` | works |
| MC-026 | Create task from board | Board header button | `apps/web/src/app/board/page.tsx:119` | works |
| MC-027 | Multi-select + bulk done/delete | `BulkActionBar` on board | `apps/web/src/app/board/page.tsx:145` | works |
| MC-028 | Run task inline from kanban card | `onRunTask` → `RunButton` | `apps/web/src/app/board/page.tsx:139` | works |

## Pages · Projects / Missions

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-029 | Create mission | `/projects` create dialog | `apps/web/src/app/projects/page.tsx:115` (dialog `:150`) | works |
| MC-030 | Edit mission (+status) | `EditProjectDialog` | `apps/web/src/app/projects/page.tsx:157`; `apps/web/src/components/edit-project-dialog.tsx:119` | works |
| MC-031 | Archive / unarchive mission | Project card dropdown | `apps/web/src/components/project-card-large.tsx:100` (unarchive `:106`) | works |
| MC-032 | Delete mission (confirm, unlinks tasks) | `/projects` confirm → `DELETE /api/projects` | `apps/web/src/app/projects/page.tsx:166`; `apps/daemon/src/routes/projects/route.ts:131` | works |
| MC-033 | Show/hide archived toggle | `/projects` toggle + count badge | `apps/web/src/app/projects/page.tsx:106` | works |
| MC-034 | Launch all eligible tasks (list view) | Run-all on project card | `apps/web/src/components/project-card-large.tsx:49` (button `:67`) | works |
| MC-035 | Mission detail: run all tasks | Project space header `RunButton` | `apps/web/src/app/projects/[id]/layout.tsx:79` | works |
| MC-036 | Mission detail: add task | Project **Board tab** add-task, pre-fills `projectId` | `apps/web/src/app/projects/[id]/board/page.tsx:192` (button `:144`) | works — same capability, moved one tab deeper by the pipeline-strip IA; Overview is a status surface (UX spec §6) |
| MC-037 | Mission detail: add/remove team members | Overview member chips | `apps/web/src/app/projects/[id]/page.tsx:111` (add `:126`) | works |
| MC-038 | Mission detail: Priority Matrix tab | Project Board tab → matrix mode | `apps/web/src/app/projects/[id]/board/page.tsx:161` | works |
| MC-039 | Mission detail: Status Board tab | Project Board tab → kanban mode | `apps/web/src/app/projects/[id]/board/page.tsx:149`; e2e `apps/web/e2e/smoke.spec.ts:78` | works |
| MC-040 | Mission detail: Milestones tab | Overview milestones section (`GoalCard`) | `apps/web/src/app/projects/[id]/page.tsx:150` | works |

## Pages · Task Detail Panel & Task Form

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-041 | Edit all task fields | `TaskForm` inside `TaskDetailPanel` | `apps/web/src/components/task-detail-panel.tsx:429` | works |
| MC-042 | Deploy/reassign to agent | Panel deploy menu (auto-flips to in-progress) | `apps/web/src/components/task-detail-panel.tsx:207` (item `:398`) | works |
| MC-043 | Delete task from panel | Panel → `ConfirmDialog` | `apps/web/src/components/task-detail-panel.tsx:600` | works |
| MC-044 | Mark task reviewed | Panel "Mark Reviewed" | `apps/web/src/components/task-detail-panel.tsx:343` | works |
| MC-045 | Add comment (Cmd/Ctrl+Enter) | Panel comment box | `apps/web/src/components/task-detail-panel.tsx:504` | works |
| MC-046 | Comments thread (collapsible) | Panel comments collapsible | `apps/web/src/components/task-detail-panel.tsx:458` | works |
| MC-047 | Activity timeline (events + inbox) | Panel timeline | `apps/web/src/components/task-detail-panel.tsx:302` (collapsible `:527`) | works |
| MC-048 | Live/completed run output inline | Panel `useRunOutput` viewer | `apps/web/src/components/task-detail-panel.tsx:578` (hook `:90`) | works |
| MC-049 | Inline verification report (compact) | `<VerificationReport compact />` in panel | `apps/web/src/components/task-detail-panel.tsx:76` (fetch by taskId `:150`); wiring proof E-crawl `conditionallyReached[1].wiredAt` | works-pending-live — S1 re-triage (2026-08-13): `data/verification-runs/` is no longer empty (7 real runs, e.g. `vrun_1786581439197`, `vrun_1786554039301` — confirmed serving live via `GET /api/verification-runs/:id`), which closes the *page* half of this family (see MC-130…137). This row specifically needs a run linked to a **task** (`taskId` set, not null) — every real run recorded so far is a journey run (`journeyId` set, `taskId: null`), so the compact fetch-by-taskId path this row names has still never had real data to fetch. Stays pending on that narrower gap, not on chain d1 generally. |
| MC-050 | Escape/X/backdrop close + focus restore | Panel a11y handlers | `apps/web/src/components/task-detail-panel.tsx:187` (backdrop `:311`, X `:419`, restore `:177`) | works |
| MC-051 | Subtasks add/remove/toggle | `TaskForm` subtasks | `apps/web/src/components/task-form.tsx:487` (handlers `:107,:115,:122`) | works |
| MC-052 | Collaborators add/remove | `TaskForm` collaborators | `apps/web/src/components/task-form.tsx:331` (remove `:317`) | works |
| MC-053 | Dependencies (blocked-by) with search | `TaskForm` collapsible picker | `apps/web/src/components/task-form.tsx:530` (toggle `:128`) | works |
| MC-054 | Due date / estimated minutes | `TaskForm` fields | `apps/web/src/components/task-form.tsx:426` (minutes `:410`) | works |
| MC-055 | Acceptance criteria editor | `TaskForm` criteria textarea → contract compiler | `apps/web/src/components/task-form.tsx:571` | works |
| MC-056 | Live char-count validation | `TaskForm` counters | `apps/web/src/components/task-form.tsx:170` (`:193, :574, :608`) | works |

## Pages · Objectives (`/objectives`)

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-057 | Create objective / milestone | `/objectives` create dialog with type toggle | `apps/web/src/app/objectives/page.tsx:221`; `apps/web/src/components/create-goal-dialog.tsx:127` | works |
| MC-058 | Edit objective / milestone (+status) | `EditGoalDialog` | `apps/web/src/app/objectives/page.tsx:230`; `apps/web/src/components/edit-goal-dialog.tsx:107` | works |
| MC-059 | Delete objective — **cascades milestones** | `/objectives` confirm → `DELETE /api/goals` deletes the whole subtree | `apps/web/src/app/objectives/page.tsx:100` (confirm copy `:244`); `apps/daemon/src/routes/goals/route.ts:122` (`collectGoalSubtree` `:106`, both edges followed, surviving parents' `milestones` pruned); test `apps/daemon/__tests__/goals-cascade.test.ts` (5 cases incl. soft delete and task `milestoneId` clearing) | works — repaired 2026-08-12; the dialog's promise and the route now agree |
| MC-060 | Milestone progress + linked-task checklist | `MilestoneCard` read-only | `apps/web/src/app/objectives/page.tsx:51` (progress `:48`) | works |

## Pages · Crew (`/crew`, `/crew/new`)

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-061 | Create custom AI agent | `/crew/new` (auto-slug, icon picker, tags, active switch, live preview) | `apps/web/src/app/crew/new/page.tsx:70` (icons `:184`, preview `:289`, submit `:307`) | works — reached by E-crawl (anchor fixed in `adda77f`) |
| MC-062 | Filter agents all/active/inactive | `/crew` filter | `apps/web/src/app/crew/page.tsx:177` (state `:122`) | works |
| MC-063 | Agent card → team profile | `/crew` card link to `/team/[id]` | `apps/web/src/app/crew/page.tsx:55` | works |

## Pages · Skills Library → `/library`

`/skills`, `/skills/new`, `/skills/[id]` all still redirect (E-crawl redirects 4, 7, 8 of 8).

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-064 | Create skill | `/library/new` | `apps/web/src/app/library/new/page.tsx:194` (agents `:165`); e2e `apps/web/e2e/library.spec.ts:122` | works |
| MC-065 | Edit skill (dirty-state tracking) | `/library/[id]` | `apps/web/src/app/library/[id]/page.tsx:212` (indicator `:219`) | works |
| MC-066 | Delete skill | `/library/[id]` delete (native `confirm()`, same as parent) | `apps/web/src/app/library/[id]/page.tsx:63` | works |
| MC-067 | Assign/unassign skill to agents | Toggle grid on new + detail | `apps/web/src/app/library/[id]/page.tsx:188`; `apps/web/src/app/library/new/page.tsx:170` | works |
| MC-068 | Copy AI slash-command reference | `/library` AI-commands card + clipboard | `apps/web/src/app/library/page.tsx:199` (clipboard `:92`); e2e `apps/web/e2e/library.spec.ts:23` | works |

## Pages · Decisions → Deck (`/deck`)

`/decisions` still redirects (E-crawl redirect 1/8).

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-069 | Deck / List mode toggle | `/deck` mode toggle | `apps/web/src/app/deck/page.tsx:147` (state `:41`) | works |
| MC-070 | Swipe left → dismiss | `DecisionDeck` + `useSwipe` | `apps/web/src/components/decision-deck.tsx:52` (hook `:289`) | works |
| MC-071 | Swipe up → flag urgent | `DecisionDeck` | `apps/web/src/components/decision-deck.tsx:53` | works |
| MC-072 | Swipe down → defer 7 days | `DecisionDeck` | `apps/web/src/components/decision-deck.tsx:54` | works |
| MC-073 | Tap option to answer (deck) | `DecisionDeck` option buttons | `apps/web/src/components/decision-deck.tsx:461` | works |
| MC-074 | Deck keyboard shortcuts (`e.repeat` guarded) | `DecisionDeck` key handler | `apps/web/src/components/decision-deck.tsx:301` (mapping `:303`) | works |
| MC-075 | On-screen action buttons | `DecisionDeck` button row | `apps/web/src/components/decision-deck.tsx:491` | works |
| MC-076 | Undo last deck action (countdown ring) | `UndoToast` | `apps/web/src/components/decision-deck.tsx:516`; `apps/web/src/components/undo-toast.tsx:66` (window `:22`) | works |
| MC-077 | Batch review banner → list mode | `DecisionDeck` batch banner, over the queue now composed server-side | `apps/web/src/components/decision-deck.tsx:334` (button `:344`); `GET /api/deck` `apps/daemon/src/routes/deck/route.ts:112`; test `apps/daemon/__tests__/deck-route.test.ts` | works |
| MC-078 | Expand/collapse long context | `DecisionDeck` "Show more" | `apps/web/src/components/decision-deck.tsx:416` (toggle `:420`) | works |
| MC-079 | Deep link card → related task | `DecisionDeck` task link | `apps/web/src/components/decision-deck.tsx:406` (helper `:101`) | works |
| MC-080 | List mode: select individual / **select-all pending** | Per-row checkbox plus a select-all/clear control on the section header at any queue size | `apps/web/src/app/deck/page.tsx:359` (`data-testid="select-all-pending"`); the `≥BATCH_THRESHOLD` banner at `:301` stays a prompt, no longer the gate | works — repaired 2026-08-12; a queue of two has select-all |
| MC-081 | List mode: bulk answer | `/deck` bulk answer through the atomic `PATCH /api/decisions/bulk`, one outcome per id, partial-failure toast | `apps/web/src/app/deck/page.tsx:187` (`bulkApply`), `:194` (fetch); server `apps/daemon/src/routes/decisions/bulk/route.ts:59` (same stale-card guard and undo journal as the single PATCH); test `apps/daemon/__tests__/decisions-bulk-route.test.ts` | works — commit `bd19421`; server-side and idempotent on replay as of 2026-08-13 |
| MC-082 | List mode: bulk dismiss/defer/clear | `/deck` bulk actions, same atomic route | `apps/web/src/app/deck/page.tsx:332` (`:335`); `apps/daemon/src/routes/decisions/bulk/route.ts:59` | works — commit `bd19421` |
| MC-083 | List mode: preset or custom answer | `/deck` answer controls | `apps/web/src/app/deck/page.tsx:286` (custom `:301`) | works |
| MC-084 | Answered decisions history | `/deck` answered section | `apps/web/src/app/deck/page.tsx:336` | works |
| MC-085 | Deferred decisions disclosure | `/deck` `<details>` + "Resurfaces {date}" | `apps/web/src/app/deck/page.tsx:371` (`:385`) | works |
| MC-086 | Resurface a deferred decision now | `/deck` resurface | `apps/web/src/app/deck/page.tsx:398` | works |
| MC-087 | Answer via pre-run modal dialog | `DecisionDialog` via `ActiveRunsProvider` | `apps/web/src/providers/active-runs-provider.tsx:17`; `apps/web/src/hooks/use-active-runs.ts:102` | works |

## Pages · Inbox (`/inbox`)

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-088 | Compose new message (+auto-respond) | `/inbox` compose dialog | `apps/web/src/app/inbox/page.tsx:236` (auto-respond `:254`, dialog `:549`); e2e `apps/web/e2e/smoke.spec.ts:108` | works |
| MC-089 | Reply to thread | `handleReply` pre-fills recipient/subject | `apps/web/src/app/inbox/page.tsx:196` (button `:491`) | works |
| MC-090 | Forward message | `handleForward`, quotes original | `apps/web/src/app/inbox/page.tsx:205` (button `:505`) | works |
| MC-091 | Archive thread (single or all) | `handleArchiveThread` / "Archive All" | `apps/web/src/app/inbox/page.tsx:190` (`:519`) | works |
| MC-092 | Expand/collapse thread (marks read) | Thread toggle + `handleMarkThreadRead` | `apps/web/src/app/inbox/page.tsx:356` (`:185`) | works |
| MC-093 | Filter by agent / status | `/inbox` two selects | `apps/web/src/app/inbox/page.tsx:317` (`:328`) | works |
| MC-094 | Copy message body | `copyMessageBody` | `apps/web/src/app/inbox/page.tsx:148` (`:444`) | works |
| MC-095 | Trigger agent auto-respond | `POST /api/inbox/respond` → detached `run-inbox-respond.ts` | `apps/web/src/app/inbox/page.tsx:220`; `apps/daemon/src/routes/inbox/respond/route.ts:75` (path via `ENGINE_DIR`) | works |

## Pages · Brain Dump (`/brain-dump`)

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-096 | Quick capture (Enter saves) | `/brain-dump` capture | `apps/web/src/app/brain-dump/page.tsx:103` (textarea `:185`) | works |
| MC-097 | Edit entry inline | Inline edit handlers | `apps/web/src/app/brain-dump/page.tsx:224` (`:42`) | works |
| MC-098 | Convert entry to task | `handleConvertToTask` + prefilled dialog | `apps/web/src/app/brain-dump/page.tsx:110` (`:335, :341`) | works |
| MC-099 | Archive entry | Archive control | `apps/web/src/app/brain-dump/page.tsx:279` | works |
| MC-100 | Delete entry (confirm) | Delete + `ConfirmDialog` | `apps/web/src/app/brain-dump/page.tsx:283` (`:345`) | works |
| MC-101 | Auto-process single entry (AI triage) | UI + route; the detached spawn resolves through `ENGINE_DIR`, the same constant the sibling inbox route uses | `apps/web/src/app/brain-dump/page.tsx:49`; `apps/daemon/src/routes/brain-dump/automate/route.ts:69`; test `apps/daemon/__tests__/brain-dump-automate.test.ts` asserts the built argv **and** that the file it names exists on disk | works — repaired 2026-08-12 |
| MC-102 | Auto-process all unprocessed | Same route, `all:true`, 5s poll | `apps/web/src/app/brain-dump/page.tsx:64` (poll `:81`); test `apps/daemon/__tests__/brain-dump-automate.test.ts` ("passes every unprocessed entry id") | works — repaired 2026-08-12, see MC-101 |
| MC-103 | Archived/processed entries view | Archived section with conversion target | `apps/web/src/app/brain-dump/page.tsx:305` (`:315, :318`) | works |

## Pages · Launch (Autopilot) → `/runs` + `/settings`

The parent's single `/launch` page was split: live execution to `/runs`, configuration to
`/settings`. `/launch` still redirects to `/runs` (E-crawl redirect 6/8).

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-104 | Start/stop daemon | `/runs` Launch/Disengage | `apps/web/src/app/runs/page.tsx:150` (start `:159`); `apps/web/src/hooks/use-daemon.ts:175`; test `apps/daemon/__tests__/daemon-route.test.ts:76` | works |
| MC-105 | Live daemon status polling (5s) | `useDaemon` smart-poll | `apps/web/src/hooks/use-daemon.ts:115` (`:173`); test `apps/web/__tests__/use-smart-poll.test.ts` | works |
| MC-106 | Stats cards | `/runs` stat grid | `apps/web/src/app/runs/page.tsx:175` (`:178, :194, :209, :222`) | works |
| MC-107 | Quota governor card | `QuotaCard` on `/runs` (+ `GovernorGauge` in the rail) | `apps/web/src/components/quota-card.tsx:14` (floor `:56`, cooling `:70`); mounted `apps/web/src/app/runs/page.tsx:235` | works |
| MC-108 | Env preflight scan + one-click fixes | `EnvPreflightCard` on `/runs` | `apps/web/src/components/env-preflight-card.tsx:42` (`:111, :139`); mounted `apps/web/src/app/runs/page.tsx:238`; test `apps/daemon/__tests__/env-preflight.test.ts:143` | works |
| MC-109 | Task Runs list with live output | `RunRow` expand → `useRunOutput` | `apps/web/src/app/runs/page.tsx:256`; `apps/web/src/components/run-row.tsx:68` (`:22`) | works |
| MC-110 | Run status badges with **stalled/silent detection** | Real output silence: `GET /api/runs` stamps `lastOutputAt` from the mtime of the run's append-only output file, and the badge measures from that | `apps/daemon/src/routes/runs/route.ts:65` (`withOutputActivity` `:76`); `packages/api/src/types.ts:402` (`lastOutputAt`); `apps/web/src/components/run-status-badge.tsx:32` (`quietMinutes`); tests `apps/daemon/__tests__/runs-output-activity.test.ts`, `apps/web/__tests__/run-status.test.ts` | works — repaired 2026-08-12; `startedAt` survives only as the honest fallback for a run that has written nothing yet and for merged daemon-session rows, which have no output file |
| MC-111 | Daemon logs viewer | `/runs` collapsible log panel | `apps/web/src/app/runs/page.tsx:269` (colours `:56`, auto-scroll `:96`); `apps/web/src/hooks/use-daemon-logs.ts:37` | works |
| MC-112 | Active sessions list | `/runs` sessions table | `apps/web/src/app/runs/page.tsx:316` | works |
| MC-113 | Schedule: add scheduled skill | `/settings` Schedule card | `apps/web/src/app/settings/page.tsx:178` (button `:236`); e2e `apps/web/e2e/smoke.spec.ts:17` | works |
| MC-114 | Schedule: edit cron/command | Frequency presets + command dropdown | `apps/web/src/app/settings/page.tsx:25` (`:40, :257, :270, :171`) | works |
| MC-115 | Schedule: enable/disable toggle | Clickable ON/OFF badge | `apps/web/src/app/settings/page.tsx:151` (`:300`) | works |
| MC-116 | Schedule: remove entry | Trash control | `apps/web/src/app/settings/page.tsx:185` (`:334`) | works |
| MC-117 | Edit daemon configuration | `/settings` Configuration card | `apps/web/src/app/settings/page.tsx:131` (`:375-:491`, backendMode `:435`, failover `:449`) | works |
| MC-118 | Recent session history (last 20) | `/runs` session history | `apps/web/src/app/runs/page.tsx:351` (`:355, :359`) | works |
| MC-119 | skipPermissions banner + allowedTools tooltip | `/settings` read-only warnings | `apps/web/src/app/settings/page.tsx:543` (`:554, :559`) | works |

## Pages · Activity (`/activity`)

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-120 | Filter by actor | `/activity` actor select | `apps/web/src/app/activity/page.tsx:126`; e2e `apps/web/e2e/smoke.spec.ts:24` | works |
| MC-121 | Filter by event type | `/activity` type select | `apps/web/src/app/activity/page.tsx:138` | works |
| MC-122 | Grouped-by-date timeline | `groupByDate` feed | `apps/web/src/app/activity/page.tsx:57` (`:152`) | works |

## Pages · Checkpoints → `/settings/checkpoints`

`/checkpoints` still redirects (E-crawl redirect 5/8).

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-123 | Save workspace as checkpoint | `/settings/checkpoints` save | `apps/web/src/app/settings/checkpoints/page.tsx:95` (`:278`); e2e `apps/web/e2e/smoke.spec.ts:28` | works |
| MC-124 | Load checkpoint (replaces data) | `handleLoad` + confirm | `apps/web/src/app/settings/checkpoints/page.tsx:122` (`:62`) | works |
| MC-125 | Delete checkpoint (confirm) | `handleDelete` | `apps/web/src/app/settings/checkpoints/page.tsx:167` (`:63`) | works |
| MC-126 | Export checkpoint to JSON | Anchor download | `apps/web/src/app/settings/checkpoints/page.tsx:188` (`:364`) | works |
| MC-127 | Import checkpoint from JSON | Hidden file input | `apps/web/src/app/settings/checkpoints/page.tsx:199` (`:266, :273`) | works |
| MC-128 | Create fresh/empty workspace | `handleNewWorkspace` + confirm | `apps/web/src/app/settings/checkpoints/page.tsx:147` (`:258, :464`) | works |
| MC-129 | Checkpoint stat badges | Badge row | `apps/web/src/app/settings/checkpoints/page.tsx:322-:340` | works |

## Pages · Verification Run (`/verification/[id]`)

Ported whole and wired from four link sites; the family is **data-gated** — no verification run
exists in this checkout, so no instance can be crawled. E-crawl registers it with wiring proofs
(`conditionallyReached[1]`, `"ok": true`). The parent's own inventory flags this page as having
*no* in-app entry point at all (dead-UI finding #2) — ligma links it from Verify, Knowledge, the
task panel and the Deck, so the seam defect is fixed; only the data is missing.

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-130 | Tabbed report via URL state | Real `<Link>` tabs | `apps/web/src/app/verification/[id]/page.tsx:33` (`:25`); `apps/web/src/components/verification-report.tsx:31` | works — S1 re-triage (2026-08-13): booted the real daemon (`tsx src/server.ts`, no agent spawning) + `next dev` against this checkout's own `data/`, and hit the real page for a real complete run, `vrun_1786581439197`. All four tab URLs (`?tab=verdict\|timeline\|screenshots\|transcripts`) return HTTP 200, and the served HTML carries four real `role="tab"` `<Link>`s with correct `href`s and `aria-selected` toggling to the requested tab — not a stub. |
| MC-131 | Per-criterion verdict + reasoning + evidence + holdout badge | `VerificationReport` criteria list | `apps/web/src/components/verification-report.tsx:216` (`:244, :247, :233`) | works-pending-live — S1 re-triage (2026-08-13): the verdict+reasoning+evidence two-thirds of this row are proven — `vrun_1786581439197`'s `verdict.json` serves 8 real `criterionVerdicts`, each with multi-sentence reasoning and cited evidence paths (confirmed via `GET /api/verification-runs/:id`). The **holdout badge** third stays unexercised: journey contracts are compiled by `journeyCriteria()` (`apps/daemon/src/harness/run-journey.ts:103`), which never sets `holdout: true` on anything, so every real contract on file (`proj_ligma__d2a-design-loop.jsonl`, `proj_ligma__d1a-compose-promote.jsonl`) has 0 holdout criteria — confirmed via `GET /api/contracts/:scope?version=`. No unit test covers the badge either. Needs a **task**-scoped run (whose contract goes through `assignHoldouts`) to close. |
| MC-132 | Persona attempts table | `VerificationReport` attempts table | `apps/web/src/components/verification-report.tsx:275-:281` (seed tip `:290`); test `apps/web/__tests__/verification-ui.test.ts:70` | works — S1 re-triage (2026-08-13): `vrun_1786581439197`'s `personaReports` (5 real reports — naive-user-1 ×3, returning-user, spec-auditor) serve live via `GET /api/verification-runs/:id`, each with real `charter`, `personaSeed`, `stepCount`, `wrongTurns`, `elapsedMs` and `findings`. |
| MC-133 | Flight-recorder timeline with "went dark" gaps | `VerificationTimeline` | `apps/web/src/components/verification-timeline.tsx:26` (`:77, :87, :188`); test `apps/web/__tests__/verification-ui.test.ts:24` | works — S1 re-triage (2026-08-13): every persona's `steps.jsonl` for `vrun_1786581439197` serves 200 via `GET /api/verification-runs/:id/file?path=personas/<name>/steps.jsonl` (`application/x-ndjson`), real timestamped step records for the gap-detection logic to run over. |
| MC-134 | Timeline step → screenshot lightbox | `VerificationTimeline` lightbox | `apps/web/src/components/verification-timeline.tsx:202` (`:105`) | works — S1 re-triage (2026-08-13): the screenshots the lightbox opens are real and serve 200 (`image/png`) via the same `/file?path=` route, e.g. `personas/naive-user-1/shots/58-click.png` (268 KB), cross-referenced from real step records. |
| MC-135 | Screenshot grid by persona (cited vs all) | `VerificationReport` screenshots tab | `apps/web/src/components/verification-report.tsx:340` (`:337, :366, :352`) | works — S1 re-triage (2026-08-13): `GET /api/verification-runs/:id/artifacts` for `vrun_1786581439197` returns 200 with 166 real files (149 screenshots, 5 transcripts, 5 steps, 7 reports) grouped by persona — enough uncited evidence to actually exercise the "cited vs all" split this row names. |
| MC-136 | Human-decision-needed callouts | `verdict.humanDecisions` block | `apps/web/src/components/verification-report.tsx:378` (`:384`) | works — S1 re-triage (2026-08-13): `vrun_1786581439197`'s `verdict.json` carries 3 real `humanDecisions` entries (question + context, e.g. the shared-session-budget confound), served live. |
| MC-137 | Raw transcript links | Collapsible `.jsonl` links | `apps/web/src/components/verification-report.tsx:394` (`:404, :410`) | works — S1 re-triage (2026-08-13): every persona's `transcript.jsonl` serves 200 via the same `/file?path=` route (e.g. naive-user-1's, 449 KB, `application/x-ndjson`) — real CLI transcripts, not placeholders. |
| MC-138 | Compact inline mode | `compact` prop, used by the task panel | `apps/web/src/components/verification-report.tsx:76` (`:81`); `apps/web/src/components/task-detail-panel.tsx:76` | works-pending-live — S1 re-triage (2026-08-13): `compact` only changes whether the page-level heading renders (`verification-report.tsx:81`) — it shares 100% of the fetch/render code just proven live (MC-130…137). But its one real caller is the task panel, gated on a **task**-linked run (`taskId` set); every real run on file has `taskId: null` (journey runs), so the compact invocation itself is still never exercised end-to-end. Same narrow gap as MC-049. |

## Pages · Team (`/team/[role]`)

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-139 | Edit agent description inline | Click-to-edit | `apps/web/src/app/team/[role]/page.tsx:129` (`:176, :191`); e2e `apps/web/e2e/library.spec.ts:115` | works |
| MC-140 | Edit instructions/system prompt | Textarea + char count | `apps/web/src/app/team/[role]/page.tsx:119` (`:240, :247`) | works |
| MC-141 | Add/remove capability tags | Tag editor | `apps/web/src/app/team/[role]/page.tsx:139` (`:145, :287`) | works |
| MC-142 | Assign/unassign skills | Skill chips, each links into `/library/[id]` | `apps/web/src/app/team/[role]/page.tsx:148` (`:153, :311, :330`) | works |
| MC-143 | Task stats | Stat row | `apps/web/src/app/team/[role]/page.tsx:201-:220` | works |
| MC-144 | Assigned tasks by status + run inline | Grouped `TaskCard`s with `onRun` | `apps/web/src/app/team/[role]/page.tsx:350` (`:368, :378, :354`) | works |
| MC-145 | Recent messages / activity for agent | Two panels | `apps/web/src/app/team/[role]/page.tsx:396` (`:96, :424`) | works |
| MC-146 | Agent-not-found fallback | `not-found.tsx` with link to Crew | `apps/web/src/app/team/[role]/not-found.tsx:11` (`:16`) | works |

## Pages · Cross-cutting / Global UI

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-147 | Global sidebar navigation | Seven-destination rail + mobile drawer, deck/inbox badges | E-rail (`:69, :103, :123`); `apps/web/src/components/layout-shell.tsx:94`; e2e `apps/web/e2e/smoke.spec.ts:54`; test `apps/web/__tests__/nav.test.ts:34`; E-crawl | works |
| MC-148 | Command bar quick capture ("/" focuses) | `CommandBar` → `POST /api/brain-dump` | `apps/web/src/components/command-bar.tsx:55` (`:66`); `apps/web/src/components/layout-shell.tsx:48` | works |
| MC-149 | Slash-command autocomplete | `CommandBar` skill matching + "open Claude Code" notice | `apps/web/src/components/command-bar.tsx:30` (`:76, :232`) | works |
| MC-150 | Command bar inline task search | Selecting a match opens the task: `/board?task=<id>` pops the detail panel | `apps/web/src/components/command-bar.tsx:37`; `apps/web/src/components/layout-shell.tsx:84` (`recordHref`); `apps/web/src/components/board-view.tsx:183` (deep-link effect, shared by `/board` and `/board/matrix`) | works — repaired 2026-08-12 |
| MC-151 | Sidebar collapse/expand toggle | `CommandBar` toggle → `layout-shell` state | `apps/web/src/components/command-bar.tsx:102`; `apps/web/src/components/layout-shell.tsx:77` | works |
| MC-152 | Global search / command palette (Cmd+K) | `SearchDialog` over tasks/projects/goals/brain-dump; selection opens the record — task panel, project space, objective dialog | `apps/web/src/components/search-dialog.tsx:100` (`handleSelect` → `recordHref`); `apps/web/src/lib/nav.ts:94`; `apps/web/src/app/objectives/page.tsx:80`; test `apps/web/__tests__/nav.test.ts` ("opens the record, not its list") | works — repaired 2026-08-12; brain-dump entries stay on the capture list, which is the only surface they have |
| MC-153 | Keyboard shortcuts help dialog ("?") | `KeyboardShortcuts` | `apps/web/src/components/keyboard-shortcuts.tsx:63` (`:82`) | works |
| MC-154 | "G"+letter navigation shortcuts | 12 destinations remapped to ligma's IA (GD=Deck, GL=Library, GR=Runs) | `apps/web/src/components/keyboard-shortcuts.tsx:18-:31` (`:33, :54`) | works |
| MC-155 | Theme toggle (dark/light/system) | `ThemeToggle` in the rail footer | `apps/web/src/components/theme-toggle.tsx:14` (`:39, :46, :53`); mounted E-rail `:98` | works |
| MC-156 | First-visit onboarding walkthrough (3-step) | One non-modal `first-visit` hint, plus four later milestone hints | `apps/web/src/components/onboarding/onboarding-hint.tsx:29` (rationale `:10-12`); `apps/web/src/components/onboarding/hints.ts:23`; `apps/web/src/components/layout-shell.tsx:114`; e2e `apps/web/e2e/failure-onboarding.spec.ts:23`; unit `apps/web/src/components/onboarding/hints.test.ts` | waived — W-1 |
| MC-157 | Offline/connection-lost banner | `layout-shell` banner + `useConnection` | `apps/web/src/components/layout-shell.tsx:108` (`:111`); `apps/web/src/hooks/use-connection.ts:17` | works |
| MC-158 | Skip-to-content link | `layout-shell` skip link | `apps/web/src/components/layout-shell.tsx:71`; `apps/web/src/app/globals.css:200` (`:213`) | works |
| MC-159 | Per-page error boundary + auto-retry | `app/error.tsx` (3s countdown, stack, digest) | `apps/web/src/app/error.tsx:8` (`:56, :87, :89`) | works |
| MC-160 | Global error boundary + auto-reload | `app/global-error.tsx` (5s) | `apps/web/src/app/global-error.tsx:5` (`:53`) | works |
| MC-161 | Custom 404 page | `app/not-found.tsx` | `apps/web/src/app/not-found.tsx:11` (`:16`) | works |
| MC-162 | Route-level loading skeletons | Six `loading.tsx` files, same six routes re-homed | `apps/web/src/app/loading.tsx`, `inbox/loading.tsx`, `crew/loading.tsx`, `brain-dump/loading.tsx`, `board/loading.tsx:1`, `board/matrix/loading.tsx:1` | works |
| MC-163 | Toast notifications | `lib/toast.ts` + `sonner` `Toaster` | `apps/web/src/lib/toast.ts:3` (`:7, :11`); `apps/web/src/app/layout.tsx:6` (`:21`) | works |

## API

The parent's 58 `src/app/api/**/route.ts` handlers were ported route-by-route into
`apps/daemon/src/routes/**` (Express 5, `_id` for `[id]`), mounted through
`apps/daemon/src/routes/index.ts`; `apps/web` has no `app/api/**` at all and rewrites `/api/*`
to the daemon (`apps/web/next.config.ts:13`). E-p2 records the port as byte-identical in shape.
Every row below was re-opened and the described method + edge behaviour confirmed at the cited
line; nothing in this range is missing or degraded except the auth gate.

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-164 | Bearer-token gate on `/api/*` when `MC_API_TOKEN` set | None — no auth middleware exists in the mount chain | `apps/daemon/src/routes/adapter.ts` `mountRoute` goes req→handler with no check; no `MC_API_TOKEN` equivalent in `apps/daemon/src`. Compensating control: the daemon binds loopback only — `apps/daemon/src/server.ts:16` (`HOST = "127.0.0.1"`, `listen` `:40`) | waived — W-2 |
| MC-165 | `GET /api/activity-log` | Same | `apps/daemon/src/routes/activity-log/route.ts:7` | works |
| MC-166 | `POST /api/activity-log` | Same (agent/backend self-report) | `apps/daemon/src/routes/activity-log/route.ts:40` | works |
| MC-167 | `DELETE /api/activity-log` | Same | `apps/daemon/src/routes/activity-log/route.ts:62` | works |
| MC-168 | `GET /api/agents` | Same | `apps/daemon/src/routes/agents/route.ts:9` | works |
| MC-169 | `POST /api/agents` (+command-file regen, 409) | Same | `apps/daemon/src/routes/agents/route.ts:42` | works |
| MC-170 | `PUT /api/agents` | Same | `apps/daemon/src/routes/agents/route.ts:84` | works |
| MC-171 | `DELETE /api/agents` (soft/hard) | Same | `apps/daemon/src/routes/agents/route.ts:117` | works |
| MC-172 | `/api/brain-dump` full CRUD | Same | `apps/daemon/src/routes/brain-dump/route.ts:7` (`:41, :62, :80`) | works |
| MC-173 | `POST /api/brain-dump/automate` | Same; spawn target via `ENGINE_DIR` | `apps/daemon/src/routes/brain-dump/automate/route.ts:28` (`:69`); test `apps/daemon/__tests__/brain-dump-automate.test.ts` | works — repaired 2026-08-12, see MC-101 |
| MC-174 | `/api/checkpoints` list/save/delete | Same, id regex intact | `apps/daemon/src/routes/checkpoints/route.ts:11` (`:24, :74`, regex `:81`) | works |
| MC-175 | `GET /api/checkpoints/export` | Same | `apps/daemon/src/routes/checkpoints/export/route.ts:5` | works |
| MC-176 | `POST /api/checkpoints/import` | Same | `apps/daemon/src/routes/checkpoints/import/route.ts:5` | works |
| MC-177 | `POST /api/checkpoints/load` | Same (+fire-and-forget `gen:context`) | `apps/daemon/src/routes/checkpoints/load/route.ts:10` (`:26`) | works |
| MC-178 | `POST /api/checkpoints/new` | Same | `apps/daemon/src/routes/checkpoints/new/route.ts:84` | works |
| MC-179 | `GET /api/contracts/[scope]` | Same, `?version=`, traversal-guarded | `apps/daemon/src/routes/contracts/_scope/route.ts:25` (`:33, :57`); test `apps/daemon/__tests__/verification-api.test.ts` | works |
| MC-180 | `GET /api/daemon` (PID self-heal) | Same | `apps/daemon/src/routes/daemon/route.ts:44`; tests `daemon-route.test.ts`, `daemon-lifecycle.test.ts` | works |
| MC-181 | `POST /api/daemon` start | Same | `apps/daemon/src/routes/daemon/route.ts:82`; test `apps/daemon/__tests__/daemon-lifecycle.test.ts` | works |
| MC-182 | `POST /api/daemon` stop | Engine-loop stop; API keeps serving (parity restored, `docs/DECISIONS.md` Phase 2) | `apps/daemon/src/routes/daemon/route.ts:99`; test `apps/daemon/__tests__/daemon-lifecycle.test.ts` | works |
| MC-183 | `PUT /api/daemon` (403 on skipPermissions escalation) | Same | `apps/daemon/src/routes/daemon/route.ts:135` (403 `:143`); test `apps/daemon/__tests__/daemon-route.test.ts` | works |
| MC-184 | `GET /api/dashboard` batched aggregate | Same | `apps/daemon/src/routes/dashboard/route.ts:6`; test `apps/daemon/__tests__/dashboard-route.test.ts` | works |
| MC-185 | `GET /api/decisions` | Same | `apps/daemon/src/routes/decisions/route.ts:9` | works |
| MC-186 | `POST /api/decisions` | Same | `apps/daemon/src/routes/decisions/route.ts:44`; test `apps/daemon/__tests__/decision-deck.test.ts` | works |
| MC-187 | `PUT /api/decisions` | Same | `apps/daemon/src/routes/decisions/route.ts:86` | works |
| MC-188 | `PATCH /api/decisions` deck actions + undo journal | Same, plus a sibling `PATCH /api/decisions/bulk` (2026-08-13) answering N decisions atomically through the same journal | `apps/daemon/src/routes/decisions/route.ts:161` (journal `:153`, window `:157/:169`); test `apps/daemon/__tests__/decision-deck.test.ts`; bulk route `apps/daemon/src/routes/decisions/bulk/route.ts:59`, test `apps/daemon/__tests__/decisions-bulk-route.test.ts` | works — commit `bd19421` |
| MC-189 | `DELETE /api/decisions` | Same | `apps/daemon/src/routes/decisions/route.ts:252` | works |
| MC-190 | `GET /api/env-preflight` (cached) | Same | `apps/daemon/src/routes/env-preflight/route.ts:5` | works |
| MC-191 | `POST /api/env-preflight/fix` (closed enum) | Same, `z.enum(FIX_KINDS)` | `apps/daemon/src/routes/env-preflight/fix/route.ts:15` (`:12`); test `apps/daemon/__tests__/env-preflight.test.ts` | works |
| MC-192 | `/api/goals` list/create/update | Same | `apps/daemon/src/routes/goals/route.ts:7` (`:54, :80`) | works |
| MC-193 | `DELETE /api/goals` soft/hard + ref clearing | Same | `apps/daemon/src/routes/goals/route.ts:98` (`:101, :107, :121-127, :133`) | works |
| MC-194 | `/api/inbox` list/send/update | Same | `apps/daemon/src/routes/inbox/route.ts:7` (`:46, :71`) | works |
| MC-195 | `DELETE /api/inbox` | Same | `apps/daemon/src/routes/inbox/route.ts:93` | works |
| MC-196 | `POST /api/inbox/respond` | Same, spawn path via `ENGINE_DIR` | `apps/daemon/src/routes/inbox/respond/route.ts:35` (`:75`) | works |
| MC-197 | `GET /api/logs` (capped 500) | Same | `apps/daemon/src/routes/logs/route.ts:10` (`:8`) | works |
| MC-198 | `/api/projects` list/create/update (+backfill) | Same | `apps/daemon/src/routes/projects/route.ts:10` (`:22, :54, :80`) | works |
| MC-199 | `DELETE /api/projects` soft/hard | Same | `apps/daemon/src/routes/projects/route.ts:98` (`:101, :128-142`) | works |
| MC-200 | `POST /api/projects/[id]/run` bulk launch | Same, launched/skipped/queued | `apps/daemon/src/routes/projects/_id/run/route.ts:35` (`:119-125`) | works |
| MC-201 | `GET /api/runs` (dead-PID heal, session merge) | Same | `apps/daemon/src/routes/runs/route.ts:22` (`:28-47, :54`) | works |
| MC-202 | `GET /api/runs/[id]/output` byte-offset stream | Same (+ SSE sibling `/stream`, E-p2) | `apps/daemon/src/routes/runs/_id/output/route.ts:31` (`:8, :104-108`); test `apps/daemon/__tests__/http-adapter.test.ts` | works |
| MC-203 | `POST /api/seed-demo` | Same | `apps/daemon/src/routes/seed-demo/route.ts:7` | works |
| MC-204 | `GET /api/sidebar` badge polling | Same | `apps/daemon/src/routes/sidebar/route.ts:7`; test `apps/daemon/__tests__/sidebar-decisions-badge.test.ts` | works |
| MC-205 | `GET /api/skills` | Same | `apps/daemon/src/routes/skills/route.ts:10` | works |
| MC-206 | `POST /api/skills` (+markdown + command regen) | Same | `apps/daemon/src/routes/skills/route.ts:43` | works |
| MC-207 | `PUT /api/skills` (re-sync both sides) | Same | `apps/daemon/src/routes/skills/route.ts:91` | works |
| MC-208 | `DELETE /api/skills` (re-sync referrers) | Same | `apps/daemon/src/routes/skills/route.ts:135` | works |
| MC-209 | `POST /api/sync` full regeneration | Same | `apps/daemon/src/routes/sync/route.ts:10` | works |
| MC-210 | `GET /api/tasks` token-optimized query | Same, sparse `fields=`, `include=archived`, pagination | `apps/daemon/src/routes/tasks/route.ts:184` (`:199, :259`) | works |
| MC-211 | `POST /api/tasks` (+delegation notice) | Same | `apps/daemon/src/routes/tasks/route.ts:281` | works |
| MC-212 | `PUT /api/tasks` (+unblock cascade) | Same | `apps/daemon/src/routes/tasks/route.ts:330` (`:104, :130`); test `apps/daemon/__tests__/tasks-route.test.ts` | works |
| MC-213 | `DELETE /api/tasks` soft/hard | Same | `apps/daemon/src/routes/tasks/route.ts:375` (`:378`) | works |
| MC-214 | `POST /api/tasks/[id]/run` | Same, all five preconditions | `apps/daemon/src/routes/tasks/_id/run/route.ts:36`; test `apps/daemon/__tests__/run-route.test.ts` | works |
| MC-215 | `GET /api/tasks/archive` | Same | `apps/daemon/src/routes/tasks/archive/route.ts:7` | works |
| MC-216 | `POST /api/tasks/archive` bulk-archive | Same | `apps/daemon/src/routes/tasks/archive/route.ts:49` | works |
| MC-217 | `PUT /api/tasks/bulk` atomic | Same | `apps/daemon/src/routes/tasks/bulk/route.ts:5` | works |
| MC-218 | `DELETE /api/tasks/bulk` atomic | Same | `apps/daemon/src/routes/tasks/bulk/route.ts:35` | works |
| MC-219 | `GET /api/verification-runs` | Same | `apps/daemon/src/routes/verification-runs/route.ts:18`; tests `verification-api.test.ts`, `verification-runs-listing.test.ts` | works |
| MC-220 | `GET /api/verification-runs/[id]` | Same | `apps/daemon/src/routes/verification-runs/_id/route.ts:11`; test `verification-api.test.ts` | works |
| MC-221 | `.../artifacts` recursive listing | Same, capped, symlinks skipped | `apps/daemon/src/routes/verification-runs/_id/artifacts/route.ts:50` (`:21, :38`) | works |
| MC-222 | `.../file` streaming with double path safety | Same, `safeResolve` + realpath re-check | `apps/daemon/src/routes/verification-runs/_id/file/route.ts:15` (`:32-33, :48`) | works |

## Daemon / CLI

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-223 | `daemon:start` | `pnpm --filter @ligma/daemon daemon:start` → `handleStart()` | `apps/daemon/package.json:10`; `apps/daemon/src/engine/index.ts:120` | works |
| MC-224 | `daemon:stop` | `handleStop()` (SIGTERM + stale PID cleanup) | `apps/daemon/package.json:11`; `apps/daemon/src/engine/index.ts:98` | works |
| MC-225 | `daemon:status` | `handleStatus()` | `apps/daemon/package.json:12`; `apps/daemon/src/engine/index.ts:73` | works |
| MC-226 | Graceful shutdown on SIGINT/SIGTERM | `shutdown()` / `stopEngine()` incl. tree-kill + task reset | `apps/daemon/src/engine/index.ts:155` (`:167-168`); `apps/daemon/src/engine/lifecycle.ts:185-217` | works |
| MC-227 | Config hot-reload (60s) | Maintenance interval | `apps/daemon/src/engine/lifecycle.ts:31` (`:145-158`) | works |
| MC-228 | Full pnpm script surface | Split across root / `apps/daemon` / `apps/web` manifests; every parent script has a home (`verify` lives in `apps/web`) | `package.json:19-34`; `apps/daemon/package.json:6-22`; `apps/web/package.json:6-16` | works — surface conserved, re-homed by the monorepo split (E-p1 §5) |
| MC-229 | `governor:status` CLI quota table | Same | `apps/daemon/package.json:13`; `apps/daemon/src/engine/governor-status.ts:9-28` | works |
| MC-230 | Config load/validate/save | Same, `structuredClone` against `DEFAULT_CONFIG` | `apps/daemon/src/engine/config.ts:11` (`:72, :250, :277`) | works |
| MC-231 | Config caching (mtime+size) | Same | `apps/daemon/src/engine/config-cache.ts:23` (`:32`) | works |
| MC-232 | Per-role tool grants | `toolsForRole` | `apps/daemon/src/engine/config.ts:303` | works |
| MC-233 | Per-role deny rules (holdout protection) | `denyRulesForRole` | `apps/daemon/src/engine/config.ts:320` | works |
| MC-234 | Concurrency enforcement | `maxParallelAgents` gates dispatch + verification | `apps/daemon/src/engine/dispatcher.ts:596` (`:657, :718, :951`) | works |
| MC-235 | Retry with exponential backoff (persisted queue) | Same | `apps/daemon/src/engine/dispatcher.ts:31` (`:111-116`) | works |
| MC-236 | Retry attempt cap | `getRetryCount` + dispatch skip | `apps/daemon/src/engine/health.ts:158`; `apps/daemon/src/engine/dispatcher.ts:581-583` | works |
| MC-237 | Stale in-progress reconciliation | `reconcileStaleInProgressTasks` | `apps/daemon/src/engine/dispatcher.ts:450` | works |
| MC-238 | Dependency/decision gating | `isTaskUnblocked`, `hasBlockingPendingDecision` | `apps/daemon/src/engine/prompt-builder.ts:503` (`:540`); `dispatcher.ts:569, :575` | works |
| MC-239 | Cron scheduling of the four commands | Same crons, node-cron | `apps/daemon/src/engine/config.ts:20-23`; `apps/daemon/src/engine/scheduler.ts:12` (`:58`) | works |
| MC-240 | Task polling loop | `pollAndDispatch` | `apps/daemon/src/engine/dispatcher.ts:513`; `scheduler.ts:37` | works |
| MC-241 | Scheduled-command execution | `runScheduledCommand` + `buildScheduledPrompt` | `apps/daemon/src/engine/dispatcher.ts:993`; `prompt-builder.ts:426` | works |
| MC-242 | Cross-process file locking | `withFileLock` (atomic mkdir mutex) | `apps/daemon/src/engine/file-lock.ts:33` | works |
| MC-243 | Credential scrubbing | `scrubCredentials` | `apps/daemon/src/engine/security.ts:40` | works |
| MC-244 | Path-traversal validation | `validatePathWithinWorkspace` | `apps/daemon/src/engine/security.ts:54` | works |
| MC-245 | Prompt-injection fencing | `fenceTaskData` | `apps/daemon/src/engine/security.ts:80` | works |
| MC-246 | Prompt size limit (100KB) | `enforcePromptLimit` | `apps/daemon/src/engine/security.ts:88` | works |
| MC-247 | Binary allowlist | `ALLOWED_BINARIES` / `validateBinary` | `apps/daemon/src/engine/security.ts:99` (`:107`) | works |
| MC-248 | Safe child-process env | `buildSafeEnv` | `apps/daemon/src/engine/security.ts:118` | works |
| MC-249 | Health monitoring / session tracking | `HealthMonitor` | `apps/daemon/src/engine/health.ts:24` | works |
| MC-250 | Stale-session detection | `cleanStaleSessions` | `apps/daemon/src/engine/health.ts:185` | works |
| MC-251 | Quota-deferred session bookkeeping | `deferSession` | `apps/daemon/src/engine/health.ts:120` | works |
| MC-252 | Log rotation | `rotateIfNeeded` | `apps/daemon/src/engine/logger.ts:15` | works |
| MC-253 | Leveled/tagged logging incl. SECURITY | `DaemonLogger` | `apps/daemon/src/engine/logger.ts:42` (`:46`) | works |
| MC-254 | Append-only run-output capture | `OutputWriter` (scrub per chunk, 72h prune) | `apps/daemon/src/engine/output-writer.ts:20` (`:42, :55`) | works |
| MC-255 | Task prompt construction | `buildTaskPrompt` | `apps/daemon/src/engine/prompt-builder.ts:404` | works |
| MC-256 | Verification-failure feedback loop | `buildVerificationFeedback` | `apps/daemon/src/engine/prompt-builder.ts:216` | works |
| MC-257 | Subtask-progress protocol | `parseCompletedSubtaskIds` | `apps/daemon/src/engine/prompt-builder.ts:453` | works |
| MC-258 | Multi-backend CLI auto-detection | `findCliBinary` | `apps/daemon/src/engine/runner.ts:78` | works |
| MC-259 | Backend probing on start | `probeBackend` | `apps/daemon/src/engine/runner.ts:390`; `index.ts:54-68` | works |
| MC-260 | Restriction-aware argv building | `decideBackend` / `buildArgs` | `apps/daemon/src/engine/runner.ts:232` (`:303`) | works |
| MC-261 | Spawn + timeout/tree-kill | `spawnAgent` / `killSession` | `apps/daemon/src/engine/runner.ts:420` (`:553`, tree-kill `:10`) | works |
| MC-262 | `run-task.ts <taskId>` standalone CLI | Same, still spawned detached by both run routes | `apps/daemon/src/engine/run-task.ts:369` (`:395, :754`); callers `routes/tasks/_id/run/route.ts:147`, `routes/projects/_id/run/route.ts:91` | works |
| MC-263 | `run-inbox-respond.ts <messageId>` | Same | `apps/daemon/src/engine/run-inbox-respond.ts:437` (`:449`) | works |
| MC-264 | `run-brain-dump-triage.ts <entryId...>` | Same faithful standalone entrypoint, now reachable from its caller | `apps/daemon/src/engine/run-brain-dump-triage.ts:174` (`:186`); caller `apps/daemon/src/routes/brain-dump/automate/route.ts:69`; the test asserts the spawn target exists on disk | works — repaired 2026-08-12, see MC-101 |
| MC-265 | `pnpm seed:demo` | Same | `apps/daemon/package.json:15`; `apps/daemon/scripts/seed-demo.ts:1-9` | works |
| MC-266 | `pnpm gen:context` (omits criteria) | Same, holdout-leak comment intact | `apps/daemon/package.json:16`; `apps/daemon/scripts/generate-context.ts:96` (`:18, :295`) | works |
| MC-267 | Verification-status migration | Same, idempotent | `apps/daemon/scripts/migrate-verification-status.ts:25` (`:30, :44`) | works |
| MC-268 | Crew task bulk-create script | Same | `apps/daemon/scripts/create-crew-tasks.mjs:1-5` | works |
| MC-269 | Branch-protection setup script | Reads the repo from *this* checkout's GitHub remote (`gh repo view`), overridable with `REPO_SLUG` / `BRANCH`; exits 1 with an explicit message when there is no remote to resolve | `scripts/setup-branch-protection.sh:15-22` | works — repaired 2026-08-12; like the parent's, it configures its own repository, and now it cannot configure anyone else's by accident |
| MC-270 | Brain-dump triage script (empty file) | Same empty file, faithfully dead | `apps/daemon/scripts/triage-bd.js` (0 bytes) | works — parity with a parent no-op |
| MC-271 | Start/stop scripts (macOS/Linux) | Same, port 3000 still matches `apps/web` | `apps/web/start-mission-control.sh:1-79`; `apps/web/stop-mission-control.sh:19-65` | works |
| MC-272 | Start/stop scripts (Windows) | Same | `apps/web/start-mission-control.bat:16` (`:26`); `apps/web/stop-mission-control.bat:16-43` | works |

## Engine

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-273 | Backend modes claude/codex/gemini/mixed | Same union + `resolveBackendForTask` | `apps/daemon/src/engine/types.ts:88-92`; `dispatcher.ts:391` | works |
| MC-274 | Governor role-routing overrides mode | Same | `apps/daemon/src/engine/dispatcher.ts:391-397` (`:414-419`) | works |
| MC-275 | Consecutive-failure auto-failover rotation | `BACKEND_ROTATION` + `recordBackendOutcome` | `apps/daemon/src/engine/dispatcher.ts:66` (`:352, :381`) | works |
| MC-276 | Per-attempt fallback chain | `spawnTaskWithFallback`, each hop re-passes the governor | `apps/daemon/src/engine/dispatcher.ts:188`; `run-task.ts` | works |
| MC-277 | Restriction-aware backend skipping | `canBackendHonorRestrictions` (fails closed) | `apps/daemon/src/engine/runner.ts:272` | works |
| MC-278 | Deny-rule expressiveness warning | `warnUnexpressibleDeny` | `apps/daemon/src/engine/runner.ts:294` | works |
| MC-279 | Per-backend settings | `DaemonConfig.execution` | `apps/daemon/src/engine/types.ts:88-96` | works |
| MC-280 | Rolling window + reserve floor + kill switch | Same | `apps/daemon/src/engine/quota-governor.ts:123` (`:172, :177`) | works |
| MC-281 | Atomic race-safe `claimSpawn` | Same | `apps/daemon/src/engine/quota-governor.ts:297` | works |
| MC-282 | Backend cooling/backoff | `coolingBackoffMs` | `apps/daemon/src/engine/quota-governor.ts:134` | works |
| MC-283 | Role→backend routing overrides | `resolveRoleBackend` | `apps/daemon/src/engine/quota-governor.ts:264` | works |
| MC-284 | Waiting vs aborting semantics | `awaitClaimedSlot` (20min harness wait) | `apps/daemon/src/harness/spawn-slot.ts:20` (`:23`) | works |
| MC-285 | Backend-aware window accounting | `decide()` | `apps/daemon/src/engine/quota-governor.ts:191-193` (`:204`) | works |
| MC-286 | Create ephemeral env (worktree off a dangling snapshot) | `createEnv` | `apps/daemon/src/env/lifecycle.ts:98` | works |
| MC-287 | Teardown ephemeral env | `teardownEnv` | `apps/daemon/src/env/lifecycle.ts:212` | works |
| MC-288 | List envs / manifest with per-phase timings | `listEnvs` + manifest | `apps/daemon/src/env/manifest.ts:50`; `lifecycle.ts:86` | works |
| MC-289 | Reconcile orphaned envs | `findDeadEnvs`, `reconcileOrphans`, `orphanWorktreeDirs` | `apps/daemon/src/env/manifest.ts:112` (`:118`); `preflight.ts:183` | works |
| MC-290 | Mission Control target adapter | Ported verbatim, plus a generalized `createBootAdapter` preferred when a boot recipe exists | `apps/daemon/src/env/mission-control-adapter.ts:366`; `apps/daemon/src/env/boot-adapter.ts:63`; chosen at `lifecycle.ts:107` | works |
| MC-291 | Deterministic seeded dataset (PRNG) | `makeRng` / `generateSeedData` | `apps/daemon/src/env/mission-control-adapter.ts:73` (`:147`) | works |
| MC-292 | Free-port allocation | `getFreePort` | `apps/daemon/src/env/mission-control-adapter.ts:45` | works |
| MC-293 | Environment preflight checks | `runPreflight` | `apps/daemon/src/env/preflight.ts:522` | works |
| MC-294 | One-click preflight fixes (closed enum) | `FIX_KINDS` / `applyPreflightFix` | `apps/daemon/src/env/preflight.ts:38` (`:587`) | works |
| MC-295 | `pnpm env:acceptance` | Same | `apps/daemon/package.json:14`; `apps/daemon/src/env/acceptance-phase1.ts:69` | works |
| MC-296 | Mutation/fault-injection hook | `CreateEnvOptions.mutate` + shipped mutation module | `apps/daemon/src/env/lifecycle.ts:52` (`:153`); `apps/daemon/src/harness/mutations/drop-notes-field.ts` | works |

## Harness

Ported into `apps/daemon/src/harness/**`. Suite counts at phase close: E-p4 (daemon 787 unit /
118 integration). Live-model behaviour of the panel and judge is exercised for the first time by
chains **d1**/**d2**; the machinery below is exercised now by the stub-mode integration suites
recorded in E-p3 (headless journey 9/9, D1 skeleton 10/10).

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| MC-297 | Deterministic contract compilation | `compileDeterministicContract` | `apps/daemon/src/harness/compile-contract.ts:292`; tests `harness-contract.test.ts`, `integration/pipeline-fixes.test.ts` | works |
| MC-298 | LLM contract compilation | `compileWithLlm` (parse failure fatal) | `apps/daemon/src/harness/compile-contract.ts:193` — no unit test; LLM-only path | works-pending-live — S1 re-triage (2026-08-13), **and the "chain d1" premise was wrong, not just unmet**: `compileWithLlm` (`compile-contract.ts:193`) is a private, unexported function called only from this file's own CLI `main()` (`--llm` flag) — no route, no promote path, no production caller reaches it. The live promote flow compiles through `compilePromotedContract` instead (`apps/daemon/src/studio/promote.ts:402`), from criteria already phrased upstream by the promote planner; that is a different function with different inputs. New evidence added regardless, because it is real: `apps/daemon/__tests__/compiled-contract-fixture.test.ts` + `apps/daemon/__tests__/fixtures/contracts/proj_ligma__d1a-compose-promote-v3.jsonl` (v3 of a real, live-signed contract from run `vrun_1786588762600`) prove the shared `AcceptanceContract` schema and Ed25519 sign/verify pipeline hold end-to-end on real data — 4/4 passing. That closes the schema half of this capability but not the row: `compileWithLlm` itself remains completely unreachable from any live path and still has zero unit or live exercise. No chain — d1 or otherwise — will exercise it as written; it needs either wiring into a real call site or an explicit waiver, not another wait. Flagged for D7 re-triage rather than resolved here (out of S1's file-ownership scope). |
| MC-299 | Holdout withholding (~30%) | `assignHoldouts`, deterministic sha256 split | `apps/daemon/src/harness/compile-contract.ts:79`; test `harness-contract.test.ts` ("holdout assignment") | works |
| MC-300 | Append-only signed contract store | `saveContract` / `getLatestContract` / `verifyContract` | `apps/daemon/src/harness/contract-store.ts:56` (`:78, :95`); test `harness-contract.test.ts` | works |
| MC-301 | Ed25519 keypair generation & persistence | `getOrCreateSigningKey` | `apps/daemon/src/harness/signing.ts:37`; test `harness-contract.test.ts` | works |
| MC-302 | Ed25519 signing of contracts | `sign` | `apps/daemon/src/harness/signing.ts:91`; test `harness-contract.test.ts:57-70` | works |
| MC-303 | Signature verification fails loud | `verify` | `apps/daemon/src/harness/signing.ts:114`; test `harness-contract.test.ts:65-90` | works |
| MC-304 | Judge verifies contract signature first | `runJudge` signature check → signed `error` | `apps/daemon/src/harness/judge.ts:348`; test `harness-judge-error.test.ts:120` | works |
| MC-305 | Ed25519-signed verdicts | `signVerdict` | `apps/daemon/src/harness/judge.ts:342`; test `harness-judge-error.test.ts` | works |
| MC-306 | Naive-user persona ×N seeded | `NAIVE_SEEDS` | `apps/daemon/src/harness/personas.ts:32`; test `harness-panel.test.ts:322` | works |
| MC-307 | Saboteur persona | Charter retained (+per-transport playbooks) | `apps/daemon/src/harness/panel.ts:96`; test `harness-consumer-panel.test.ts:144` | works |
| MC-308 | Returning-user persona | Charter retained | `apps/daemon/src/harness/panel.ts:98`; test `harness-consumer-panel.test.ts:150` | works |
| MC-309 | Visual-critic persona | Charter retained | `apps/daemon/src/harness/panel.ts:101`; test `harness-consumer-panel.test.ts:144` | works |
| MC-310 | Spec-auditor persona | Charter retained | `apps/daemon/src/harness/panel.ts:74`; test `harness-consumer-panel.test.ts:150` | works |
| MC-311 | Smoke-test mode | Same selection rule | `apps/daemon/src/harness/panel.ts:89`; test `harness-panel.test.ts:322` | works |
| MC-312 | Persona isolation & Bash-only tooling | `personaToolGrant` / `runPersona` | `apps/daemon/src/harness/personas.ts:82` (`:721`); test `harness-consumer-panel.test.ts:57-91` | works |
| MC-313 | Concurrent personas, cancellation-safe | `mapWithLimit` | `apps/daemon/src/harness/run-verification.ts:93`; test `harness-pool.test.ts` | works |
| MC-314 | Fail-default judge logic | `parseJudgeOutput` / `computeOutcome` | `apps/daemon/src/harness/judge.ts:266` (`:314`); test `harness-panel.test.ts:192-300` | works |
| MC-315 | Judge-model ≠ builder-model | `assertJudgeModel` | `apps/daemon/src/harness/judge.ts:66`; test `harness-panel.test.ts:301-320` | works |
| MC-316 | Judge prompt degradation under cap | `buildJudgePrompt` / `dropOrder` | `apps/daemon/src/harness/judge.ts:217` (`:112`); test `harness-prompt-guards.test.ts:62-131` | works |
| MC-317 | Harness-error vs product-failure | `harnessError` → signed `error` | `apps/daemon/src/harness/judge.ts:355`; test `harness-judge-error.test.ts`; E-seam rule 4 | works |
| MC-318 | Single choke point for `kanban: "done"` | `applyVerdict` | `apps/daemon/src/harness/verdict.ts:307`; test `integration/harness-verdict.test.ts` | works |
| MC-319 | Attempt cap with escalation | `maxVerificationAttempts` | `apps/daemon/src/harness/verdict.ts:76`; tests `harness-spawn-slot.test.ts:82-83`, `integration/pipeline-fixes.test.ts:260-304` | works |
| MC-320 | Stale/killed run reclamation | `isRunLive` / `sweepStaleVerificationRuns` | `apps/daemon/src/harness/verdict.ts:478` (`:519`); test `integration/pipeline-fixes.test.ts:174-213` | works |
| MC-321 | Evidence locker layout | Same on-disk layout, per-persona dirs | `apps/daemon/src/harness/run-verification.ts:245` (`:352-353`); `bridge-server.ts:64-75`; test `harness-bridge.test.ts:149` | works |
| MC-322 | Evidence retention/pruning (72h) | `pruneVerificationEvidence` | `apps/daemon/src/harness/verdict.ts:601`; test `integration/pipeline-fixes.test.ts:214-231` | works |
| MC-323 | End-to-end run orchestration | `runVerification` / `main` | `apps/daemon/src/harness/run-verification.ts:190` (`:402`); tests `integration/greenfield-d1.test.ts`, `integration/headless-journey.test.ts` | works |
| MC-324 | Structured CLI-output parsing | `unwrapCliReply` / `extractFencedJson` | `apps/daemon/src/harness/personas.ts:532` (`:515`); test `harness-panel.test.ts:60-93` | works |
| MC-325 | Governed spawn-slot waiting | `awaitClaimedSlot` | `apps/daemon/src/harness/spawn-slot.ts:23`; test `harness-spawn-slot.test.ts:46-80` | works |
| MC-326 | Kill-switch pre-check before booting an env | Same check before `createEnv` | `apps/daemon/src/harness/run-verification.ts:201` — code read and confirmed; no dedicated test (the governor's spawn-level fallback is tested at `integration/pipeline-fixes.test.ts:305-337`) | works |
| MC-327 | Capability-URL bridge (shared Chromium) | `startBridge` + shared `serveBridge` core, now with HTTP and PTY siblings | `apps/daemon/src/harness/browser-bridge.ts:148`; `bridge-server.ts:174`; tests `harness-bridge.test.ts`, `harness-http-bridge.test.ts`, `harness-pty-bridge.test.ts` | works |
| MC-328 | Bridge action surface (14 actions) | `perform()` — all fourteen present | `apps/daemon/src/harness/browser-bridge.ts:189-267`; test `harness-bridge.test.ts` | works |
| MC-329 | Origin lockdown (403 off-origin) | `resolveUrl` | `apps/daemon/src/harness/browser-bridge.ts:153`; test `harness-bridge.test.ts:73-98` | works |
| MC-330 | Auth/host hardening | `tokenMatches` / `isLoopbackHost` in the shared core | `apps/daemon/src/harness/bridge-server.ts:164` (`:157`); test `harness-bridge.test.ts:168-231` | works |
| MC-331 | Automatic evidence capture | `recordStep` + `AUTO_SHOT` | `apps/daemon/src/harness/bridge-server.ts:91`; `browser-bridge.ts:144`; test `harness-bridge.test.ts:100-148` | works |
| MC-332 | Fault-injection mutation testing | `--mutate` → `loadMutation` + shipped mutation | `apps/daemon/src/harness/run-verification.ts:142-147` (`:150`); `mutations/drop-notes-field.ts:23` — code read and confirmed; no dedicated test | works |

---

# Part 2 — Open Design (OD-001 … OD-171)

## Scope rule for this half

Ligma's product faces are **`apps/daemon`** (the product), **`apps/web`** and **`apps/cli`**
(merger spec: "daemon-centric; web/cli are faces over one HTTP+SSE API"). **`apps/desktop`** is
ligma-classic's Electron app, imported with history in Phase 1 (E-p1 §5) and never wired to the
daemon — verified: zero references to `127.0.0.1:4477` or `@ligma/api` anywhere under
`apps/desktop/src`. Code that exists only there is inherited, not reachable from ligma the
product, so it never earns `works` — the seam rule in brief §3 ("every feature reachable from the
rail or pipeline strip") is exactly the rule open-design broke. Where a row's only implementation
is desktop-side, the row says so. Two families were desktop-only at the first pass: the exporters,
which are portable and were wired into the daemon on 2026-08-12 (§M), and the BYOK provider UI,
which stays desktop-side and is waived pending Alex's sign-off (W-43).

Open-design's own **ORPHANED** rows are answered on capability, not on the orphan: ligma owes the
capability, and owes it *reachable*. Where the parent's entry point was disabled by a feature flag
(OD-135, OD-136), no capability was reachable in the parent either — OD-135 shipped anyway
(commit `47859a0`, a command console over ligma's own PTY bridge); OD-136 stays waived on that
basis, stated in the row.

## A. Routing & top-level pages

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-001 | Deep-linkable client-side routing with back/forward | Next.js App Router file routes; every surface has a real URL | `apps/web/src/app/**` (35 route files); E-crawl reached 37 pathnames incl. dynamic families | works |
| OD-002 | Home / entry landing page | `/` — kickoff composer + recents + attention | `apps/web/src/app/page.tsx:285`; e2e `apps/web/e2e/product-flows.spec.ts:50` | works |
| OD-003 | Onboarding wizard page (`/onboarding`) | None — replaced by milestone one-shot hints | `apps/web/src/components/onboarding/hints.ts:22` (see OD-085) | waived — W-3 |
| OD-004 | Projects list page | `/projects` | `apps/web/src/app/projects/page.tsx:1`; E-crawl | works |
| OD-005 | Project/Studio deep route incl. conversation + file | `/projects/[id]/studio?session=&file=` opens that design focused on that file — same idiom as board's `?task=` | `apps/web/src/app/projects/[id]/studio/deep-link.ts:49` (`parseStudioDeepLink`); wired `apps/web/src/components/studio/studio-surface.tsx:115` (`:146` session, `:167` file); test `deep-link.test.ts` | works — commit `ba29df0` |
| OD-006 | **Automations page** (ORPHANED in parent) | `/settings` Schedule card + journey smoke schedules | `apps/web/src/app/settings/page.tsx:178`; `apps/daemon/src/engine/smoke.ts:75` | waived — W-5 (argued mapping) |
| OD-007 | Plugin marketplace / catalog tab | Skill-catalog tab's facet bar (Kind filter + Saved-only), over the vendored `skills/` tree | `apps/web/src/app/library/page.tsx:425` (facet fetch), `:482` (`FacetBar`); `apps/web/src/components/library/facet-bar.tsx:1` | works — commit `5cf020a`; a plugin marketplace needs a second party to publish to it (W-6's remaining rows: install-from-elsewhere, community, publishing/registry stay waived) |
| OD-008 | Marketplace catalog + detail routes | `GET /api/skill-catalog` list + `GET /api/skill-catalog/:id` detail, now with facets and use-tracking riding alongside | `apps/daemon/src/routes/library-meta/route.ts:12`; `apps/daemon/src/routes/library-meta/facets/route.ts:53`; `apps/web/src/app/library/page.tsx:400` (`SkillCatalogTab`) | works — commit `5cf020a` |
| OD-009 | Design systems catalog tab | `/library` design-systems catalog | `apps/web/src/app/library/page.tsx:3`; e2e `apps/web/e2e/library.spec.ts:23` | works |
| OD-010 | Design system creation wizard (Figma import, connector sync) | `/library/new-design-system` wizard: token form → `POST .../wizard/create-from-tokens` writes the exact vendored triad (`manifest.json` w/ `authored: true`, `tokens.css`, `DESIGN.md`), served by the unchanged read-only catalog route | `apps/web/src/app/library/new-design-system/page.tsx:1`; `apps/daemon/src/routes/design-systems/wizard/create-from-tokens/route.ts:47`; `_lib.ts:241` (`occupantOf`, vendored ids refused even with overwrite), `:348` (`authored` marker); test `apps/daemon/__tests__/design-system-wizard.test.ts` | works — commit `3960e4a`; CITE HONESTLY: no Figma OAuth import (`new-design-system/page.tsx:11`, stated non-goal — "export your Figma variables to CSS and paste the values here instead") and no connector sync; no revision history — create-then-overwrite-with-confirm only, no versions kept (`page.tsx:384`) |
| OD-011 | Design system detail page | Detail **pane** in the master–detail shell (no separate URL) | `apps/web/src/components/library/design-system-detail.tsx:23`; e2e `apps/web/e2e/library.spec.ts:30` | works |
| OD-012 | `/brands` legacy deep-links | None — ligma never had brands | — | waived — W-8 (no predecessor to redirect) |
| OD-013 | Community template gallery | None | — | waived — W-6 |
| OD-014 | Integrations page | `/settings/integrations`, linked from Settings | `apps/web/src/app/settings/integrations/page.tsx:13`; link `apps/web/src/app/settings/page.tsx:686` | works — commit `8b5d465` |
| OD-015 | Settings as a full page | `/settings` is a page, never a modal | `apps/web/src/app/settings/page.tsx:1`; E-crawl | works |
| OD-016 | Library UI (**flag-off in parent**) | `/library` shipped visible, on the rail | `apps/web/src/app/library/page.tsx:1`; E-rail; e2e `apps/web/e2e/library.spec.ts:23` | works — parity **+**: reachable here, dead code there |
| OD-017 | Collab demo surface | None | inventory `docs/parity/open-design-capabilities.md:38` marks MULTI-USER | waived-multiuser |
| OD-018 | Desktop Pet overlay route | None | — | waived — W-10 |
| OD-019 | Drafts / All-projects / Members / Board / Workspace-settings | None | inventory `docs/parity/open-design-capabilities.md:40` marks MULTI-USER | waived-multiuser |

## B. Kickoff / hero composer

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-020 | Free-form prompt box on Home | Kickoff composer, prompt-first (pinned default) | `apps/web/src/components/kickoff-composer.tsx:32`; e2e `apps/web/e2e/product-flows.spec.ts:50` | works |
| OD-021 | Scenario chip rail | Five project-kind chips (Web app / API service / CLI tool / Library / Automation) | `apps/web/src/lib/composer.ts:16` | works — chips seed the brief; they bind no plugin because ligma has no plugin system (W-6) |
| OD-022 | Second-level sub-category chips | Sub-chip rail under a chosen project kind, seeding the prompt on pick | `apps/web/src/lib/composer.ts:114` (`subChipsForKind`); `apps/web/src/components/composer-sub-chips.tsx:14`; test `composer.test.ts` | works — commit `ba29df0` |
| OD-023 | Design-system picker in composer footer | Picker lives at Studio session start instead | `apps/web/src/components/studio/studio-surface.tsx:343`; rationale `apps/web/src/components/kickoff-composer.tsx:28` | waived — W-12 (**accepted P3-E waiver**, `docs/DECISIONS.md` Phase 3) |
| OD-024 | Radial template picker | Icon-first dropdown template picker over the 5 project kinds — deliberately not the reference's hover-tracked SVG wheel | `apps/web/src/components/composer-template-picker.tsx:36` (`ComposerTemplatePicker`, `ponytail` note above it) | works — commit `ba29df0`; re-skinned to the existing `DropdownMenu` primitive, same 5-way choice |
| OD-025 | Example-prompt placeholder carousel | Slow rotating placeholder pool per kind, paused once there is real input | `apps/web/src/components/composer-placeholder-carousel.tsx:19` (`useRotatingPlaceholder`); `apps/web/src/lib/composer.ts:169` (`placeholdersForKind`) | works — commit `ba29df0`; deliberately no typewriter/easing (landing-page flourish this composer skips) |
| OD-026 | 93 image/video prompt templates | None | — | waived — W-13 (no image/video artifact kinds) |
| OD-027 | First-run guidance cascade | Milestone one-shot hints instead | `apps/web/src/components/onboarding/hints.ts:22` | waived — W-3 |
| OD-028 | Composer `@`-mention of extra skills | None — skills attach to crew agents | `apps/web/src/app/team/[role]/page.tsx:148` | waived — W-14 |
| OD-029 | Plugin/Figma/template shortcut chips | "Adopt a repo" mode chip (the pinned-default shortcut) | `apps/web/src/lib/composer.ts:13`; e2e `apps/web/e2e/product-flows.spec.ts:63` | works |
| OD-030 | Pixel-scan animated logo | None | — | waived — W-15 (cosmetic) |
| OD-031 | Edge auto-scroll for the chip rail | None — five chips do not overflow | `apps/web/src/lib/composer.ts:16` | waived — W-15 |

## C. Discovery question-forms

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-032 | Structured clarifying-question protocol | `DiscoveryForm` contract, zod-validated fenced JSON from a dedicated discovery pass | `packages/api/src/briefs.ts:41`; `apps/daemon/src/engine/discovery.ts:214`; e2e `apps/web/e2e/product-flows.spec.ts:79` | works |
| OD-033 | Rendered form with **16 input types** | Thirteen: single (radio), multi (checkbox), select (dropdown), text, textarea, number, plus seven native types — range, date, time, url, email, tel, switch | `apps/web/src/components/question-form.tsx:150` (date/time/url/email/tel), `:160` (range), `:174` (switch); daemon `z.enum` `apps/daemon/src/engine/discovery.ts:106-120`; test `apps/daemon/__tests__/discovery-controls.test.ts` | works — commit `a1973bd`; file, colour and `direction-cards` stay unported (each needs a subsystem ligma does not have; `direction-cards` is OD-035) |
| OD-034 | Required-question gating | Names the missing fields, re-checked on submit | `apps/web/src/components/question-form.tsx:37` (`:52`) | works |
| OD-035 | `direction-cards` visual-style picker | Design-system picker is ligma's visual-direction chooser | `apps/web/src/components/pickers/design-system-picker.tsx` | waived — W-16 |
| OD-036 | Step-based multi-step forms | Up to three *sequential* discovery forms, each with a review-only Back over the previous turn and per-field Skip on optional questions | `apps/web/src/components/question-form.tsx:100` (Back), `:121` (Skip); guard quoted in the component doc `:41-44` (`applyAnswers` only accepts the open form); `apps/daemon/src/engine/discovery.ts:43` | works — commit `a1973bd`; still sequential forms, not steps within one — Back reviews read-only, it does not re-answer a past turn |
| OD-037 | Optional-form auto-continue timer | None | — | waived — W-17 |
| OD-038 | Partial-JSON streaming parse | Whole-reply zod parse; the form renders when it is complete | `apps/daemon/src/engine/discovery.ts:214` | waived — W-18 |

## D. Studio & artifact types

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-039 | Multi-artifact-type project workspace | One artifact type: multi-file HTML design sessions | `apps/web/src/components/studio/studio-surface.tsx:99` | waived — W-13 |
| OD-040 | Prototype artifacts (sandboxed iframe, reads `DESIGN.md`) | Same: srcdoc-sandboxed prototypes, DESIGN.md into the generator prompt | `apps/web/src/components/studio/srcdoc.ts:68`; `apps/daemon/src/studio/session.ts:81`; e2e `apps/web/e2e/studio.spec.ts:38` | works |
| OD-041 | Live artifacts with an editable tweaks panel | Tweaks panel over agent-declared EDITMODE tokens; `live` tokens apply with no model spawn | `apps/web/src/components/studio/tweaks-panel.tsx:122`; E-p3 (workstream D) | works |
| OD-042 | Deck / presentation artifacts | None as an artifact kind | — | waived — W-13 |
| OD-043 | Image generation artifacts | None | — | waived — W-13 |
| OD-044 | Video / HyperFrames | None | — | waived — W-13 |
| OD-045 | Audio artifacts | None | — | waived — W-13 |
| OD-046 | Pixel-accurate mobile device frames | Device bezels (iPhone 15 Pro, Android Pixel, iPad Pro, MacBook, browser chrome) wrapping the existing preview iframe, vendored verbatim with LICENSE + NOTICE | `apps/web/src/components/studio/device-chrome.tsx:1`; `assets/frames/` (`iphone-15-pro.html`, `android-pixel.html`, `ipad-pro.html`, `macbook.html`, `browser-chrome.html`); wired `apps/web/src/components/studio/focus-preview.tsx:88` | works — commit `7c88336` |
| OD-047 | Refresh-existing-codebase (rebrand in place) | Brownfield **adoption** (infer boot recipe → boot → crawl → review) — adopts, does not restyle | `apps/daemon/src/engine/adopt-repo.ts:1`; e2e `apps/web/e2e/product-flows.spec.ts:126` | waived — W-20 (later: brownfield restyle) |
| OD-048 | In-app reference browser / mood board | Per-project reference board — saved links (scraped title + domain) and screenshots (base64 `data:` upload, size-capped), a grid with delete only, no edit | `apps/web/src/components/workspace/references-panel.tsx:16`; store `apps/daemon/src/routes/references/store.ts`; routes `apps/daemon/src/routes/references/_id/route.ts:48` (`:59`); test `references/_id/route.test.ts` | works — commit `9e83f2f` |
| OD-049 | Code viewer with syntax highlighting | Shiki-highlighted per-version file viewer inside the version rail, over exact file-level diffs of content-addressed snapshots | `apps/web/src/components/studio/code-view.tsx:1`; `apps/web/src/runtime/shiki.ts:1`; per-version disclosure `apps/web/src/components/studio/version-rail.tsx:68` (`onLoadFiles`, `:47`); test `code-view.test.ts` | works — commit `7c88336`; React-render mode (OD-050) stays HTML-only by design |
| OD-050 | React-component render mode | HTML-only by design | `apps/web/src/components/studio/srcdoc.ts:21` (`ponytail: HTML-only`) | waived — W-21 |

## E. Critique Theater (Design Jury)

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-051 | **5-panelist** automated design review (Designer/Critic/Brand/A11y/Copy) | One critic scoring against `craft/` rules and the design-system manifest — and, since 2026-08-12, the same rule bodies the generator was given (OD-081) | `apps/daemon/src/studio/critic.ts:2` (`:130-140`) | waived — W-40 (merger-spec-approved reduction) |
| OD-052 | Critique behind a **settings toggle**, off by default | Deliberately inverted: the lane is visible by default, with no toggle anywhere | `apps/web/src/components/studio/critique-lane.tsx:4`; e2e `apps/web/e2e/studio.spec.ts:54` | works — parity **+**: brief §3 forbids hiding load-bearing features in settings |
| OD-053 | Per-panelist lanes, must-fix count, per-dim sparkline | One rule-score list (score / rule slug / note) | `apps/web/src/components/studio/critique-lane.tsx:100` | waived — W-40 (lanes need panelists) |
| OD-054 | Composite score ticker across rounds | Current score vs threshold, single round | `apps/web/src/components/studio/critique-lane.tsx:64`; threshold `apps/daemon/src/studio/critic.ts:38` | waived — W-40 (a trend needs rounds; one critic scores once per turn) |
| OD-055 | Collapsed result badge | Collapsed one-line summary: idle / running / scored / interrupted / error | `apps/web/src/components/studio/critique-lane.tsx:46` | works |
| OD-056 | Interrupt control mid-review | Interrupt button wired to an in-flight abort | `apps/web/src/components/studio/critique-lane.tsx:79`; `apps/daemon/src/studio/critic.ts:160` | works |
| OD-057 | Replay a completed run from `.ndjson` with speed control | Critic writes every event stream as `.ndjson` beside the design; the lane replays it at 1x/2x/4x through the same reducer the live SSE view uses | `apps/daemon/src/studio/critic-transcript.ts:46` (`readLatestCritiqueTranscript`, write `:27`); route `.../designs/_did/critique-transcript/route.ts:16`; `apps/web/src/components/studio/critique-lane.tsx:126` (`canReplay`, speed control `:48`); reducer shared with live `apps/web/src/components/studio/critique-events.ts:23`; test `studio-critic-transcript.test.ts`, `critique-lane.test.ts` (bit-identical rendering) | works — commit `7506095` |
| OD-058 | Per-skill `critique.policy` frontmatter override | None — there is no policy to override (OD-052) | `apps/web/src/components/studio/critique-lane.tsx:4` | waived — W-22 |

## F. Runtime adapters

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-059 | Data-driven adapter architecture (`RuntimeAgentDef`) | Config-driven backend union + per-backend fields; adding a CLI touches types, config, allowlist, governor | `apps/daemon/src/engine/types.ts:30` (`:88-96`) | waived — W-23 (internal architecture, not a user capability; the user-facing count is OD-060) |
| OD-060 | **~25 shipped CLI adapters** | Three: claude, codex, gemini | `apps/daemon/src/engine/security.ts:99`; `apps/daemon/src/engine/types.ts:30` | waived — W-41 (merger spec **Out of scope**: "adapter breadth beyond claude/codex/gemini") |
| OD-061 | Agent picker with availability/version/auth/models/diagnostics/rescan | Live per-backend probe (path, `--version`, config override, auth status) plus the existing backend-mode/failover/model fields, with a Rescan control that invalidates the cache | `apps/daemon/src/engine/backend-probe.ts:53` (`BackendProbe`), `:145` (`probeAllBackends`); routes `apps/daemon/src/routes/backends/route.ts:14`, `apps/daemon/src/routes/backends/rescan/route.ts:11`; UI `apps/web/src/app/settings/agents-card.tsx:59`; test `backend-probe.test.ts` | works — commit `3a00da3`; honestly partial on auth — only claude has a verified cheap check (`auth status --json`), gemini/codex report `"unknown"` rather than a guessed answer (`backend-probe.ts:87`) |
| OD-062 | Agent switcher / model + reasoning-level picker | `backendMode` + per-backend model fields, per run | `apps/daemon/src/engine/types.ts:88`; `apps/web/src/app/settings/page.tsx:435` | works — reasoning-level knob absent (`reasoningEffort` exists unused at `packages/providers/src/index.ts:40`) |
| OD-063 | **BYOK proxy** (Anthropic/OpenAI/Azure/Google/Ollama, SSRF-guarded) | None. What ligma's provider configuration *is* — which CLI binary, which model, which failover — is now on the Settings screen instead of hand-edited JSON | `apps/web/src/app/settings/page.tsx:526`; `docs/DECISIONS.md` Phase 3 ("Daemon dropped `@ligma/providers`"); `packages/providers/src/index.ts:253` | waived — W-43 ⚠ **needs Alex's sign-off** |
| OD-064 | MCP server install into external coding agents | stdio MCP entrypoint (`pnpm --filter @ligma/daemon mcp:server`) exposing a small toolset — list/create projects, list tasks/decisions, answer a decision, run status — each wrapping an existing route handler in-process so business rules never duplicate | `apps/daemon/src/mcp-server.ts:1` (design note), `:147` (`main`, tool registrations `:155-197`); `apps/daemon/package.json:17`; test `mcp-server.test.ts` | works — commit `8b5d465`; the in-process studio-tool bridge (`apps/daemon/src/studio/provider.ts:14`) is a separate, older mechanism talking only to the SDK's own agent loop |
| OD-065 | Live-streamed agent detection in Settings | Per-backend probe card, 15s smart-poll plus a manual Rescan that invalidates the cache | `apps/web/src/app/settings/agents-card.tsx:57` (poll interval), `:77` (rescan) | works — commit `3a00da3`; polled/rescanned, not a streamed connection |

## G. Design system catalog

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-066 | `manifest.json` / `DESIGN.md` / `tokens.css` triad | Read straight off the triad on disk | `apps/daemon/src/routes/design-systems/route.ts:130`; `packages/api/src/catalogs.ts:56` | works — the vendored `_schema/manifest.schema.ts` is not used to validate at read time |
| OD-067 | **151 bundled design-system packages** | All 151, vendored byte-verbatim per the Phase-1 convention | `design-systems/` (151 packages + `_schema`); `NOTICE.md` (license accounting) | works — commit `c94b610` |
| OD-068 | Catalog master–detail browsing | One `MasterDetail` shell shared by design systems, skills and craft rules | `apps/web/src/components/library/master-detail.tsx:1`; e2e `apps/web/e2e/library.spec.ts:30` (filter `:55`, keyboard `:68`) | works |
| OD-069 | Draft creation, Figma import, token-contract rebuild, revisions | Draft creation only: the wizard's token form creates a real, catalog-served package | `apps/web/src/app/library/new-design-system/page.tsx:1`; `apps/daemon/src/routes/design-systems/wizard/create-from-tokens/route.ts:47` | works — commit `3960e4a`; CITE HONESTLY: no Figma import (stated non-goal, CSS-export workaround) and no token-contract rebuild job — creation writes the triad once, a later edit is overwrite-with-confirm, not a rebuild pipeline; no revision history (`new-design-system/page.tsx:384`) |
| OD-070 | Live token preview consumed by artifacts | Sandboxed live preview from `components.html`, token-specimen fallback, swatches from `tokens.css` | `apps/web/src/components/library/design-system-detail.tsx:23`; e2e `apps/web/e2e/library.spec.ts:30` (`:81`) | works |
| OD-071 | Rich package profile (`USAGE.md`, derived manifests, `preview/`, `source/`) | `GET /api/design-systems/:id/file?path=` serves any file inside a package verbatim — `USAGE.md`, `components.manifest.json`, `design-tokens.json`, `tailwind-v4.css`, `preview/*`, `source/*` — and the Library's declared preview pages are links now, not names | `apps/daemon/src/routes/design-systems/_id/file/route.ts:29` (path safety: `safeResolve` + realpath re-check, reused from the verification-file route); `apps/web/src/components/library/design-system-detail.tsx:101`; `apps/web/src/components/library/catalog.ts:143`; test `apps/daemon/__tests__/design-system-file-route.test.ts` (9 cases incl. traversal and symlink escape) | works — repaired 2026-08-12 |
| OD-072 | Catalog metadata precedence resolver | Two tiers: `manifest.json` fields → `DESIGN.md` header blockquote fallback | `apps/daemon/src/routes/design-systems/route.ts:130` (`:70`) | works — same user-visible outcome from the two tiers ligma's packages actually carry |
| OD-073 | Localized catalog copy, 17 locales | None | `packages/i18n/src/locales/` (one file: `en.json`) | waived — W-26 |
| OD-074 | Repo-level package quality guard (`pnpm guard`) | None — ligma vendors the catalog read-only | `design-systems/LICENSE` (vendored, Apache-2.0, E-p1 §4) | waived — W-27 |
| OD-075 | Brand extraction from a live website | Paste-a-URL brand extraction: single SSRF-guarded server-side fetch (http(s) only, no loopback/private/link-local, ≤3 redirect hops, 1.5MB read cap, 8s budget), parses CSS custom properties, `theme-color`, and font stacks from real declarations into a proposed token set | `apps/daemon/src/routes/design-systems/wizard/extract-brand/route.ts:26` (guard doc), `:36-37` (`FETCH_TIMEOUT_MS`, `MAX_BYTES`), `:635` (`isFetchableUrl`), `:681` (per-hop check), `:525` (`proposeTokens`); test `apps/daemon/__tests__/design-system-wizard.test.ts` ("brand extraction" suite) | works — commit `3960e4a`; CITE HONESTLY: ceilings are named, not hidden — no `oklch()`/`lab()`/`color()`/named-colour/unresolved-`var()` resolution (`extract-brand/route.ts:298`), and ranking is by declaration count, not on-screen frequency (`:598`) |

## H. Skills system

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-076 | `SKILL.md` convention (Claude-Code-compatible) | Loader with YAML frontmatter + writer emitting `skills/<id>/SKILL.md` | `packages/core/src/skills/loader.ts:10`; `apps/daemon/src/store/sync-commands.ts:132` | works |
| OD-077 | **100+ bundled functional skills** | 136 vendored `SKILL.md` packages (26 upstream-MIT skills excluded, named in `NOTICE.md`), served by a Library tab | `skills/` (136 packages, commit `c94b610`); `GET /api/skill-catalog` `apps/daemon/src/routes/skill-catalog/route.ts:116`; Library tab `apps/web/src/app/library/page.tsx:313` (`SkillCatalogTab`, trigger `:408`); commit `c734bf5` | works |
| OD-078 | `od:` frontmatter extensions | `SkillFrontmatterV1` (trigger scope, allowed_tools, invocability) | `packages/shared/src/skills.ts:24` | waived — W-28 (each `od:` key governs a subsystem ligma does not have) |
| OD-079 | Skill discovery & precedence, live rescan | project > user > builtin merge, rescanned per load | `packages/core/src/skills/loader.ts:277` | works — one registry; there is no second rendering-template registry because there are no rendering templates (W-13) |
| OD-080 | **Staging isolation** — skill dir copied into the run cwd so agents cannot mutate the source | None, and nothing to stage: ligma never hands a spawn a skill *directory*. Skill bodies are inlined into the prompt from `skills-library.json` | `apps/daemon/src/engine/prompt-builder.ts:113-121` (`buildAgentPersona` inlines `skill.content`), `:410`; the only on-disk copy, `skills/<id>/SKILL.md`, is the daemon's export for Claude Code's own discovery (`apps/daemon/src/store/sync-commands.ts:130`) and is never referenced by a run | waived — W-44 (later: skill-source deny rule, with the oracle deny rules) |
| OD-081 | **Craft references injected** into the prompt between design-system context and skill body | Rule bodies go into the generator's system prompt, below the design-system brief — open-design's own order (`craft/README.md`). Selection is structural: the package `manifest.json`'s `craft: {applies, suggested, exemptions}` block, plus the anti-slop baseline no brand opts out of | `apps/daemon/src/studio/craft.ts:113` (`craftContext`; selection `:79`); injected at `apps/daemon/src/studio/session.ts:96`; the critic keeps the full slug list (`critic.ts:44`); test `apps/daemon/__tests__/studio-craft-context.test.ts` (7 cases, incl. the real vendored tree) | works — repaired 2026-08-12; the writer reads the rules the grader scores by |
| OD-082 | `@`-mention selection of skills at prompt time | None | see OD-028 | waived — W-14 |
| OD-083 | Skills-contributing merge pipeline | None | — | waived — W-27 (author-facing, gates an upstream catalog) |

## I. Onboarding

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-084 | Onboarding wizard flow | None | see OD-003 | waived — W-3 |
| OD-085 | **Milestone-scoped one-shot hints** | Five: first-visit, first-project, first-design, first-promote, first-verdict | `apps/web/src/components/onboarding/hints.ts:22`; call sites `layout-shell.tsx:114`, `projects/[id]/layout.tsx:92`, `studio/studio-surface.tsx:285`, `studio/promote-sheet.tsx:167`, `verification/[id]/page.tsx:60`; e2e `apps/web/e2e/failure-onboarding.spec.ts:21` (`:35`); unit `apps/web/src/components/onboarding/hints.test.ts` | works |
| OD-086 | Provider/agent connection test with per-failure-class messaging | The live per-backend probe now surfaces failures through the existing failure-class card family, gated on a structured `causeKind` | `apps/daemon/src/engine/backend-probe.ts:133` (`causeKind`); `apps/web/src/app/settings/agents-card.tsx:125` (`classifyCause`), `:135` (`FailureCard`) | works — commit `3a00da3` |
| OD-087 | Starter-prompt copy / recommendation engine | One-line starter recommendation per kind, click-to-fill; reuses the sub-chip pool's first entry rather than a second copy of the same idea | `apps/web/src/lib/composer.ts:132` (`starterPromptForKind`); `apps/web/src/components/kickoff-composer.tsx:44` | works — commit `ba29df0` |
| OD-088 | Onboarding provider model discovery UI | No onboarding wizard exists (W-3); on Settings, the per-backend probe now shows what is actually installed (path/version/auth) alongside the existing free-text model fields | `apps/web/src/app/settings/agents-card.tsx:59`; model fields `apps/web/src/app/settings/page.tsx:526` | works — commit `3a00da3`; honest gap — no model list is fetched from a provider, model stays a typed field |

## J. Settings

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-089 | Settings with 8 primary sections | Three cards: Schedule, Configuration, Demo data (+ Checkpoints subpage) | `apps/web/src/app/settings/page.tsx:222` (`:358`, demo data `:84`); `apps/web/src/app/settings/checkpoints/page.tsx` | waived — W-29 |
| OD-090 | Six more deep-linked settings sections | None | see W-29 | waived — W-29 |
| OD-091 | Custom instructions / system-prompt editor | Per-agent instruction editor with char count | `apps/web/src/app/team/[role]/page.tsx:119` (`:240`) | works |
| OD-092 | Memory model picker | Cross-session per-agent memory: explicit-write store (`data/memory/<agentId>.json`, mutexed, write-then-rename), pins survive the eviction cap, injected into the persona as "What you remember" when enabled | `apps/daemon/src/store/memory.ts:36` (pin note), `:172` (`memorySection`); prompt injection `apps/daemon/src/engine/prompt-builder.ts:128`; settings card `apps/web/src/app/settings/memory-card.tsx:1`, wired `apps/web/src/app/settings/page.tsx:686`; routes `apps/daemon/src/routes/memory/_agentId/route.ts:21` (`:31`); test `apps/daemon/__tests__/memory-store.test.ts`, `memory-routes.test.ts` | works — commit `8e24449`; CITE HONESTLY: no auto-summarisation/extraction from transcripts — a documented non-goal (`store/memory.ts:10-14`; pattern-matching a model's prose for structured data is banned in this repo, automatic capture must arrive as structured model output instead), so the reference's "memory *model* picker" — a choice of extraction model — has no analogue by design; what ligma has is an on/off knob plus a cap, not a model choice |
| OD-093 | Media provider configuration | None | see W-13 | waived — W-13 |
| OD-094 | Privacy settings (analytics/replay consent) | None needed: ligma ships no analytics, telemetry or session replay | brief §8 (single user, localhost); no analytics dependency in `apps/web/package.json` | waived — W-30 (parity **+**: nothing to consent to) |
| OD-095 | Language picker + theme control | Theme works; language does not exist | `apps/web/src/components/theme-toggle.tsx:14` (mounted E-rail `:98`) | works — theme; language see W-26 |
| OD-096 | Notifications settings | macOS desktop notifications, gated by platform + a Settings toggle, fired from `applyVerdict` beside the inbox report, plus a send-test route | `apps/web/src/app/settings/notifications-card.tsx:22`; `apps/daemon/src/notify.ts:42` (`notifyDesktop`); wired `apps/daemon/src/harness/verdict.ts:356`; route `apps/daemon/src/routes/notifications/test/route.ts:11`; test `apps/daemon/__tests__/notify.test.ts` | works — commit `c3a2356`; fires on verification verdicts, not on every dispatcher task-completion event |
| OD-097 | Project-locations / linked-directories | Configurable products root (env `LIGMA_PRODUCTS_DIR` → configured `storage.productsDir` → default `~/ligma-products/<slug>`), shown with its winning source; adopted repos keep their own path | `apps/web/src/app/settings/project-locations-card.tsx:32`; `apps/daemon/src/store/product-repo.ts:33` (`productsRootInfo`); route `apps/daemon/src/routes/product-root/route.ts:10`; test `apps/daemon/__tests__/product-repo-root.test.ts` | works — commit `c3a2356` |
| OD-098 | About panel | About card reading version + short commit, best-effort | `apps/web/src/app/settings/about-card.tsx:16`; route `apps/daemon/src/routes/about/route.ts:36` | works — commit `c3a2356` |
| OD-099 | Message Center with unread badge | `/inbox` — agent mail with the rail's unread badge | `apps/web/src/app/inbox/page.tsx:17`; badge E-rail `:69`; `apps/daemon/src/routes/sidebar/route.ts:7` | works |

## K. Integrations, MCP & connectors

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-100 | Integrations page/section | Same `/settings/integrations` page as OD-014, hosting the MCP server card, the registry and the handoff card | `apps/web/src/app/settings/integrations/page.tsx:13` | works — commit `8b5d465` |
| OD-101 | External MCP server management | JSON-file registry (add/enable/remove) plus a Settings card — **registration only**; wiring a registered server into an actual agent run is explicitly out of scope and the card's own copy says so | `apps/daemon/src/routes/mcp/store.ts:1` (docblock), `:9` (scope note); routes `apps/daemon/src/routes/mcp/servers/route.ts:15` (`:20`); UI `apps/web/src/app/settings/integrations/mcp-registry-card.tsx:1` (docblock), `:37`; test `mcp/servers/route.test.ts` | works — commit `8b5d465`; **registry + UI only, nothing wired to a run** — do not read this as "external MCP servers are usable by agents" yet |
| OD-102 | Composio connector catalog | None | — | waived — W-9 |
| OD-103 | "Use everywhere" guide modal (CLI/MCP/HTTP/Skills) | `UseEverywhereModal` — CLI, HTTP API and daemon-liveness sections with copy-to-clipboard snippets, opened from the command bar | `apps/web/src/components/use-everywhere/UseEverywhereModal.tsx:26`; `apps/web/src/components/use-everywhere/sections.ts:19` (`GUIDE_SECTIONS`); wired `apps/web/src/components/command-bar.tsx:122` (button), `:260` (modal); test `sections.test.ts` (snippets cross-checked against `API_ROUTES` and the real CLI command set) | works — commit `68c2a07`; MCP section omitted — no external MCP surface exists |
| OD-104 | Hand-off menu (open in local editor / copy CLI prompts) | Handoff card on `/settings/integrations`: open a project's repo in the local editor, or copy a compiled prompt (project + open tasks + workspace snapshot) for an external agent | `apps/web/src/app/settings/integrations/handoff-card.tsx:1` (docblock), `:18` (`HandoffCard`); route `apps/daemon/src/routes/mcp/handoff-prompt/_id/route.ts:19`; test `handoff-prompt/_id/route.test.ts` | works — commit `8b5d465` |

## L. Automations, Routines & Orbit

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-105 | Saved automations list + metrics | `/settings` Schedule list (cron, command, ON/OFF, next run) + the morning smoke digest as the outcome report | `apps/web/src/app/settings/page.tsx:250`; `apps/daemon/src/engine/smoke.ts:245` | works — W-5 argues the mapping; outcome reporting is signed verdicts rather than aggregate metrics |
| OD-106 | **Routines** — recurring scheduled runs | Two: daemon cron schedules (add/edit/enable/remove from `/settings`) and journey smoke schedules riding the same scheduler | `apps/daemon/src/engine/scheduler.ts:45` (`:87`); `apps/daemon/src/engine/smoke.ts:75`; `apps/web/src/app/settings/page.tsx:178`; e2e `apps/web/e2e/smoke.spec.ts:17` | works |
| OD-107 | Localized run-failure reason messages | Failure classes are structured and typed; copy is English only | `apps/web/src/components/failure/failure-card.tsx:41`; `packages/i18n/src/err-codes.test.ts:9` | waived — W-26 (classification present, translation absent) |
| OD-108 | Orbit — connector-driven digest project | Morning smoke digest is the digest ligma has; it has no connectors to draw on | `apps/daemon/src/engine/smoke.ts:45` | waived — W-9 |

## M. Exports & handoff

Every exporter open-design ships exists in `packages/exporters` with tests, and until 2026-08-12
was imported by exactly one file in the repo — `apps/desktop/src/main/exporter-ipc.ts:6`. Seven
rows failed on one cause: the code was written and tested, and no product face called it.

**Repaired (D7 DC-1).** Nothing in `packages/exporters` was Electron-locked — grep finds zero
`electron` / `BrowserWindow` / `webContents` imports across its source, and the PDF path is
Chrome-discovery + `puppeteer-core`, not Electron print. The only Electron call in the desktop flow
was `dialog.showSaveDialog` choosing a destination path, which over HTTP is `Content-Disposition`.
So this was wiring, not a port:

- `GET /api/projects/:id/designs/:did/export?format=zip|html|pdf|pptx|markdown[&versionId=]`
  (`apps/daemon/src/routes/projects/_id/designs/_did/export/route.ts:95`). Bodies come out of the
  content-addressed blob store through the same helper the files route uses
  (`apps/daemon/src/studio/snapshots.ts:82` `readSnapshotBodies`), so an export is byte-for-byte
  the design the Wall rendered — never the working tree mid-turn. The exporters write to a path
  rather than returning bytes, so each call runs into a private `mkdtemp` removed on the way out.
- An Export menu in the Studio action bar, next to Approve and available at any design status
  (`apps/web/src/components/studio/studio-surface.tsx:444`, handler `:259`,
  `apps/web/src/components/studio/api.ts:180`).
- Golden tests, one per format family, against a fixture design:
  `apps/daemon/__tests__/studio-export-route.test.ts` (10 cases — ZIP and PPTX asserted on
  `PK\x03\x04` magic bytes, HTML asserted to carry the *snapshot* and not a later unsnapshotted
  edit, plus the filename, unknown-format, unknown-version and never-snapshotted contracts).

`@ligma/exporters` is a daemon dependency now (`apps/daemon/package.json`). The seventh row,
OD-115 (the diagnostics *surface*), shipped its own panel on 2026-08-13 (commit `7c88336`) — all
seven now `works`.

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-109 | Export to PDF | `?format=pdf` → `exportPdf` server-side | `packages/exporters/src/pdf.ts:1`; route `.../export/route.ts:95`; Studio menu `studio-surface.tsx:444`; test `studio-export-route.test.ts` ("503 with the code intact when PDF cannot find a Chrome") | works — repaired 2026-08-12 |
| OD-110 | Export to standalone HTML | `?format=html` → `exportHtml` over the design's primary screen (`index.html`, else the first HTML file) | `packages/exporters/src/index.ts:36`; `.../export/route.ts:62` (`primaryHtml`); test `studio-export-route.test.ts` ("from the snapshot, not the working tree") | works — repaired 2026-08-12 |
| OD-111 | Export to ZIP + handoff guide | `?format=zip` (the default) → `exportMultiFileBundle` over every file in the version, with the generated `README.md` enumerating the screens | `packages/exporters/src/zip.ts:141` (README `:113`); `.../export/route.ts:131`; test `studio-export-route.test.ts` ("zips the whole design, named after it") | works — repaired 2026-08-12; the bundle's `README.md` is ligma's handoff guide, and the parent's separate `DESIGN-HANDOFF.md` / `DESIGN-MANIFEST.json` are still not written |
| OD-112 | Export to Markdown | `?format=markdown` → `exportMarkdown` | `packages/exporters/src/markdown.ts:12`; `.../export/route.ts:95`; test `studio-export-route.test.ts` ("exports Markdown") | works — repaired 2026-08-12 |
| OD-113 | Deck export to PPTX | `?format=pptx` → `exportPptx`, a real exporter (stronger than the parent's skill-based path) | `packages/exporters/src/pptx.ts:26`; `.../export/route.ts:95`; test `studio-export-route.test.ts` asserts a genuine OOXML archive by magic bytes | works — repaired 2026-08-12 |
| OD-114 | Host-native PDF capture | `findSystemChrome` + `puppeteer-core` in the daemon process — the parent's own mechanism, never Electron print | `packages/exporters/src/chrome-discovery.ts:41`; `packages/exporters/src/pdf.ts:24`; a missing Chrome answers 503 `EXPORTER_NO_CHROME` rather than a bare 500 (`.../export/route.ts:84`) | works — repaired 2026-08-12; still no browser popup+print fallback, which needed a host window ligma's web face does not have |
| OD-115 | Export diagnostics button | A diagnostics panel next to the export action: recent attempts with their typed `EXPORTER_*` code and a plain-language explanation, backed by a localStorage attempt log | `apps/web/src/components/studio/export-diagnostics-panel.tsx:1`; `apps/web/src/components/studio/export-error-code.ts:1` (`explainExportError`); `apps/web/src/components/studio/export-history.ts:1`; tests `export-error-code.test.ts`, `export-history.test.ts` | works — commit `7c88336` |
| OD-116 | `<artifact>` block extraction for plain-stream adapters | None — the studio writes files through MCP tools, never by parsing a stream | `apps/daemon/src/studio/provider.ts:14`; E-p3 (workstream C) | waived — W-32 |

## N. Error recovery & diagnostics

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-117 | Failure-class messaging for provider connection tests | The provider-test surface the pattern was waiting on now exists: the live backend probe decorates its own connection failures with the same failure-class card family | `apps/web/src/app/settings/agents-card.tsx:134` (`FailureCard`); `apps/web/src/components/failure/classify.ts:24`; `apps/web/src/components/failure/failure-card.tsx:41` | works — commit `3a00da3` |
| OD-118 | Failure-class messaging for agent CLI tests | Same family; a missing CLI binary probes to `causeKind: "env"` and renders the `env` card | `apps/daemon/src/engine/backend-probe.ts:107-119`; `apps/web/src/app/settings/agents-card.tsx:134` | works — commit `3a00da3` |
| OD-119 | Failure-class messaging for model discovery | Same family; an unauthenticated backend probes to `causeKind: "auth"` and renders the `auth` card | `apps/daemon/src/engine/backend-probe.ts:133`; `apps/web/src/app/settings/agents-card.tsx:134` | works — commit `3a00da3`; honest gap — no model *list* is fetched from a provider to fail against, only the connection/auth check |
| OD-120 | Font-loading recovery under a packaged `od://` protocol | None — ligma's web face is served over HTTP, not a custom protocol | `apps/web/next.config.ts` | waived — W-33 (the failure mode does not exist here) |
| OD-121 | Pre-run balance gate (hard block vs soft warning) | The quota governor's pre-spawn gate: hard on kill-switch / reserve floor, soft as a calm deferral | `apps/daemon/src/engine/quota-governor.ts:172` (`:177`); `apps/web/src/components/quota-card.tsx:14`; rail gauge `apps/web/src/components/governor-gauge.tsx` | waived — W-34 (argued mapping: subscription window, not a dollar balance) |
| OD-122 | Auth-retry continuation for cloud runs | Backend failover + persisted retry queue continue the work | `apps/daemon/src/engine/dispatcher.ts:352` (`:31`) | waived — W-34 |
| OD-123 | Low-balance recovery plan | `deferred` failure card carrying `resumesAt` | `apps/web/src/components/failure/failure-card.tsx:47` (`:99`); `apps/daemon/src/engine/quota-governor.ts:102` | waived — W-34 |
| OD-124 | Critique `degraded` diagnostics sub-codes | One `harness` class for every critique malfunction, with the underlying error text carried on the card | `apps/web/src/components/failure/classify.ts:51`; `apps/web/src/components/studio/critique-lane.tsx:46` | waived — W-46 (brief §3: *one* failure-class error model everywhere) |
| OD-125 | Oversized-prompt guard | `enforcePromptLimit` (100KB, staged degradation) + restriction-aware argv building incl. the Windows `.cmd` shim | `apps/daemon/src/engine/security.ts:88`; `apps/daemon/src/engine/runner.ts:303` (see MC-246, MC-260) | works — truncates with a marker rather than erroring; the E2BIG failure mode is closed either way |

## O. Shimmer / loading & progress primitives

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-126 | Shimmer-text progress primitive | One shimmer/skeleton primitive, machine-enforced as the only definition site | `apps/web/src/components/ui/skeleton.tsx:3`; **E-seam** rule `one-shimmer-primitive` = pass, "1 definition site(s) found" | works |
| OD-127 | Skeleton loaders | 14 named skeletons over the one primitive | `apps/web/src/components/skeletons.tsx`; route-level `loading.tsx` files (MC-162) | works |
| OD-128 | Shimmer overlay on an API-key field during a probe | A probe now exists and shows a loading state while it runs | `apps/web/src/app/settings/agents-card.tsx:112` (`"Loading..."`) | works — commit `3a00da3`; honest gap — plain loading text, not a shimmer skeleton, and still no API-key field (BYOK stays waived, W-43) |

## P. Desktop Pet

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-129 | Desktop Pet overlay window | None | — | waived — W-10 |
| OD-130 | Pet sprite/animation system | None | — | waived — W-10 |
| OD-131 | Pet task-center integration | None | — | waived — W-10 |
| OD-132 | Pet settings panel | None | — | waived — W-10 |

## Q. Workspace tabs & in-project surfaces

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-133 | Extensible "+" tab launcher registry | Fixed pipeline strip (Overview / Brief / Studio / Board / Runs / Verify / Knowledge), shape-adaptive | `apps/web/src/components/pipeline-strip.tsx:57`; e2e `apps/web/e2e/smoke.spec.ts:78` | waived — W-35 (UX spec §4: the strip *is* the navigation; an open-ended tab registry is what let open-design orphan surfaces) |
| OD-134 | Side-chat tab | Reduced shape, shipped honestly: an append-only Notes thread, not chat — this repo has no conversational engine to back a `SideChatTab` port (no LLM-backed conversation route exists; `inbox` is agent task-delegation mail, not free-form chat), and building one only to feed a side panel would repeat the tab-registry mistake. Notes renders as a vertical thread with timestamps, but every entry has the same author, nothing replies, and the empty state says so | `apps/web/src/components/workspace/notes-panel.tsx:1` (docblock), `:16` (`NotesPanel`); routes `apps/daemon/src/routes/references/_id/notes/route.ts:29` (`:40`); test `notes/route.test.ts`, `notes-panel.test.ts` | works — commit `9e83f2f`; **honest reduction, not full parity** — if this row's short name is read as promising a conversational side chat, it does not: it ships a scratch-notes thread instead |
| OD-135 | Terminal (PTY) tab | A command console over ligma's own exec-and-wait `pty-bridge.ts` — not a live tty: each line runs as `sh -lc` and returns whole, project-scoped, repo-gated, SSE-streamed with replay | `apps/web/src/app/projects/[id]/terminal/page.tsx:14`; `apps/web/src/components/studio/terminal-panel.tsx:1`; routes `apps/daemon/src/routes/pty/route.ts:17` (create, 409 repo-less), `.../pty/_id/stream/route.ts:20` (SSE), `.../pty/_id/input/route.ts:12`; test `apps/daemon/__tests__/pty-routes.test.ts` | works — commit `47859a0`; honestly a command console, not a real tty — the bridge's own docstring says pipes, no mid-command output, no interactive prompts |
| OD-136 | Blank-page creator dialog | None | — | waived — W-36 (flag-off in the parent) |
| OD-137 | New Browser tab | Same reference board as OD-048, reached as its own fixed pipeline stage | `apps/web/src/app/projects/[id]/references/page.tsx:9`; `apps/web/src/components/pipeline-strip.tsx:125` | works — commit `9e83f2f` |
| OD-138 | Design Files tab (sketch/document/upload) | Per-project design-files panel over the same workspace store as References — base64 upload with a size cap, list view (name + size), delete only | `apps/web/src/components/workspace/design-files-panel.tsx:1` (docblock), `:16` (`DesignFilesPanel`); routes `apps/daemon/src/routes/references/_id/design-files/route.ts:27` (`:38`); test `design-files/route.test.ts` | works — commit `9e83f2f` |
| OD-139 | Auto-open file when a run produces an artifact | Prototypes stream onto the Wall as they are written; the focus preview opens the newest | `apps/web/src/components/studio/wall.tsx`; `apps/web/src/components/studio/studio-surface.tsx:99`; e2e `apps/web/e2e/studio.spec.ts:38` | works |

## R. Multi-user / team / workspace collaboration

All fourteen carry the inventory's **MULTI-USER** marker; brief §8 excludes RBAC, auth and
multi-tenancy, and §3 makes these the one automatic waiver class. Cited once:
`docs/parity/open-design-capabilities.md:242-259`.

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-140 | Workspace switcher | None | inventory `:246` | waived-multiuser |
| OD-141 | Team invite flow | None | inventory `:247` | waived-multiuser |
| OD-142 | Drafts / All-projects team destinations | None | inventory `:248` | waived-multiuser |
| OD-143 | Members / workspace dashboard / settings | None | inventory `:249` | waived-multiuser |
| OD-144 | Team Board | None (ligma's `/board` is the single-user task kanban) | inventory `:250` | waived-multiuser |
| OD-145 | Live presence bar | None | inventory `:251` | waived-multiuser |
| OD-146 | Real-time collaborative sync | None | inventory `:252` | waived-multiuser |
| OD-147 | Anchored comments with drift tracking | None in the product; `@ligma/runtime`'s pin overlay is the single-user descendant | inventory `:253`; `apps/web/src/components/studio/pin-overlay.tsx` | waived-multiuser |
| OD-148 | Team member directory | None | inventory `:254` | waived-multiuser |
| OD-149 | Team plan / billing surface | None | inventory `:255` | waived-multiuser |
| OD-150 | File sync status badge | None | inventory `:256` | waived-multiuser |
| OD-151 | Public file publishing | None | inventory `:257` | waived-multiuser |
| OD-152 | Project-ownership transfer | None | inventory `:258` | waived-multiuser |
| OD-153 | Sign-out confirmation gate | None — no identity to sign out of | inventory `:259` | waived-multiuser |

## S. Plugins system

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-154 | Plugin catalog with facets and ranking | Skill-catalog tab: Kind facet + Saved-only switch over the vendored `skills/` tree, use-count ranking after the facet cut | `apps/web/src/app/library/page.tsx:456` (`modeOptions`), `:458` (`masterEntries`); `apps/web/src/components/library/catalog.ts:99` (`rankByUse`); `apps/daemon/src/routes/library-meta/facets/route.ts:53` (survey: `od.mode` 136/136, `category` 117/136) | works — commit `5cf020a`; a plugin catalog still needs a second party's plugins — this is the vendored-skills analogue (W-6's install-from-elsewhere/community/registry rows stay waived) |
| OD-155 | Plugin detail view | Skill-catalog detail pane: description, mode/category/tag badges, "Ships with" file list, full body | `apps/web/src/app/library/page.tsx:339` (`SkillCatalogDetailPane`); design-system detail remains the parallel analogue at `apps/web/src/components/library/design-system-detail.tsx:1` | works — commit `5cf020a` |
| OD-156 | Plugin install / use tracking | Copy-to-clipboard on a skill/craft-rule/design-system fires a use-count increment, mutexed in `data/library-meta.json` | `apps/daemon/src/routes/library-meta/use/route.ts:15`; `apps/web/src/components/library/library-meta.ts:47` (`recordLibraryUse`); call sites `apps/web/src/app/library/page.tsx:315` (craft copy), `:496` (skill-catalog copy); test `apps/daemon/src/routes/library-meta/use/route.test.ts` | works — commit `5cf020a`; "install" has no analogue (nothing to install locally) — this is use-tracking on copy, which is ligma's real equivalent action |
| OD-157 | Save/bookmark a plugin | Star toggle on every catalog row, backed by the same `library-meta.json` store | `apps/web/src/components/library/master-detail.tsx:30` (doc), `:130` (star button); route `apps/daemon/src/routes/library-meta/bookmark/route.ts:11`; test `.../bookmark/route.test.ts` | works — commit `5cf020a` |
| OD-158 | Plugin authoring entry point | "Create your own" card on every catalog tab, opening a guide to that tree's on-disk format | `apps/web/src/components/library/authoring-guide.tsx:82` (`CreateYourOwnCard`); mounted `apps/web/src/app/library/page.tsx:111` (design systems), `:304` (craft), `:486` (skill catalog) | works — commit `5cf020a`; CITE HONESTLY: a guide + dialog, not a wizard — nothing here writes a new package to disk (design-system creation has its own wizard, OD-010); this tells a human where to put the files by hand |
| OD-159 | Plugin source/skill-description composition | The skill-catalog authoring guide names the exact `SKILL.md` shape the facet reader parses: `name`/`description` frontmatter (required), `od.mode` + `category`/`tags` (the facets), body markdown | `apps/web/src/components/library/authoring-guide.tsx:45-66` (`skill` guide body) | works — commit `5cf020a`; CITE HONESTLY: a written spec, not a composer UI — there is no form that assembles the frontmatter/body for you, matching OD-158's "guide, not wizard" scope |
| OD-160 | Share-to-community flow | None | — | waived — W-6 |
| OD-161 | Publishing guide + self-hosted registry | None | — | waived — W-6 |

## T. BYOK & provider configuration

Same cause as R-OD-063: the fields exist in `apps/desktop`, which is not a product face.

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-162 | BYOK provider picker with preflight validation | Desktop-only Settings ModelsTab; ligma's product face picks a *backend* and its binary instead | `apps/desktop/src/renderer/src/components/Settings.tsx:1524`; `apps/web/src/app/settings/page.tsx:435` (`:526`) | waived — W-43 ⚠ **needs Alex's sign-off** |
| OD-163 | API-key field with connection test | Desktop-only modal + diagnostic panel; ligma holds no key to test | `apps/desktop/src/renderer/src/components/AddCustomProviderModal.tsx:106`; `ConnectionDiagnosticPanel.tsx:26` | waived — W-43 ⚠ **needs Alex's sign-off** |
| OD-164 | Custom base-URL + model-id fields | Desktop-only base-URL; the *model-id* half exists in the product, per backend | `apps/desktop/src/renderer/src/components/AddCustomProviderModal.tsx:105`; `apps/web/src/app/settings/page.tsx:526` (Codex/Gemini model fields) | waived — W-43 ⚠ **needs Alex's sign-off** |
| OD-165 | Local-model discovery | Desktop-only live discovery + `pickBestModel`; no discovery endpoint to query without a provider base URL | `apps/desktop/src/renderer/src/components/AddCustomProviderModal.tsx:141` (`:74`) | waived — W-43 ⚠ **needs Alex's sign-off** |

## U. Miscellaneous

| ID | Capability (short) | Ligma equivalent | Evidence | Status |
|---|---|---|---|---|
| OD-166 | ⌘K project search palette | `SearchDialog` searches projects, tasks, goals and brain-dump; selecting a project opens its project space | `apps/web/src/components/search-dialog.tsx:100`; `apps/web/src/lib/nav.ts:94` (`recordHref("project")` → `/projects/:id`); test `apps/web/__tests__/nav.test.ts` | works — repaired 2026-08-12, see MC-152 |
| OD-167 | GitHub star count badge | None | — | waived — W-15 |
| OD-168 | In-app updater popup | None — ligma updates by `pnpm ligma:pull` in the repo it runs from | `package.json:31` | waived — W-37 |
| OD-169 | Cloud sign-in tip | None — no cloud identity (§8) | brief §8 | waived — W-30 |
| OD-170 | 17-locale i18n coverage | `@ligma/i18n` plumbing intact, one locale registered; missing keys render `⟦key⟧` rather than silently falling back | `packages/i18n/src/index.ts:16`; `packages/i18n/src/locales/en.json` | waived — W-26 |
| OD-171 | Cross-tab config sync | None of ligma's own; `next-themes` syncs the theme key only | `apps/web/src/components/theme-provider.tsx:1` | waived — W-38 |

---

# D7.1 — Decision cards: the 33 REDUCED rows, resolved

Brief §7 D7: *a row where ligma does less than the parent is failing unless Alex approved the
reduction by decision card.* The first pass raised 33 such rows in eight cards. This is the
disposition of all thirty-three, worked on 2026-08-12 and updated 2026-08-13: **22 fixed in code
with tests** (three more closed overnight — OD-115 `7c88336`, OD-033 `a1973bd`, OD-061 `3a00da3`)
**, 11 waived with an argument and a roadmap home, 0 left failing.** One waiver (W-43, BYOK) is
marked ⚠ and still wants Alex's word; the other six rest on the brief, the merger spec, or a
structural fact about ligma that is stated in the row.

| Card | Rows | Disposition |
|---|---|---|
| DC-1 exports | 7 | **7 fixed** (OD-115 closed 2026-08-13, commit `7c88336`) |
| DC-2 BYOK | 5 | **5 waived** — W-43 ⚠ needs sign-off |
| DC-3 search | 3 | **3 fixed** |
| DC-4 critique jury | 4 | **4 waived** — W-40, W-46 |
| DC-5 vendored patterns | 2 | **1 fixed** (OD-081), 1 waived (W-44) |
| DC-6 brain-dump spawn | 4 | **4 fixed** |
| DC-7 breadth cuts | 4 | **3 fixed** (OD-071; OD-033 and OD-061 closed 2026-08-13), 1 waived (W-41) |
| DC-8 cockpit | 4 | **4 fixed** |

### DC-1 · Studio designs could not be exported (7 rows: OD-109 … OD-115) — **fixed**

The exporters were never Electron-locked: zero `electron` imports across `packages/exporters/src`,
and the PDF path is Chrome discovery + `puppeteer-core`, not Electron print. The one Electron call
in the desktop flow was `dialog.showSaveDialog` picking a path, which over HTTP is
`Content-Disposition`. So a daemon route
(`apps/daemon/src/routes/projects/_id/designs/_did/export/route.ts`) now exports any design version
as `zip | html | pdf | pptx | markdown` out of the content-addressed store, and the Studio action
bar has an Export menu. Ten golden tests, one per format family, assert real files by magic bytes.
Details and evidence in §M above. **Update 2026-08-13:** OD-115 shipped its diagnostics panel too
(commit `7c88336`) — all seven rows now `works`.

### DC-2 · The factory cannot run on the user's own API key (5 rows: OD-063, OD-162 … OD-165) — **waived, ⚠ needs Alex's sign-off**

This is the one card in the eight that is a genuine product question rather than a defect, and it
is not the parity workstream's to answer.

**The argument for accepting it.** Ligma's backends are CLI-subscription by design: principle 9
("prefer Alex's Claude subscription (`claude -p`)") is an engine principle, the governor meters a
*subscription window* rather than a dollar balance (W-34), and `docs/DECISIONS.md` Phase 3 records
the daemon dropping `@ligma/providers` deliberately. A BYOK proxy is not a missing screen — it is a
second execution path, with its own key storage, SSRF guard, model catalog and failure taxonomy,
none of which the CLI path shares.

**What was done anyway.** The provider configuration ligma *does* have was hand-edited JSON:
`claudeBinaryPath`, `codexBinaryPath`, `codexModel`, `geminiBinaryPath`, `geminiModel` all existed
in `daemon-config` and appeared on no screen. They are on the Settings Configuration card now
(`apps/web/src/app/settings/page.tsx:526`), with blank meaning "auto-detect on `PATH`" — brief §3
forbids load-bearing configuration living somewhere the product does not show. That closes the
*model-id* half of OD-164 and moved OD-061 from "no per-agent anything" to "path and model, no
live probe" — and, as of 2026-08-13 (commit `3a00da3`), to a live probe too: OD-061 is `works`.

**Ask, unchanged:** accept CLI-only as the product's execution story, or schedule a BYOK path on
the daemon. Until you answer, W-43 is the only waiver in this matrix carrying a ⚠.

### DC-3 · Search found the thing and then refused to open it (3 rows: MC-150, MC-152, OD-166) — **fixed**

Both surfaces route through one function now, `recordHref` in `apps/web/src/lib/nav.ts:94`: a task
opens `/board?task=<id>` (the Board reads it and pops the detail panel), a project opens its
project space, an objective opens its edit dialog. Brain-dump entries stay on the capture list,
because the list *is* their only surface — stated rather than quietly treated as a fifth case.
Tested at `apps/web/__tests__/nav.test.ts`, including that a crafted id cannot smuggle a second
query parameter.

### DC-4 · Critique is one critic, not a five-panelist jury (4 rows: OD-051, OD-053, OD-054, OD-124) — **waived**

Alex approved this reduction in the merger spec's own contribution map:

> | Design quality | open-design | craft/ rules, **critique theater (single-critic first)**, design-system triad |
> — `docs/superpowers/specs/2026-08-11-ligma-merger-design.md:49`

"Single-critic first" is the approval this card was asking for; it predates the card. Per-panelist
lanes (OD-053) and an across-round ticker (OD-054) are consequences of having one panelist and one
round, not separate cuts. **Roadmap home:** *critique jury, later* — the same entry W-22 already
names for critique transcripts, so replay and panelists land together.

OD-124 is waived on a different and stronger argument: brief §3 requires "one failure-class error
model everywhere", and five bespoke critique sub-codes are exactly the synonym proliferation that
rule exists to prevent. The underlying error text rides on the card; what is refused is a second
vocabulary (W-46).

### DC-5 · Two patterns brief §2 named as "vendor this" (2 rows: OD-080, OD-081) — **one fixed, one waived**

- **OD-081 craft references — fixed.** The generator's system prompt now carries the *bodies* of
  the craft rules the design system declares, below the design-system brief, which is
  open-design's own order (`craft/README.md`). Selection is structural — the package manifest's
  `craft: {applies, suggested, exemptions}` block, plus an anti-slop baseline no brand opts out of
  — never a keyword guess over prose (brief §8). `apps/daemon/src/studio/craft.ts`, injected at
  `session.ts:96`, tested at `__tests__/studio-craft-context.test.ts`. The critic keeps the full
  slug list on purpose: a grader that can only cite rules it was handed cannot notice a design
  breaking one nobody selected.
- **OD-080 skill staging isolation — waived (W-44), and the reason is structural.** The pattern
  copies a skill directory into the run cwd so the agent works on a dereferenced copy. Ligma never
  hands a spawn a skill directory: `buildAgentPersona` inlines `skill.content` from
  `skills-library.json` straight into the prompt
  (`apps/daemon/src/engine/prompt-builder.ts:113-121`). The one on-disk copy,
  `skills/<id>/SKILL.md`, is the daemon's export for Claude Code's own discovery, written by
  `sync-commands.ts:130` and referenced by no run. There is nothing to stage. The residual risk the
  pattern guards — a builder with Write access editing the source bundle it was never given — is
  answered in ligma's own idiom by a deny rule, not a copy. **Roadmap home:** *skill-source deny
  rule*, alongside the existing oracle deny rules in `engine/config.ts:320`, where the mechanism
  and its tests already live.

### DC-6 · Brain-dump auto-triage was wired to a path that does not exist (4 rows) — **fixed**

`route.ts:69` resolves through `ENGINE_DIR` now, the same constant the sibling inbox route uses.
The test asserts the built argv *and* that the file it names exists on disk, so the class of bug —
a spawn target that moved — cannot come back silently. The button's path was walked end to end:
`fetch("/api/brain-dump/automate")` → `next.config.ts:13` rewrite → `API_ROUTES.brainDumpAutomate`
→ the mounted module. No model was spawned to prove it; the argv is the proof.

### DC-7 · Breadth cuts on backends, forms and package profiles (4 rows) — **three fixed, one waived**

- **OD-071 — fixed.** `GET /api/design-systems/:id/file?path=` serves any file inside a vendored
  package, and the Library's declared preview pages are links rather than names. Path safety is the
  verification-file route's, reused: lexical `safeResolve` plus a realpath re-check, tested against
  traversal and a planted symlink.
- **OD-033 — fixed 2026-08-13 (commit `a1973bd`).** Widened from six to thirteen of sixteen types:
  single, multi, select, text, textarea, number, plus range/date/time/url/email/tel/switch. The
  daemon's contract is what decides, so an unlisted type is a parse failure rather than a
  silently-degraded control. File, colour and media pickers remain unported (each needs a subsystem
  ligma does not have) or are answered elsewhere (`direction-cards` is the design-system picker,
  W-16).
- **OD-060 — waived (W-41)** on the merger spec's own out-of-scope list:
  > Out of scope: … **adapter breadth beyond claude/codex/gemini** …
  > — `docs/superpowers/specs/2026-08-11-ligma-merger-design.md:72`
- **OD-061 — fixed 2026-08-13 (commit `3a00da3`).** Binary path and model were already configurable
  (DC-2 above); the live probe that was missing now exists — `backend-probe.ts` wraps
  `AgentRunner.probeBackend`/`findCliBinary` with version, config-override and auth-status reads,
  surfaced per backend in Settings with a Rescan control. Honestly partial on auth: only claude has
  a verified cheap check, gemini/codex report `"unknown"` rather than a guessed answer.

### DC-8 · Four small cockpit regressions (4 rows) — **all fixed**

- **MC-059** — `DELETE /api/goals` collects the whole subtree (both edges: the parent's
  `milestones` array and the child's `parentGoalId`, transitively), soft- or hard-deletes it,
  clears `task.milestoneId` for every deleted descendant, and prunes surviving parents' stale
  child references. Five tests.
- **MC-080** — select-all/clear lives on the pending section header at any queue size; the
  `≥BATCH_THRESHOLD` banner stays a prompt rather than the gate.
- **MC-110** — replaced the proxy with the real signal, cheaply: `GET /api/runs` stamps
  `lastOutputAt` from the mtime of the run's own append-only output file (one `stat` per running
  row per poll), and the badge measures silence from that. `startedAt` survives only where there
  genuinely is no signal — a run that has not written its first line, and merged daemon-session
  rows, which have no output file. No engine surgery was needed.
- **MC-269** — the script reads its repository from this checkout's GitHub remote, overridable via
  `REPO_SLUG`/`BRANCH`, and exits 1 with an explicit message when there is no remote. It can no
  longer configure somebody else's repository by being run unedited.


# D7.2 — Waivers

**83 waived rows**: 16 automatic (MULTI-USER) + 67 argued. The automatic class is cited once in
§R above. W-39 … W-46 were added on 2026-08-12 when the eight decision cards were worked; forty-seven
rows closed on 2026-08-13 (§D7.1, §D7.3) — the first twenty emptied W-24, W-25, W-39, W-42 and W-45
and thinned W-17 and W-36 to one row each; fifteen more (studio deep links, composer garnish, critique
replay, the reference/design-files/notes workspace stages, and the MCP-server/registry/handoff trio)
emptied W-4 and W-11 and thinned W-9, W-20, W-22 and W-35 to one row each; twelve more (cross-session
agent memory, library facets/ranking/bookmarks/use-tracking/authoring guides, the design-system
creation wizard and brand extraction) emptied W-7 and thinned W-29 to four rows and W-6 to three —
their entries stay below for the numbering's own history. W-43 is the only waiver in this table that
still needs Alex's word.
The 46 argued waivers:

| # | Waiver | Rows | Argument · roadmap home |
|---|---|---|---|
| W-1 | 3-step onboarding modal | MC-156 | Replaced by five milestone-scoped one-shot hints (OD-085). A modal behind a scrim contradicts "the rail never disappears" (UX spec §4); coverage went from one first-visit tour to five moments. |
| W-2 | Bearer-token API gate | MC-164 | Brief §8: single user, localhost, no auth. The daemon binds `127.0.0.1` only (`apps/daemon/src/server.ts:16`) — the parent's gate protected a port ligma does not open. |
| W-3 | Onboarding wizard page + first-run cascade | OD-003, OD-027, OD-084 | Same as W-1: ligma's onboarding is milestone hints, not a wizard route. |
| W-4 | Deep links to a conversation / open file | *(none — closed 2026-08-13)* | Closed: OD-005 moved to `works` on commit `ba29df0`, which added `?session=&file=` query params to the Studio route — the same idiom as board's `?task=` — wired into `StudioSurface` so a requested design/file wins over the page's own defaults when present. |
| W-5 | Automations page | OD-006, OD-105 | **Argued mapping.** The parent's page was ORPHANED — no rail entry, URL-only — so no reachable capability existed to match. Ligma's equivalents *are* reachable: the `/settings` Schedule card (add / edit cron / enable / remove, `settings/page.tsx:178`) and journey smoke schedules riding the same `node-cron` scheduler (`engine/smoke.ts:68`, `scheduler.ts:87`). Outcome reporting is the morning smoke digest — one Inbox message per window built from run manifests and signed verdicts, never from prose (`engine/smoke.ts:245`) — which reports *what the run proved*, where the parent reported aggregate metrics. Not waived for absence; waived because the shape differs and the ligma shape is the argued-better one. The one honest gap: no aggregate success-rate view. |
| W-6 | Plugins, marketplace, community | OD-013, OD-160, OD-161 | Ligma is a single-user local factory with no registry, no remote and no publishing story. A marketplace needs a second party — sharing, community and self-hosted-registry rows stay waived on that ground. **Later:** none planned — say the word if you want a shared catalog. (OD-007, OD-008, OD-154 … OD-159 moved to `works` 2026-08-13 — commit `5cf020a` gave the vendored catalogs real facets, ranking, use-tracking, bookmarks and an authoring guide; none of that needed a second party.) |
| W-7 | Design-system authoring (wizard, Figma import, rebuild jobs, revisions, brand extraction) | *(none — closed 2026-08-13)* | Closed: OD-010, OD-069 and OD-075 moved to `works` on commit `3960e4a` — the wizard writes the vendored triad (`authored: true`, vendored ids refused even with overwrite) and a guarded single-fetch brand extractor proposes tokens from a live URL. Ligma still does not import from Figma (stated non-goal, CSS-export workaround) and keeps no revision history (create + overwrite-with-confirm only) — those two gaps are cited on the rows themselves, not waived here. |
| W-8 | `/brands` legacy redirects | OD-012 | Redirect for a predecessor concept ligma never shipped; nothing to redirect from. |
| W-9 | Integrations, MCP client, connectors, Orbit, handoff, use-everywhere | OD-108 (OD-014, OD-064, OD-100, OD-101, OD-104 closed 2026-08-13, commit `8b5d465` — ligma as an MCP server, an external-server registry and a handoff menu, on a new `/settings/integrations` page) | Ligma still has no connector catalog and no Composio-style integration marketplace — Orbit's digest has no connectors to draw on; the morning smoke digest is the digest ligma has. OD-101's registry is registration-only by design: it does not wire a registered server into an agent run. |
| W-10 | Desktop Pet | OD-018, OD-129 … OD-132 | An animated companion overlay is not factory capability. **Later:** none planned. |
| W-11 | Composer garnish (sub-chips, radial template picker, placeholder carousel, starter-copy engine) | *(none — closed 2026-08-13)* | Closed: OD-022, OD-024, OD-025, OD-087 all moved to `works` on commit `ba29df0` — a sub-chip rail, a dropdown template picker, a rotating placeholder pool and a starter-prompt recommendation, all derived from the existing five project-kind chips rather than a plugin/facet catalog ligma does not have (W-13 still stands for the template *library* itself). |
| W-12 | Design-system chip on the composer | OD-023 | **Already an accepted waiver** — P3-E, `docs/DECISIONS.md` Phase 3: "No design-system chip on the composer (belongs to Studio/Library)." The picker exists at Studio session start. |
| W-13 | Non-prototype artifact kinds: decks, images, video, audio, media providers, prompt templates | OD-026, OD-039, OD-042 … OD-045, OD-093 | Ligma's Studio designs the product it is about to build; open-design was also a content-generation tool (93 image/video prompt templates, 15 deck templates, 11 HyperFrames, Suno/Lyria audio). That product line is out of the merged product's mission (brief §1: *you direct; it builds; it proves*). **Later:** Studio artifact kinds — the largest single deferral in this matrix, roadmap home needed before it is forgotten. |
| W-14 | `@`-mention of skills at prompt time | OD-028, OD-082 | Skills bind to crew agents (`team/[role]/page.tsx:148`) rather than to individual prompts — one assignment model, not two. |
| W-15 | Cosmetics (pixel-scan logo, edge auto-scroll, GitHub stars) | OD-030, OD-031, OD-167 | Branding animation and a star counter; no capability behind them. |
| W-16 | `direction-cards` visual-style picker | OD-035 | The design-system picker is ligma's visual-direction chooser, and it is backed by real vendored token triads rather than mood blurbs. |
| W-17 | Multi-step forms + optional-form auto-continue | OD-037 (OD-036 closed 2026-08-13, commit `a1973bd` — review-only Back + Skip) | Discovery runs up to three *sequential* forms (`engine/discovery.ts:43`); a form that auto-continues after 10 minutes exists to unblock an idle agent, and ligma's discovery does not idle. |
| W-18 | Partial-JSON streaming parse | OD-038 | Brief §8 forbids extracting structured data from partial free text; ligma parses the complete reply through zod and renders the form when it is whole. |
| W-19 | Pixel-accurate mobile device frames | OD-046 | Sized device viewports (390×844 / tablet / desktop) carry the review; frame art is decoration. |
| W-20 | Reference browser / mood board / refresh-existing-codebase | OD-047 (OD-048, OD-137 closed 2026-08-13, commit `9e83f2f` — per-project reference/mood board, base64 uploads with a size cap) | Ligma's brownfield story is *adoption* — infer the boot recipe, boot it, characterize it, record a baseline centrally. Rebranding someone else's components in place is a different product. **Later:** brownfield restyle, post-campaign roadmap. |
| W-21 | Syntax-highlighted code viewer, React render mode | OD-049, OD-050 | The version rail shows exact file-level diffs over content-addressed snapshots; the srcdoc path is HTML-only by an in-file decision. |
| W-22 | Critique replay + per-skill critique policy | OD-058 (OD-057 closed 2026-08-13, commit `7506095` — critique replay from persisted `.ndjson` transcripts at 1x/2x/4x, live and replay sharing one reducer) | A per-skill policy override still needs a policy, and ligma's critique lane is unconditionally on (OD-052) — nothing to override. |
| W-23 | Data-driven adapter architecture | OD-059 | An internal authoring property ("adding a CLI is a one-file change"), not a user-facing capability. The user-facing count is R-OD-060. |
| W-24 | Provider/agent/model test surfaces and their failure copy | *(none — closed 2026-08-13)* | Closed: OD-065, OD-086, OD-088, OD-117 … OD-119, OD-128 all moved to `works` on commit `3a00da3`, which shipped the provider-test screen this waiver was waiting on (the live per-backend probe in Settings). The *pattern* brief §2 named — failure-class-aware error recovery — is vendored and enforced: one card family, one right action per class, wired at every agent-failure site (`components/failure/`, E-p4 P4-B), with `causeKind` produced structurally and `auth` deliberately left unwired rather than regexed out of CLI output; it now decorates a real surface instead of waiting for one. |
| W-25 | Catalog **size** (151 design systems, 100+ skills) | *(none — closed 2026-08-13)* | Closed: OD-067 and OD-077 moved to `works` on commit `c94b610`, which vendored all 151 design systems and 136 skills byte-verbatim (26 upstream-MIT skills excluded, named in `NOTICE.md`); OD-077's skill catalog was then wired to a route and a Library tab (`c734bf5`). What was reversible with "one `cp` each" (`docs/DECISIONS.md` Phase 1) has been. |
| W-26 | i18n beyond English | OD-073, OD-095 (language half), OD-107, OD-170 | Single-user, English install. `@ligma/i18n` is intact, error-code coverage is test-enforced (`err-codes.test.ts:9`), and missing keys render `⟦key⟧` rather than falling back silently — adding a locale is a JSON file. **Later:** localization, post-campaign roadmap; no user has asked. |
| W-27 | Upstream author tooling (`pnpm guard`, contributing pipeline) | OD-074, OD-083 | These gate what ships in *open-design's* catalog. Ligma is a downstream consumer of a vendored snapshot. |
| W-28 | `od:` frontmatter extensions | OD-078 | Every `od:` key (surface, scenario, preview type, critique policy, design-system requirement) addresses a subsystem ligma does not have; `SkillFrontmatterV1` carries the keys ligma's runtime honours. |
| W-29 | Settings sections ligma has no subsystem for | OD-089, OD-090, OD-096, OD-098 | Ligma's `/settings` governs what ligma has: schedules, execution config, demo data, checkpoints. Media providers, notifications and About govern absent subsystems; an empty section is the "present but stubbed" defect brief §3 forbids. (OD-092 moved to `works` 2026-08-13 — commit `8e24449` gave ligma a real memory subsystem.) |
| W-30 | Cloud identity and its consent surfaces | OD-094, OD-169 | Brief §8: single user, localhost. Ligma ships no analytics, no session replay and no cloud account — there is nothing to consent to and nobody to sign in as. Parity **+** on privacy. |
| W-31 | Project-locations settings | OD-097 | Greenfield products land in `~/ligma-products/<slug>`; adopted repos keep their own path. **Later:** configurable product root, post-campaign roadmap. |
| W-32 | `<artifact>` block extraction | OD-116 | Ligma's studio agent writes files through directory-scoped MCP tools; there is no plain text stream to carve artifacts out of. |
| W-33 | `od://` font-loading recovery | OD-120 | Self-heals a failure mode created by open-design's custom Electron protocol. Ligma's web face is served over HTTP; the bug cannot occur. |
| W-34 | OD Cloud balance gates, auth-retry, low-balance plans | OD-121 … OD-123 | **Argued mapping.** Ligma's spend gate is the quota governor, not a dollar balance: hard block on kill switch or reserve floor, soft path as a calm deferral with `resumesAt` on the failure card, both visible in the rail's governor gauge and the `/runs` quota card. Continuation after a failure is the retry queue plus backend failover. Same job — protect the user's allocation and resume politely — different currency. |
| W-35 | Extensible tab launcher, side chat, design-files tab | OD-133 (OD-134, OD-138 closed 2026-08-13, commit `9e83f2f` — References/Design Files/Notes as three more fixed pipeline stages, not a registry entry) | The pipeline strip *is* the project navigation (UX spec §4), deliberately fixed and shape-adaptive. An open-ended tab registry is precisely the mechanism that let open-design ship two tabs nobody could reach. OD-134's Notes panel is a reduced, honestly-scoped shape (an append-only thread, not chat) rather than full parity — see its row. |
| W-36 | Terminal (PTY) tab, blank-page creator | OD-136 (OD-135 closed 2026-08-13, commit `47859a0` — a command console over the PTY bridge, not a live tty) | **Flag-off in the parent**: `ENABLE_TERMINAL_WORKSPACE_ENTRYPOINT = false`, `ENABLE_BLANK_PAGE_WORKSPACE_ENTRYPOINT = false`. No capability was reachable there, so neither was strictly owed — ligma shipped the Terminal tab anyway, honestly scoped to what `pty-bridge.ts` actually does (exec-and-wait, no mid-command output). Blank-page creator stays waived; nothing analogous exists. |
| W-37 | In-app updater popup | OD-168 | Ligma runs from its own checkout; `pnpm ligma:pull` is the update path. An installer notice needs an installer. |
| W-38 | Cross-tab config sync | OD-171 | A single local user with one window; `next-themes` already syncs the only cross-tab key that exists (theme). |
| W-39 | Discovery control types beyond the common six | *(none — closed 2026-08-13)* | Closed: OD-033 moved to `works` on commit `a1973bd`, which widened six types to thirteen — adding range, date, time, url, email, tel and switch to single/multi/select/text/textarea/number. The daemon's `z.enum` is still what decides, so an unlisted type is a parse failure rather than a dead field (`engine/discovery.ts:106-120`; test `__tests__/discovery-controls.test.ts`). File, colour and media pickers remain unported — each needs a subsystem ligma does not have — and `direction-cards` is answered elsewhere (the design-system picker, W-16). |
| W-40 | Critique panelists, per-lane scores, across-round ticker | OD-051, OD-053, OD-054 | **Alex-approved reduction, cited.** Merger spec contribution map: *"Design quality \| open-design \| craft/ rules, **critique theater (single-critic first)**, design-system triad"* (`docs/superpowers/specs/2026-08-11-ligma-merger-design.md:49`). "Single-critic first" is the approval; per-panelist lanes and an across-round trend are consequences of one panelist and one round, not separate cuts. The single critic is also better fed than it was: since OD-081 the generator reads the same rule bodies the critic grades by. Critique-run replay (W-22, OD-057) landed 2026-08-13 on its own — the transcripts a jury would also need are already being written. **Later:** *critique jury* — panelists and lanes, the remaining half of this waiver. |
| W-41 | CLI adapter breadth | OD-060 | **Alex-approved reduction, cited.** Merger spec, *Out of scope*: *"Multi-tenancy/RBAC/auth beyond localhost (single user stands), SQLite, HyperFrames/video, **adapter breadth beyond claude/codex/gemini**, marketplace backend."* (`docs/superpowers/specs/2026-08-11-ligma-merger-design.md:72`). Three backends is the scope as written, and ligma keeps gemini, which open-design retired. **Later:** none planned. |
| W-42 | Per-agent probe (version, auth state, model list, rescan) | *(none — closed 2026-08-13)* | Closed: OD-061 moved to `works` on commit `3a00da3`. Binary path and model were already editable per backend in Settings (`settings/page.tsx:526`, landed 2026-08-12); the live probe that was missing now exists — `backend-probe.ts` wraps `probeBackend`/`findCliBinary` with version, config-override and auth-status reads, a Rescan route invalidates the cache, and the agent picker is genuinely live. Honest remainder: gemini/codex auth reads `"unknown"` — only claude has a verified cheap check (`auth status --json`), and neither of the others exposes a documented flag to guess from. |
| W-43 | BYOK — provider proxy, API-key field, base URL, model discovery | OD-063, OD-162 … OD-165 | ⚠ **Needs Alex's sign-off — the one waiver here that is a product question, not a defect.** Ligma's backends are CLI-subscription by design: principle 9 prefers Alex's own `claude -p`, the governor meters a subscription window rather than a dollar balance (W-34), and `docs/DECISIONS.md` Phase 3 records the daemon dropping `@ligma/providers` deliberately. BYOK is not a missing screen but a second execution path with its own key storage, SSRF guard, model catalog and failure taxonomy. What ligma's provider configuration *does* consist of — which binary, which model, which failover — is on the Settings screen as of 2026-08-12 rather than hand-edited JSON, which closes the model-id half of OD-164. **Later:** *BYOK path on the daemon*, unscheduled pending this answer. |
| W-44 | Skill staging isolation | OD-080 | **Nothing to stage.** The pattern dereference-copies a skill directory into the run cwd; ligma never hands a spawn a skill directory at all — `buildAgentPersona` inlines `skill.content` from `skills-library.json` into the prompt (`engine/prompt-builder.ts:113-121`), and the one on-disk copy, `skills/<id>/SKILL.md`, is the daemon's export for Claude Code's own discovery (`store/sync-commands.ts:130`), referenced by no run. The residual risk — a builder with Write access editing the source bundle it was never given — belongs to ligma's own mechanism rather than a copy. **Later:** *skill-source deny rule*, alongside the oracle deny rules at `engine/config.ts:320` where the mechanism and its tests already live. |
| W-45 | Export diagnostics panel | *(none — closed 2026-08-13)* | Closed: OD-115 moved to `works` on commit `7c88336`, which added the panel this waiver was waiting on — recent export attempts with their typed `EXPORTER_*` code and a plain-language explanation, next to the export action, backed by a localStorage attempt log (`export-diagnostics-panel.tsx`, `export-error-code.ts`, `export-history.ts`). The round-trip codes it decorates were already real (`.../export/route.ts:84`). |
| W-46 | Critique degradation sub-codes | OD-124 | Brief §3 requires "one status vocabulary … one failure-class error model everywhere". Open-design's five bespoke critique sub-codes (malformed_block, oversize_block, adapter_unsupported, protocol_version_mismatch, missing_artifact) are exactly the synonym proliferation that rule exists to prevent; the underlying error text rides on the card, so nothing is hidden, only un-duplicated. Parity **+** on the seam rule. **Later:** none planned. |

---

# D7.3 — Statistics

Current, after the 2026-08-12 decision-card pass and forty-seven rows closed 2026-08-13. The
previous column is the first pass, kept so the delta is visible rather than asserted.

| Status | Rows | Share | Was |
|---|---|---|---|
| `works` | **416** | 82.7% | 343 |
| `waived` (argued) | **67** | 13.3% | 100 |
| `REDUCED` (failing) | **0** | 0.0% | 33 |
| `waived-multiuser` (automatic) | **16** | 3.2% | 16 |
| `works-pending-live` | **4** | 0.8% | 11 |
| `unverified` | **0** | 0.0% | 0 |
| **Total** | **503** | 100% | 503 |

S1 re-triage (2026-08-13, D7 re-triage): 7 of the 11 `works-pending-live` rows moved to `works` —
MC-130, MC-132, MC-133, MC-134, MC-135, MC-136, MC-137 — once real verification-run data (7 runs
under `data/verification-runs/`, none present when this matrix was first written) was confirmed
serving end-to-end over HTTP. The remaining 4 (MC-049, MC-131, MC-138, MC-298) stay
`works-pending-live` on narrower, specifically-named gaps — see D7.4 below — not on chain d1
generally.

The 33 REDUCED rows resolved as **22 fixed in code with tests, 11 waived with an argument and a
roadmap home** (D7.1 — three more closed 2026-08-13: OD-115, OD-033, OD-061). No row is `waived`
for being hard: five of the eleven rest on a quote from the brief or the merger spec (W-40, W-41,
W-46), one on a structural fact about ligma stated in the row (W-44), and five — W-43, BYOK — are
marked ⚠ pending Alex's answer. Those five are the only cells in this matrix whose status could
still move on a word from him.

By parent:

| Parent | Rows | works | works-pending-live | waived | waived-multiuser | REDUCED |
|---|---|---|---|---|---|---|
| Mission Control (MC-001 … MC-332) | 332 | 326 | 4 | 2 | 0 | 0 |
| Open Design (OD-001 … OD-171) | 171 | 90 | 0 | 65 | 16 | 0 |

Read honestly: **mission-control was inherited, open-design was harvested.** The whole of the
parent engine/cockpit now works in ligma or is pending a live chain — all ten MC regressions were
port bugs and all ten are fixed. Of open-design's 171 rows, 90 have a working equivalent (up from
34 at the first pass, 43 after 2026-08-12, 63 after the first twenty rows closed 2026-08-13, 78
after fifteen more the same day (studio deep links, composer garnish, critique-run replay, the
reference/design-files/notes workspace stages, and ligma as an MCP server with a registry and a
handoff menu), and 90 after twelve more the same day: cross-session agent memory, library
facets/ranking/use-tracking/bookmarks/authoring guides, and the design-system creation wizard with
brand extraction) and 81 are waived, 16 of them automatically. That is the intended shape of the merge —
open-design contributed patterns and a vendored catalog, not its product — but it is still where
every capability question Alex has should be pointed. The single largest deferral remains W-13
(deck / image / video / audio artifact kinds, 7 rows) and it needs a roadmap home before it stops
being visible.

Coverage check: every ID in both inventories appears exactly once (503 rows, no gaps, no
duplicates — verified by ID sweep over this file). No row is green from memory: every `works`
carries a file:line that was opened, and the reachability claims rest on E-crawl, not on the
existence of a component. Every row moved on 2026-08-12 additionally carries a test — 51 new cases
across ten files: `__tests__/brain-dump-automate.test.ts` (2), `goals-cascade.test.ts` (5),
`runs-output-activity.test.ts` (3), `studio-export-route.test.ts` (10),
`studio-craft-context.test.ts` (7), `discovery-controls.test.ts` (3),
`design-system-file-route.test.ts` (9) on the daemon, and `nav.test.ts` (4),
`run-status.test.ts` (5), `components/studio/api.test.ts` (3) on the web. Every daemon route test
runs the handler in process against a temp store — none of them needs, or touches, a live daemon.

Suite state at the close of that pass: daemon **830 unit / 118 integration**, web **138 unit**,
`tsc --noEmit` clean on both, `next build` green — against floors of 787 + 118 and 126.

---

# D7.4 — Rows pending live campaign evidence

**Updated by the S1 re-triage, 2026-08-13** (contract `docs/CONTRACTS-port1.md` Wave 4 row S1).
Eleven rows used to sit here on one shared reason ("`data/verification-runs/` is empty"). That
premise is gone — `data/verification-runs/` now holds 7 real runs, produced by the in-flight **d2**
campaign (`d2a-design-loop` — journeys `vrun_1786554039301`, `vrun_1786581439197`, both `status:
"complete"` with real `verdict.json`s, plus 5 more in-flight/errored attempts) and the in-flight
**d1** campaign (`d1a-compose-promote`). Booting the real daemon (`tsx apps/daemon/src/server.ts`
— the no-agent-spawning API-only entry point) and `next dev` against this checkout's own `data/`,
then hitting `GET /api/verification-runs/vrun_1786581439197`, its `/file?path=` evidence routes,
its `/artifacts` listing, and the `/verification/[id]` page itself (all four `?tab=` URLs) — all
served real data at HTTP 200. Full detail is on each row above; net effect:

- **7 rows closed to `works`**: MC-130, MC-132, MC-133, MC-134, MC-135, MC-136, MC-137. The
  verification-run UI family renders real data; that no longer needs a chain to land.
- **4 rows stay `works-pending-live`, each on a narrower, specifically-named gap** — none of them
  "chain d1 hasn't landed" anymore:

| Row | Real gap |
|---|---|
| MC-049 | Needs a run with `taskId` set (a **task**-scoped verification run). Every real run on file is a journey run (`taskId: null`) — the compact-in-task-panel fetch path has nothing to fetch yet. |
| MC-131 | Verdict/reasoning/evidence proven; the **holdout badge** third is not — journey contracts (`journeyCriteria()`) never set `holdout: true`, so no real contract on file has one. Same task-scoped-run gap as MC-049 would close it. |
| MC-138 | Same task-scoped-run gap as MC-049 — `compact` shares 100% of the now-proven fetch/render code, but its only real caller is the task panel. |
| MC-298 | Not a data gap at all: `compileWithLlm` is dead code from the live app's point of view (private, CLI-only, called by nothing in production — the real promote path uses `compilePromotedContract`). A new fixture test (`apps/daemon/__tests__/compiled-contract-fixture.test.ts`) proves the shared contract schema + signing pipeline on a real live-signed contract, but that is not the same function and does not close this row. No chain will exercise `compileWithLlm` as written — it needs wiring or a waiver. |

MC-049 and MC-138 (and the holdout half of MC-131) will very likely close together, the moment any
task in this checkout gets a real, task-scoped verification run — no new mechanism, just data that
does not exist yet in this checkout.

Chain state at the time of writing: **d5 green** (`docs/evidence/campaign/d5/manifest.json`,
result `"green"`, both audit links green). **d1 and d2 in flight** (real attempts recorded under
`data/verification-runs/` and `data/contracts/`, none landed green — `vrun_1786581439197`'s own
verdict outcome is `"failed"`; `docs/evidence/campaign/d1/` and `d2/` still have no green
manifest). **d3 in flight** — `data/contracts/proj_ligma__d3-adopt.jsonl` and an ephemeral env
under `.envs/` exist; `docs/evidence/campaign/d3/` is still empty. **d4 not started.** No row in
this matrix cites a chain manifest that does not exist — the 7 rows closed above are cited to real
HTTP responses and file contents, not to a chain landing, because no chain has.

Nav-crawl re-run 2026-08-13 (`scripts/audit/nav-crawl.ts`, real daemon + `next build`/`next start`,
no LLM spawn): **result FAIL**, not the `PASS` E-crawl (`docs/evidence/campaign/d5/audits/d5-nav-crawl.json`)
recorded. `/verification/[id]` now shows as an **orphan** — real instances exist (7, confirmed) but
the crawler's BFS never clicked through to one, because it satisfies the shared dynamic-route
pattern `/projects/[id]/verify` via the *other* fixture project (`proj_oFbAe2ugPMBW`, which owns no
verification runs) before it ever expands `proj_ligma`'s own subpages — a traversal blind spot in
the crawl script itself (dedupes by route pattern across projects, not per-project), not evidence
against the feature. The same run also flags the registry's `wiredAt` line-citations for both
data-gated families as stale (`brokenProofs`) — plain line-number drift since d5, not a functional
break. This is new information for **D6** (`docs/evidence/completeness-matrix.md`'s "Zero orphan
surfaces" row, currently `complete`, cites E-crawl's now-outdated `PASS`/`ok: true` and should be
re-opened) — recorded here because it surfaced during this task, not fixed here: D6 row edits and
`scripts/audit/nav-crawl.ts` changes are both outside S1's file-ownership (matrices' pending-live
citations, the MC-298 fixture, and audit **re-runs** only — not audit-script edits or `complete` rows).

Two adjacent notes, recorded rather than hidden:

- `/adoption/[runId]` is the other data-gated family (E-crawl `conditionallyReached[0]`). It is a
  ligma-only surface with no parent row, so it has no cell here — it belongs to D6. The 2026-08-13
  nav-crawl re-run above still shows 0 instances for it (`data/adoption-runs/` is genuinely empty
  in this checkout), so unlike `/verification/[id]` its gate's `instances: 0` half still holds; only
  its `wiredAt` line-citations went stale the same way.
- MC-326 and MC-332 are marked `works` on code that was opened and read but carries no dedicated
  test (kill-switch pre-check; `--mutate` loader). They are not pending-live — the code path is
  unconditional and cited — but they are the two thinnest `works` in the harness section.

---

## Overtaken events (addendum, added 2026-08-27 — not a row edit)

Recorded here per the fix-campaign's frozen-matrix policy: the rows above are
not edited; this section lists what has changed since the 2026-08-12/14
freeze, so a reader isn't misled either direction. Current answers live in
`docs/parity/feature-track.md`.

**Retired since freeze (rows above still say `works`):**
- Inbox compose/reply/forward (MC-088/089/090) — retired to read-only; see `docs/evidence/DONE-UX.md`.
- Deck swipe surface — retired in the studio-parity rebuild.
- Board/matrix pages (`/board`, `/board/matrix`) — now 6-line redirect shells.
- `GovernorGauge` component — deleted.

**Shipped since freeze (rows above carry a "None exists" waiver that is now false):**
- **W-13** — deck kinds / slide navigation (commit `1998d65`).
- **W-14** — `@skill-name` mentions in the composer, staged as a frozen copy (`apps/daemon/src/studio/skill-staging.ts`).
- **W-16** — direction cards (`apps/web/src/components/studio/direction-cards.tsx`).
- **W-40** — per-panelist critique lanes on the studio critic panel (`apps/daemon/src/studio/critic.ts`, `critique-lane.tsx`).
- **W-44** — staging isolation (same mechanism as W-14).

**Waiver membership drift (D27):** §D7.2's waiver list for W-29/W-31 still
names OD-096/097/098; those rows themselves are separately marked
`works — c3a2356`. Headline stats (416 works / 67 waived / 16 multiuser / 4
pending-live) are otherwise still arithmetically correct against the rows as
written.
