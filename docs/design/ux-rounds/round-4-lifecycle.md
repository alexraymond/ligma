# Round 4 — Time, decay, and disaster (verbatim report, 2026-08-14)

Grounded against the code. Six situations, walked twice each (current UI / proposal + amendments A–F), marked at the exact divergence moment.

## Ground truth (each verified in the repo)

| Claim | Reality | Where |
|---|---|---|
| Checkpoints roll back a disaster | JSON snapshot of **app-state stores only** — no git SHA, no file snapshot, **no designs**. And restore does `saveActivityLog({ events: [] })` — it **wipes the audit trail** | `apps/daemon/src/store/data.ts:69-85,114-115` |
| Activity log is per-project | **Global.** `ActivityEvent` has `taskId` but **no `projectId`**; closed enum with no run/verdict/design/promote events | `packages/api/src/types.ts:301-321` |
| Undo covers actions | Undo = **undo-delete only**, 5s toast. No edit/answer/replan rollback | `apps/web/src/hooks/use-data.ts` |
| "Paused" projects stop | `ProjectStatus="paused"` is in the edit dialog; **the dispatcher never reads it** | `apps/daemon/src/engine/dispatcher.ts` |
| The version rail shows when | `DesignVersion.createdAt` is populated but **never rendered** | `version-rail.tsx` |
| Money is trackable | **No cost/token/spend field anywhere, by design** — the governor rations sessions per rolling window | `quota-governor.ts:4-7` |
| Waiting vocabulary is used | Only Studio Wall + Terminal consume `WaitingStatus`, and only `connecting`/`stalled`. `stalled` is **never time-detected** — only from EventSource close | `waiting-status.tsx` |
| Stale brief = drift detection | Fires **only when a human edits an already-compiled brief.** Never age-based | `packages/api/src/briefs.ts:163-165` |
| Verdicts know the code changed | **No commit binding anywhere.** Staleness is a hardcoded 7-day timer | `staleness.ts`, `verdict.ts` |
| Done-collapse protects boards | Wired **only on the global board**; the per-project board renders every done task uncapped | grep |
| Task archiving exists | `POST /api/tasks/archive` has **zero callers**. Dead capability | route file |
| Handoff is project-scoped | "Copy CLI prompt" embeds `data/ai-context-readable.md` — a **whole-workspace** digest | `mcp/handoff-prompt/_id/route.ts:30,54` |
| Project memory exists | It doesn't. Per-agent memory + per-repo `.ligma/project.md` Quirks. §10's "project memory, which planning already injects" describes a store that isn't there | `store/memory.ts`, `knowledge.ts` |
| Decisions record consequence | `DecisionItem` has **no field** for what an answer changed | types |

---

## Situation 1 — Returning after three weeks. 47 tray items.

**(a) Current.** WORKS through triage-mode entry (Deck's `BATCH_THRESHOLD=10` banner → list mode, bulk apply). **BROKEN at card 1:** ordering is kind-urgency then oldest-first — the first card is the **oldest decision**, the one most likely overtaken by events; nothing computes whether a question is still live. You answer a 19-day-old fork and (per amendment C) it re-plans on a three-week-old premise. Second BROKEN: bulk actions exist only for `kind === "decision"`. Third: **no catch-up story** — the activity log is global, has no projectId, and records no runs/verdicts/design turns/promotions.

**(b) Proposal.** CONFUSED at the glance: after three weeks every project with a pending decision is amber — nine projects, nine amber rings; rings encode **state**, the question is **delta**. BROKEN at §12's mapping: a project-scoped activity drawer is **unimplementable from the current activity log** (no projectId; `taskId: null` events silently vanish). Neither design has any concept of *last seen*. → **J1**.

## Situation 2 — Agents went off the rails overnight

### Move 1 — STOP EVERYTHING NOW
**(a) Current: WORKS if found, CONFUSED getting there.** The real stop is **"Disengage Autopilot"** on Runs: `stopEngine()` halts the scheduler, tree-kills every session, resets tasks. But there are **three stop-shaped affordances with three scopes**: Disengage (real), governor kill switch (gates new spawns only), project status "Paused" (**does nothing**). The panicking user's most intuitive move is the fake one.
**(b) Proposal: BROKEN — the sharpest failure in the exercise.** The global Runs page is deleted; amendment B removes the global switch; the heartbeat is specified as a vital sign, not a control; Flow B's replacement is per-project Pause with §13 Q5 **undecided** — and if Q5 resolves as dispatcher-gate-only, its semantics are exactly the cosmetic pause that already burned the user. → **J2**, **J3**.

### Move 2 — SEE WHAT HAPPENED
**BROKEN in both.** The activity enum has no run/verdict/promote/design events — eight tasks going wrong reads as undifferentiated `task_updated`. The version rail is genuinely well built (append-only, content-addressed, origins tracked) and **renders no timestamp at all** — `createdAt` is in the type and store; the component shows `v7 · prompt · 4 files · 82 KB`. → **J5** (one line).

### Move 3 — ROLL BACK
**BROKEN, with a trap.** Rollback is three unrelated mechanisms (git — outside Ligma entirely; version rail — designs; checkpoints — JSON state only). The trap: a checkpoint restores **no code and no designs**, so it cannot undo the damage; loading one **wipes the activity log** the user was just reading; restore never calls `stopEngine`, so a live agent keeps running against rewritten task IDs. The canonical sequence — stop, look, roll back — has its third step destroy its second step's evidence. → **J6**. The proposal is BROKEN by omission: checkpoints appear nowhere in §4's table; Proof gets a Ship panel, nothing gets a recover panel.

### Move 4 — "MONEY SPENT"
**BROKEN in both, structurally.** No cost model; `GovernorStatus.used` is workspace-wide. "What did last night cost" and "which project burned the window" are both unanswerable. The proposal should say so where the user asks.

### Move 5 — PREVENT RECURRENCE
**CONFUSED in both.** Available: per-agent memory (wrong scope) and `.ligma/project.md` Quirks (right scope, has an append API and composer). §10's "remember this → project memory" names a store that **does not exist**; amendments D and F depend on it. → **J8**.

## Situation 3 — The mature project: 6 months, 400 done tasks

**(a) Current: BROKEN** — the per-project board renders every done task (Done-collapse is global-board-only; `tasks/archive` has zero callers). **(b) Proposal: BROKEN, worse** — it deletes the protected board and promotes the unprotected one to Build's primary surface. → **J9**.

**"The brief is a lie now" surfaces: nowhere.** `staleFlaggedAt` fires when a human **edits** a compiled brief — the inverse event. A six-month project drifts with the brief untouched. The one card it can raise offers only "Acknowledge — the change is cosmetic": the only drift vocabulary trains the user to dismiss it. → **J10**.

**Stale verdicts:** `isStale` = age > 7 days, hardcoded. At month six every verdict is stale — uniformly true, therefore uniformly useless, with no re-prove path offered. **BROKEN in the proposal specifically:** §11's Proof header is `proven/pending/waived` — `stale` is missing, so the header reads "312 proven" over a list where all 312 pills read *stale*. That is review finding M3 reintroduced by the new spec. → **J11**. Underneath: staleness is a **timer, not a fact** — a verdict binds to contract version, never a commit; wrong in both directions. → **J12**. Baselines compound it: `writeBaseline()` has no expiry and no audit.

**Does the four-stage model decay gracefully? No — into 50% dead navigation.** At month six Brief and Studio are visited never; Build and Proof carry everything; the things that matter (archive the pile, re-prove stale, "what changed this week", is the brief true) have no home in any stage. Beautifully shaped for month one, no month-six shape.

## Situation 4 — Quota exhausted / daemon down

**(a) Current, quota exhausted: WORKS, genuinely well.** `DenyReason` + `deferralFields()` computing `resumesAt` for every reason except kill-switch — "a stop somebody deliberately threw would be a lie with a clock on it" is the best line of product thinking in the codebase. BUT the waiting vocabulary is **two parallel systems**: `WaitingStatus`'s queued/deferred/running render in **no real surface**; `run-row` has its own third formatElapsed. **It shipped as a type and a test, not as a system.** And **`stalled` is never detected** — amendment E presumes a signal the product doesn't compute.

**(b) Proposal, quota exhausted: BROKEN at day zero.** Flow F (discovery in Talk) + §13 Q3 (Talk through the governor) + amendment A (auto-enter with discovery open) compose to: a new user's first-ever interaction replies **"deferred, resumes ~14:30."** Today discovery is synchronous. → **J7** (the fix is the human reserve that already exists).

**(c) Daemon down: BROKEN at the signature feature.** Today "Couldn't load the daemon" renders on exactly two pages (Runs, Settings); everywhere else last-confirmed data + an unrendered `error` field make a dead daemon look like a calm app. The proposal deletes Runs, demotes the gauge, and makes **rings computed from possibly-stale collection data** the primary ambient system: a dead daemon leaves a pulsing blue "building" ring on a project where nothing has run for six hours. §3's "frozen-dashboard class becomes structurally impossible" is false as written — the rings reintroduce that bug class at higher prominence. → **J4**. Also: the proposal ends up with **two heartbeats** (governor gauge, autopilot heartbeat) for one machine.

## Situation 5 — Showing a client / handing over

Single-user by construction (loopback bind, no accounts; `Project.teamMembers` is AI agent IDs — a naming trap). **Showing a client:** no share link, no present mode; the graceful catch is **design export** (zip/pdf/html/pptx from a content-addressed snapshot) — WORKS if found. CONFUSED in the proposal: the Ship panel lives in Proof (post-build) while client review happens at Studio time — two export-shaped affordances in two stages meaning different things. → **J13**. Client-in-the-chair clicks create **pins with no author field** — accidentally a great review feature, unsafe unlabelled.

**Handing to a colleague: BROKEN, and it's a leak.** "Copy CLI prompt" embeds the workspace-wide `ai-context-readable.md` — other projects' inboxes, decisions, brain dump — to the clipboard. → **J14** (privacy bug, not a UX nit). Underneath, a real split nothing surfaces: `.ligma/` travels with the repo; designs/decisions/verdicts/brief/memory do not. → **J15**.

## Situation 6 — The out-of-band edit

11pm, you fix the bug yourself; or a colleague pushes to main; Ligma has 12 tasks planned against the code as it was. **Ligma stores no git state anywhere** — no SHA on a run, verdict, checkpoint, or task. Consequences, all BROKEN in both designs: nothing detects divergence (first symptom is a wrong-looking diff inside an agent session); verdicts survive edits they shouldn't (green until day 8, for the wrong reason); the four-stage model has no inbound edge for change arriving from outside the loop; checkpoint restore rewrites state across an unrecorded commit boundary. → **J12** — one SHA field, one `git rev-parse`.

---

## Amendments J1–J16

**J1 — "Since you were last here."** One `lastSeenAt`; tray header line ("While you were away: 12 decisions · 40 tasks done · 3 verdicts · 2 designs changed") + a `since` filter; suppressed under a day.
**J2 — Stop everything survives amendment B.** Clickable heartbeat → **Stop everything**, calling existing `stopEngine()`; aftermath shows N killed / M reset with links to the three rollback routes. B removed a global start; this restores a global stop. Start and stop do not need symmetry.
**J3 — Delete or wire the fake pause.** One dispatcher condition, or remove the option. Resolve §13 Q5 as **stops running agents**.
**J4 — Status rings need a no-signal state.** `useDaemon` already polls and exposes failure; desaturate all rings + mark rail offline. One boolean, one class.
**J5 — Render `createdAt` in the version rail.** One line.
**J6 — Checkpoint restore must stop lying and stop deleting.** (i) delete the activity-log wipe; (ii) `stopEngine()` before load or refuse while live; (iii) one sentence of scope copy.
**J7 — Discovery and Talk draw from the human reserve.** Classify as human-class on the existing `reservePercent` knob. Resolves §13 Q3; protects day zero.
**J8 — Name where "remember this" lands.** Point Talk/reject-notes at `.ligma/project.md` Quirks (exists, append API, travels with repo). Correct §10's claim.
**J9 — Per-project board inherits the Done collapse.** One prop; optionally wire the orphan archive endpoint behind it.
**J10 — Brief drift needs an age trigger.** Brief unchanged N months while M tasks completed → existing `stale-brief` card with honest options: Re-run discovery / Still true (snooze 90d). Cannot fire on a young project.
**J11 — `stale` joins the Proof header counts.** `proven / stale / pending / waived`; stale included in "still unproven." Review finding M3, caught in the spec this time.
**J12 — Bind verdicts and runs to a commit SHA.** The one non-trivial amendment: new field + `git rev-parse`. Replaces the 7-day timer (wrong in both directions) with a fact; makes out-of-band edits visible. Ship the field before the UI.
**J13 — Two exports, two names.** Studio: **"Share design"** (pre-build, client). Proof: **"Hand off"** (post-proof, code). Label the canvas when pins are being taken by a guest.
**J14 — Handoff must be project-scoped.** Delete the workspace snapshot append; treat as a privacy bug.
**J15 — Say what travels.** Two strings: the `.ligma`-vs-`data/` split at handoff; an honest ⌘K result for share/invite/present.
**J16 — Two data gaps the adopted amendments depend on.** `projectId` on ActivityEvent (else §12's drawer is unimplementable and project-less events vanish); a consequence link on DecisionItem (else amendment C has no data and will be tempted into LLM-summarising free text — forbidden; fix the data model).

**Not proposed, deliberately:** per-project cost attribution (no cost model; say "N sessions, attribution not tracked"); a stall-detection heuristic (scope E to what PID-death already detects); any new recovery page.

## Conflicts

- **J2 vs B:** stopping should be one button everywhere even though starting is per-project and deliberate. If you want B pure, Situation 2 has no answer.
- **J12's size:** every other amendment is a line/field/string; J12 introduces git awareness. Right fix, not small.
- **J10 + J11 make the product look worse:** a six-month Proof reads "312 proven · 300 stale" where today it reads "312 proven." Honest; someone will file it as a regression.
- **No day-one cost:** J1, J3, J4, J5, J6, J8, J9, J10, J11, J13, J14, J15, J16. J7 protects day one.
- **Watch:** J1 + E both push more into the tray; ship J1's `since` filter in the same change as E.

## What holds up

The version rail's append-only restore is the correct disaster model — show its timestamps, don't change it. The governor's refusal to put a clock on a deliberate stop is excellent. Deck's BATCH_THRESHOLD anticipates scale. `stopEngine()` is fast, real, complete — it needs a home. Flow C's instinct (tray for triage, in-context echo for judgement, never two sources) is the right shape for every situation here.
