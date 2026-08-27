# Round 3 — Power-user stress test (verbatim report, 2026-08-14)

**Method.** Read UX-REDESIGN.md Parts 1–2, ui-ux-review.md, mechanics/findings.md, plus a grounded capability inventory over apps/web, apps/daemon, apps/cli, packages/api. Amendments A–F taken as adopted. No code run.

**Three facts that decide most verdicts:**

1. **Cost is un-recorded, not just un-shown.** `data/quota-ledger.json` stores `{ts, backend, role, ref}` per spawn. `GovernorStatus` exposes `used/max/reserveFloor/remainingForAutonomy/backends/killSwitch`. No tokens, no dollars, no duration anywhere in the live product.
2. **The Terminal is not a terminal.** `pty-bridge.ts` uses `child_process.spawn` with pipes and **stdin closed immediately**, one command to completion, 2-minute timeout, no mid-command output. It is a command runner wearing a terminal's name.
3. **There is no record of what an agent was told or what it changed.** `buildTaskPrompt`'s output is passed to spawn and never persisted. Zero hits repo-wide for diff rendering or `git status|log|diff` for project display.

---

## Persona 1 — Ravi, senior dev. Keyboard-first, trusts nothing summarized.

| # | Flow | Current | Proposed + A–F |
|---|---|---|---|
| R1 | Read the diff a completed task produced | **BROKEN** | **BROKEN** |
| R2 | Tail a live run like `tail -f` | CONFUSED | **WORKS** |
| R3 | See the exact prompt the agent received | **BROKEN** | **BROKEN (worse)** |
| R4 | Navigate and act entirely by keyboard | WORKS | **BROKEN** |
| R5 | Get a shell in the project repo | CONFUSED | **BROKEN** |
| R6 | Adopt a repo, skip ceremony, write tasks | WORKS | CONFUSED |

**R1 — the diff.** He clicks a Done card expecting "Files changed" and gets an SDK transcript plus verdict criteria. Amendment D makes the asymmetry sharper: he is invited to **reject a verdict** on work whose diff the product cannot show him.

**R3 — the prompt.** Talk makes the absence actively dangerous: he types "@builder what prompt did you get?" — and because the prompt was never persisted, any answer is an LLM **reconstruction presented as a record**. Violates the standing rule about deriving structured facts from free text.

**R4 — keyboard. The sharpest regression in the proposal.** `keyboard-shortcuts.tsx` ships a `?` sheet and a `G`-prefix chord map to twelve destinations. **Nine of twelve are destinations the redesign retires.** §3 says "⌘K becomes the only 'go anywhere'", but today's ⌘K is a cmdk **search** capped at 5 results per group — it cannot reach a stage or invoke an action. Compounding: Flow A's rail rings are **colour with no text equivalent** — an accessibility failure before a power-user one.

**R5 — the shell.** Current label overpromises (stdin closed, 120s cap, no REPL). The redesign scopes it to Build; he wants it in Studio while judging a design.

**R6 — escape hatch.** Amendment A plus Flow F leaves no documented exit from discovery-as-conversation. Right for the median user; a toll booth for him.

---

## Persona 2 — Marco, agency operator, 12–15 concurrent clients.

| # | Flow | Current | Proposed + A–F |
|---|---|---|---|
| M1 | Monday triage across 15 clients | **BROKEN** (3 rival numbers) | CONFUSED |
| M2 | "What did Acme cost me this month?" | **BROKEN** | **BROKEN (worse)** |
| M3 | Clear 40 decisions in batch | WORKS | **CONFUSED → BROKEN** |
| M4 | "What's running right now, everywhere?" | WORKS | **BROKEN** |
| M5 | Onboard three clients before lunch | CONFUSED | CONFUSED |
| M6 | Which client misses Friday? | **BROKEN** | **BROKEN (regression)** |

**M1.** The tray merge fixes the review's F14 (one badge, one number). It fails on *shape*: focus mode is one card at a time in arrival order — he context-switches clients every card, 40 times.

**M2.** Not a missing view — a missing measurement. The proposal demotes the only spend signal (QuotaCard on /runs → "tiny heartbeat"). The ledger already carries `ref` and `role`, so the **rollup** is a join away; the **tokens** genuinely are not captured.

**M3.** Deck batch mode is good engineering (select-all → atomic `PATCH /api/decisions/bulk`, idempotent, per-item undo). The proposal promises only that focus mode stays; list/batch mode is never mentioned. Worse: the global `/board` carries an All-Projects filter + `BulkActionBar` — **cross-project task batch operations have no home anywhere in the proposal.**

**M4.** `/runs` has 12 inbound links and `GET /api/runs` returns every active run. §4 replaces it with "a lens in the tray's header line" — a header line cannot carry project × task × elapsed × agent × state for fifteen clients.

**M6.** `Goal.timeframe` is a free-text string; no timeline exists in either design. But retiring `/objectives` removes the only surface showing goals across projects — a regression on a pre-existing gap.

---

## Persona 3 — Dana, control skeptic.

| # | Flow | Current | Proposed + A–F |
|---|---|---|---|
| D1 | Nothing runs without my approval | **BROKEN** | **BROKEN (regression)** |
| D2 | Kill everything, now | **WORKS** | **CONFUSED (dangerous)** |
| D3 | Audit every token | **BROKEN** | **BROKEN** |
| D4 | What happened while I was away | WORKS | CONFUSED (regression) |
| D5 | Reject a verdict with a reason | **BROKEN** | **WORKS** |
| D6 | Prove it can't act while I'm away | **WORKS** | **WORKS** |

**D1.** No pre-act gate exists; every approval is post-hoc on an artifact. Her substitute gate was the global autopilot toggle — and **amendment B reframes it as a hidden switch to be eliminated, while making design approval also start the machine.** The cheap fix is already server-side: `promote/preview` → `promote` is *already* two steps.

**D2.** Current is better than the docs suggest — per-run interrupt with tree-kill, per-run defer, daemon stop, governor killSwitch, `touch data/governor-kill`. The redesign deletes `/runs` (where row-level interrupt lives) and introduces **Pause project** defined as a dispatcher gate that does not stop running agents. *She hits the loud new button mid-bad-run and watches the agent keep writing files.* One word covering two guarantees is how this persona is lost permanently.

**D4.** `/activity` (global, with undo) becomes a per-project drawer — and the tray header is being asked to carry two different cross-project tables (this and M4's).

**D5 — genuinely fixed** by amendment D. Caveat from R1: she is judging work whose diff the product cannot render.

**D6.** Worth telling her what the product never says: `PUT /api/daemon` **403s on `skipPermissions`**. A strong, quotable safety property with zero surface area.

---

## Persona 4 — Sam, the unsticker. Inherits a workspace where nothing has moved in six hours.

| # | Flow | Current | Proposed + A–F |
|---|---|---|---|
| S1 | "Nothing has moved in 6h. Why?" | CONFUSED | **BROKEN** |
| S2 | "Is the tray empty, or blind?" | **BROKEN** | **BROKEN** |
| S3 | Fix a failing boot gate | **BROKEN** | **BROKEN** |
| S4 | Restart the machine cleanly | WORKS | WORKS |

**S1 — the clearest hole in the mapping table.** Her answer is one of four governor deny reasons: `kill-switch | reserve | window-exhausted | backend-cooling`. Today that lives across /runs's QuotaCard, `pnpm governor:status`, and `/api/logs` (a 500-line daemon tail with **zero UI consumers**). The redesign deletes /runs, shrinks the governor to a gauge, and neither `/api/logs` nor daemon state appears in §4's table. *There is no stage that owns "the machine itself is unwell."*

**S2 — amendment E's blind spot.** E escalates a *project's* stalled run. A **global** stall — daemon down, credits out, backends cooling — has no project to escalate to. Combined with fetch-failure-as-empty degradation: *the daemon dies at 02:00 and the badge reads 0 all night, indistinguishable from a quiet night.*

**S3.** `.ligma/boot.json` is detected by preflight but the fix editor exists only on the adoption review page. Under four stages, "this project's environment is broken" has no owner.

---

## Two structural findings

**No home for objects whose defining property is "not yet a project."** `Goal.projectId` is nullable and /objectives renders those goals; §12 retires the page into Build's Plan view, which is project-scoped. Brain-dump becomes "a Talk affordance", but §10 defines Talk as project-scoped. Two whole object classes get mapped into surfaces that structurally cannot hold them.

**"Nothing is deleted" (§4) is not true.** Checkable list: daemon logs //api/logs; the global /board's All-Projects filter + BulkActionBar; the G-chord keyboard map (9 of 12 targets); project-less goals; pre-project capture.

---

## Scale, answered directly

**Rail: as a switcher, ~11; as a dashboard, ~6.** At 64px rail, 40px avatar, 48px pitch, minus mark and bottom cluster: 10 avatars before scroll on a 13" laptop, 11 on 14", 13 on 16". Initials collide ("Acme Corp"/"Acme Health" → "AC"), no grouping/pinning/overflow rule stated, four-colour rings with no legend. The dogfood store has 2 projects; never exercised near 15.

**Tray: fine to ~12, degraded by 20, unusable past ~25.** `/api/deck` and `/api/runs` have no pagination; where the server paginates, `fetchAllPages` defeats it; no virtualized list in the app. The only thing that makes 40 tractable today — Deck's select-all + bulk PATCH — is not promised to survive.

---

## New amendments (H1–H13)

**H1 — Machine overlay behind the top-bar heartbeat.** Clickable heartbeat → today's /runs content: daemon state, governor window **with deny reason**, backends cooling, kill switch, `/api/logs` tail (currently zero consumers). State the safety posture (`skipPermissions` refused).

**H2 — Tray gets three tabs: Needs you · Running · Activity.** Reuse `/api/runs` and `/api/activity-log` as /runs and /activity render them today. Default stays Needs you.

**H3 — Tray keeps list mode, group-by-project, select-all, "Open as page."** Focus mode default **under a threshold** (~8 items); above it, grouped list with the existing bulk bar. Threshold, not a preference.

**H4 — Rail overflows into a portfolio grid; the grid is the dashboard past ~8.** Pinned + most-recently-active in the rail, then a "+7" chip → the /projects grid with status chips, sortable columns, and goals — a successor for Objectives and a home for null-projectId goals.

**H5 — Record cost in the ledger; roll it up per project.** Add `tokensIn/tokensOut/costUsd/durationMs` to LedgerEntry (already carries `ref`/`role`). **The only amendment that is an engine change.** Without it, agency use is not commercially possible.

**H6 — Three stop-shaped verbs, never one word.** **Pause dispatch** · **Stop running (N)** (existing per-run interrupt) · **Kill switch** (global, Settings/H1). Stop's confirmation names what is already written to disk. Answers §13 Q5 as "both — but never under one label."

**H7 — Task detail gets Changes · Log · Prompt.** Two need engine work: persist `buildTaskPrompt` output beside the run JSONL; capture the task's `git diff`. Log stays the default tab.

**H8 — An exit from discovery.** First system message carries "I'll write the brief myself." One link, inside the conversation.

**H9 — Kickoff enters the project only when you have nowhere else to be.** From the empty state, navigate (amendment A); from inside another project, the avatar pulses + toast, no navigation.

**H10 — The shell is project-scoped, and gets an honest name.** Move beside Talk; rename to "Run a command." The rename is the smaller and more valuable half.

**H11 — Keyboard parity for everything the rail says in colour.** (i) Rebuild ⌘K as a command palette reaching project → stage and invoking verbs; (ii) remap the G-chords and `?` sheet in the same commit that ships the rail; (iii) every ring state appears as a word in ⌘K rows and the tray.

**H12 — "Nothing waiting" ≠ "can't tell"; a stopped machine is itself a tray item.** The deck already composes six sources server-side; this is a seventh. Highest trust-per-line item on this list.

**H13 — Cross-project task operations survive as a tab of H4's grid.** Keep the All-Projects filter and BulkActionBar/`PATCH /api/tasks/bulk`.

**One-line fix:** `use-everywhere/sections.ts` tells users "ligma has no MCP server" while `apps/daemon/src/mcp-server.ts` ships six tools including `answer_decision`. The app denies its own best escape hatch exists.

---

## Conflicts

1. **H7** risks CLI-wrapper feel for newcomers → Log default, Changes/Prompt never auto-expand.
2. **H3** risks the calm of one-card mode → item-count threshold, never a preference.
3. **H6** is three stop-shaped buttons → only Pause always visible; Stop appears when N>0; kill switch stays in Settings.
4. **H1** reintroduces a dashboard → bounded risk: live read of two endpoints, not an aggregate of nine. Better stated than hidden.
5. **H8** undercuts Flow F's thesis → a link inside the thread, not a fork before it.
6. **H5** makes a hobbyist product feel metered → cost on project card and run row only; session language stays primary.
7. **H2** turns the interrupt surface back toward a destination → accepted, bounded to two extra tabs.

**The meta-conflict:** the two adopted amendments this population resists hardest are **A** (removes the fast path in) and **B** (removes the stop). Both need escape hatches — H8 and H6 respectively.

## What the proposal gets right

The tray merge kills a real bug class (F14). In-context decision echo is correct. Amendment D is genuine new capability. Per-project pause: every persona wants it. Amendment F respects §10's own rule. Retiring the global dashboard does structurally kill the staleness class.

**The honest summary:** the redesign is a strong answer to *navigation* and a weak answer to *scale, observability, and control*. It is optimized for one user with two or three projects — exactly the shape of the dogfood store it was designed against.
