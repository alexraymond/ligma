# Ligma — experiential walkthrough

> **Closed.** This is a raw defect inventory, not a live status — read
> [`../ui-ux-review.md`](../ui-ux-review.md) first for the synthesis, and
> [`../../evidence/DONE-UX.md`](../../evidence/DONE-UX.md) for the campaign
> that closed the findings here. Several surfaces described below (Board,
> Priority Matrix, StoryForge cards) have since been redesigned or retired —
> reading this file directly (rather than via ui-ux-review.md) will describe
> screens that no longer exist as if they were current.

**Method.** Production build (`next build` + `next start`) on `:3111`, daemon `tsx apps/daemon/src/server.ts` on `:4319` — no dispatcher, no agent spawning. Two data roots: the repo's dogfood store and a throwaway empty dir for the first-run pass. 42 `page.tsx` exist; 8 are redirect stubs, so **34 real surfaces** — all 42 URLs visited, plus 12 fresh-install surfaces, 8 journey surfaces and 8 throttled loading frames. One caveat on "zero LLM spawns": pressing **Start** in the composer *is* the core journey and it runs discovery synchronously, so exactly one short discovery turn fired, in the throwaway dir. Nothing else spawned.

## Part 1 — Per-surface notes

**Home** `/` — [`01-home.png`], [`L1-loading-home.png`]. The eye lands on the composer, correctly. Everything below fights for the same attention with no ranking: four stat tiles, an Attention strip, three buttons, four widgets, Missions, Objectives, a matrix of zeros, Brain Dump. Specifics: a card titled **"Mission Control Autopilot"**; the Attention strip says *11 pending decisions* and carries a badge reading **1**; the same 11 decisions appear three times (sidebar badge, Attention strip, and a widget titled "Decisions" while the nav calls the surface "Deck"); a stat tile reads **13 · to process** with no noun; StoryForge shows `Progress 100%` beside `0% verified`; every project card carries `0 DO · 0 SCH · 0 DEL · 0 ELM`; the Eisenhower widget is four zeros in a full column. Loading frame is good — labelled spinners ("Autopilot status", "Workspace data") over skeletons — but the composer isn't skeletonised, so it pops in and shoves the page down.

**Deck** `/deck` — [`02-deck.png`]. Best-conceived screen in the app: one decision at a time, keyboard hints, a batch-review escape hatch when the pile is deep, *"See where this came from →"* on the card. Two flaws: the four options are four identical grey rows with nothing marking the recommendation the body text just made ("Recommendation: option 2"); and `Dismiss / Urgent / Defer 7d` occupy the primary action row while *answering* — the actual job — has no button, only "Tab + Enter".

**Board** `/board` — [`03b-board-viewport.png`], full page [`03-board.png`]. The full-page capture is **36,900 px tall** — 41 screens. Done renders 200 cards with no windowing or pagination. Three columns are empty with "Drag tasks here" and a `+`; there is nothing on the screen to drag *from*. Title says "Status Board", the tab says "Board", the rail says "Projects". Done reads **200** here and Home reads **208 done**. The project board [`12`] says "Drop tasks here" where the global one says "Drag", and drops the `+`.

**Priority Matrix** `/board/matrix` — [`04`]. Four empty quadrants with 208 tasks in the system, no explanation (done tasks are excluded), "Drag tasks here" with no source. Dead end.

**Runs** `/runs` — [`05`]. Genuinely useful and the most honest surface: Environment Preflight, 10 named checks, plain-language finding per row, inline **Reconcile orphans** for the one needing attention. But a page called Runs that says *"Every agent session, live"* shows **no run list at all**, not even an empty state — 200 completed tasks have run history and none is here. `Uptime —` (em dash) instead of "not running". Preflight footer drifts into engineering diary: *"…the row keeps saying 'installing…' until a refresh actually finds the binary."*

**Inbox** `/inbox` — [`06`]. Dense and scannable, but every row opens with "Completed:" or "New assignment:", so the distinguishing text starts 90 px in. Three unlabelled glyphs per row. Everything dated 2/27/2026, no relative time.

**Activity** `/activity` — [`07b`], full page [`07`]. The page is **4,019 px wide** on a 1,440 px viewport. Cause found by DOM measurement: one entry's summary is a raw Claude Agent SDK transcript (`[{"type":"system","subtype":"init","cwd":"/Users/a…`) in a `<p>` with no wrapping — a single 3,718 px line. Raw markdown ships unrendered (`## Summary of What Was Accomplished`, `**bold**`, backticks). `Completed task: task_y1459tiApf09` is a raw id as title. Day headers jump MON, AUG 10 → FRI, FEB 27 with no year.

**Objectives** `/objectives` — [`08b`]. Milestone 1A shows a **"Not Started"** badge next to a **7/7** bar with every task struck through; 1B "Not Started", 13/13. Home says `0/4 milestones` for an objective whose milestones are all complete.

**Brain Dump** `/brain-dump` — [`09b`]. Good capture box. Five icon-only actions per row with the destructive-feeling auto-process lightning first. Two capture entries exist in the product (this and the global top-bar field) with nothing saying they're the same inbox.

**Projects** `/projects` — [`10`]. Rail says **Projects**, tab says **Projects**, breadcrumb says **Missions**, H1 says **Missions**, button says **+ New Mission**.

**Project overview** — [`11`]. Two dismissible banners stack above content. The pipeline strip renders `Brief adopted · Design adopted · References board · Design Files files · Notes thread` — grey words that read as status but are category nouns ("Design Files files" is the tell). The Health table is a spec dump: 90-word journey sentences in column one push the Verdict column — the only thing anyone scans — to the far right, in four words across three casings (`unverified`, `Not met`, `Met`, `Unknown`). "Milestones" is followed by *"No goals linked to this project yet"* with no way to link one.

**Brief** — [`13`]. Model empty state: *"This project has no brief. Projects started from the Home composer arrive with one. An adopted repo gets its brief the first time you ask for something new — until then its knowledge lives in Knowledge."* Explains, then links onward.

**Studio** — [`14`]. Clear three-pane layout, good empty copy. The canvas is a warm olive-brown found nowhere else in the palette. **Promote to build** renders at full primary strength with zero designs, beside correctly-dimmed Export/Approve.

**Design Files / References / Notes** — [`15`], [`18`] fine. **Notes [`17`] is broken**: *"Something went wrong — Method GET not allowed"*, and it's reachable from the pipeline strip on every project (root cause below).

**Knowledge** — [`16b`]. The answer to "what is still done by editing files" is: less than expected. Boot recipe as a labelled table, shape as a three-way toggle, `project.md` inline. Strong surface.

**Project Runs** — [`19`]. *"No runs for this project yet. Dispatch a task from the Board, or watch every agent session on Runs."* Exemplary empty state.

**Verify** — [`20b`]. Per-journey **Prove it** is a confident affordance. But one journey carries green **done** and red **failed** chips side by side; descriptions are 80-word spec paragraphs used as list text; a bare `smoke: Off` dropdown sits inline with no label.

**Terminal** — [`21`]. `connecting…` forever with no timeout, no failure state, and an input box that stays enabled so you can type into nothing.

**StoryForge** — [`22`], [`23`]. Pipeline correctly adapts to project shape (no Studio/Brief for non-UI) — a real design idea, well executed. Same contradiction: `0/4 milestones` above `78/78 tasks`.

**Crew** — [`24`], [`25`], [`26`], [`27b`]. Clean grid; the create form with its live Preview card is one of the better forms. URLs are `/team/<role>` while everything visible says **Crew**. Developer's live system prompt points at `mission-control/data/ai-context.md` and warns not to mix code with "the mission-control code" — paths that no longer exist; its skill is described as *"Manages tasks in Mission Control via JSON data files."* On `/team/me` a card shows a `0/8` checklist and a **Done** badge. Recent Activity truncates mid-word with no ellipsis ("…for long camp →").

**Library** — [`28`], [`30`]. Best-designed surface: master–detail, sandboxed live preview, token swatches, `DESIGN.md` rendered, *"Used by: no design session has used this system yet."* The design-system wizard is better still — numbered steps, two honest entry points, and a *"Two things this does not do"* box naming the limits. Flaws: the page's primary button says **+ New Skill** while the Design systems tab is open; `/library/[id]` is the **skill** editor [`31`], so a design-system id has nowhere to go.

**Settings** — [`32b`], [`33`], [`34`]. The most adult writing in the product, and it volunteers what doesn't work (*"Not yet fired by real builds"*, *"Registration only — this does not yet wire a server into an actual agent run"*). The kill switch is documented as `touch data/governor-kill` — sound reasoning, still no button for the ordinary case. Schedules are slash-command ids (`/daily-plan`). Checkpoints offers *"Share checkpoints with others"* in a single-user product and describes the demo as *"explore Mission Control"*.

**Verification run** — [`35b`], [`36`]. *"This is a verdict — signed evidence, not a claim"* is strong framing and the four tabs are right. But the breadcrumb leaf is `vrun_1786581439197`, the body repeats it plus `crit_goal`, `contract v4`, `judge: opus`; the breadcrumb's "Verification" has no index to return to and nothing links back to the project; the content column is inset ~160 px further than every other page; a run stuck in **Running** (dead pid) shows one line with no elapsed time, personas, progress or interrupt; and the section tab bar above reads `Projects · Board · Priority Matrix`.

**Adoption review** — [`37`]. Unknown id gives *"Something went wrong — Adoption run not found"* with a **Try again** that can never succeed and no link anywhere.

**404** — [`38`]. Correct status, calm page; the button says **Go to Dashboard** and there is no Dashboard.

**Legacy redirects** — [`39`]–[`46`]. All eight land correctly (`/decisions→/deck`, `/status-board→/board`, `/priority-matrix→/board/matrix`, `/skills→/library`, `/skills/[id]→/library/[id]`, `/skills/new→/library/new`, `/launch→/runs`, `/checkpoints→/settings/checkpoints`). No URL dead-ends.

## Part 2 — First run, empty data dir

**A fresh install is a wall of errors.** With an empty data root — the state of `~/.ligma/data` on any machine that hasn't run the dogfood store — Home, Projects, Board, Deck, Inbox, Activity, Objectives, Brain Dump and Runs all render "Something went wrong": *Failed to fetch dashboard data* [`F1`], *Failed to fetch tasks* [`F5`], and on Runs the raw JS message *"Cannot read properties of undefined (reading 'maxParallelAgents')"* [`F8`]. Crew [`F6`] is the one that gets it right, with a proper empty state and CTA. Cause: in `apps/daemon/src/store/data.ts`, `getTasks`, `getGoals`, `getProjects`, `getBrainDump`, `getActivityLog`, `getInbox` and `getDecisions` read their file with no `catch`, so a missing file throws ENOENT into the API — while their siblings `getAgents`, `getSkillsLibrary`, `getActiveRuns`, `getDaemonConfig` already return empty defaults. Nothing seeds the files, and the README documents a *different product* (an Electron desktop design tool) with no mention of the daemon or web app.

**The composer journey** — [`J1`] → [`J2`] → [`J3`] → [`J4`]. Once stores exist, the first-run home is dominated by an empty state titled **"Welcome to Mission Control — your command center for supervising AI agents. Create missions, delegate tasks, and let your crew handle the rest"**, with cards for *Create a mission / Add your first task / Deploy AI agents* and *"Try Mission Control with sample projects"* — sitting directly beneath the composer and telling a completely different story about how you start.

Then the important part. On **Start**: the project is created immediately and written to disk (`proj_MWkIDIBiDJPo`, 14:39:46), and the UI does not move. The button spins; at +10 s it is still spinning, still on `/`, and the "Welcome to Mission Control" panel is still telling the user they have nothing. `submit()` in `kickoff-composer.tsx` awaits the whole synchronous `POST /api/briefs` before navigating, so discovery — and any governor deferral in front of it — happens inside that await with a spinner as the only signal: no "this can take a minute", no cancel, no queue position, no record of the project that already exists. Reload during that window and the project is invisible until you find it in the Missions list, where its card shows `0 todo / 0 active / 0 done` and no hint discovery is mid-flight [`J17`]. It is auto-named from the raw sentence: *"A habit tracker web app where I log daily habits and see …"*.

When it lands, the destination is excellent: the brief page [`J11`] asks six domain-specific questions as chips with per-question help, a *"Still needed: …"* summary and a disabled **Answer** button; the new project's Verify tab [`J14`] explains all three empty sections in plain language. This is the product at its best — and a first-run user reaches it by staring at a spinner and hoping.

## Part 3 — Ranked findings

### Blockers
- **B1 · Fresh install renders "Something went wrong" on nine surfaces.** [`F1`, `F5`, `F8`] *Fix:* give the seven unguarded readers in `store/data.ts` the `try/catch → empty default` their four siblings already have (or one shared `readOrDefault`), then let Home's empty state be the onboarding screen it wants to be.
- **B2 · The Notes tab is dead on every project.** `GET /api/references/:id/notes` → 405. `apiRouter()` sorts routes by *path string length* as a proxy for specificity, so `/api/references/:id/:refId` (26 chars, DELETE-only) registers before `/api/references/:id/notes` (25 chars) and swallows it. [`17`] *Fix:* sort by specificity (fewer params first, then longer path). I scripted all 102 routes against the current sort — `referencesNotes` is the only current casualty, so it's one comparator with no other behaviour change.
- **B3 · Start creates a project and tells the user nothing.** [`J3`, `J4`] *Fix:* navigate to `/projects/<id>/brief` as soon as the id exists and let the brief page own the wait — its "Discovery is still running…" copy is already written.

### Major
- **M1 · "Mission Control" is still the product's name on the first screen a new user sees**, plus the Autopilot card, the demo checkpoint blurb, a live agent system prompt and a skill description. [`J1`, `01`, `33`, `27b`] The agent prompt matters most: it points builders at a dead `mission-control/` path.
- **M2 · One concept, four names, one screen.** Projects/Missions, Board/Status Board, Deck/Decisions, Crew vs `/team/`, Home vs Dashboard. [`10`, `03b`, `38`]
- **M3 · Status badges contradict their own data.** "Not Started" over 7/7; `0/4 milestones` over `78/78 tasks`; `0/8` + **Done**; a journey both **done** and **failed**; 208 vs 200 done. [`08b`, `22`, `26`, `20b`]
- **M4 · The Board renders 200 cards into a 36,900 px page.** [`03`] *Fix:* collapse Done to a count with "show recent 20", or window the column.
- **M5 · Runs shows no runs** — not even an empty state, though `/api/runs` exists and the project-scoped Runs page already models the copy. [`05`]
- **M6 · Raw internals shown as user-facing text**: `vrun_…` as breadcrumb leaf, `crit_goal`, `task_y1459tiApf09` as a title, an entire agent SDK JSON transcript as an activity summary, unrendered markdown. [`35b`, `07b`]
- **M7 · Activity scrolls sideways to 4,019 px** because that transcript never wraps. [`07`] *Fix:* `break-words` + `line-clamp-3`; the data fix is M6.
- **M8 · A stuck run has no vocabulary for being stuck.** Verification stuck in **Running** with a dead pid shows one line forever; Terminal says `connecting…` forever. [`36`, `21`]
- **M9 · Health is a spec dump, not health.** [`11`] *Fix:* short criterion label with full text on expand, roll-up ("9 met · 1 not met · 6 unknown"), one casing.

### Minor
- **m1 · Empty states without a way out**: both Boards and the Matrix say "Drag/Drop tasks here" with no source; Milestones says "No goals linked" with no link action; Verify says "no repo path" with no way to set one. [`04`, `11`, `J14`]
- **m2 · Three different error designs**, and a missing record rendered as a crash with a useless "Try again". [`F8`, `37`, `38`]
- **m3 · The Welcome banner never stops** — above all 34 surfaces until dismissed, and its one job is pointing at a gauge that reads "Governor offline".
- **m4 · Primary buttons that don't match context**: **+ New Skill** on the Design systems tab; **Promote to build** at full strength with nothing to promote. [`28`, `14`]
- **m5 · Icon-only action rows** (five per Brain Dump row, three per Inbox row). [`09b`, `06`]
- **m6 · Truncation without care** — mid-word cuts with no ellipsis; the auto-named project truncates its own sentence into H1, breadcrumb and card. [`26`, `J17`]
- **m7 · Orphaned micro-labels**: `13 to process`, `Uptime —`, `smoke: Off`, `Design Files files`.
- **m8 · Five date formats** and no relative time anywhere.

### Polish
p1 verification page container is inset differently from every other page · p2 the Studio canvas is olive-brown in an otherwise cool palette · p3 breadcrumb reads "Home › Projects › Loading" and the project page collapses to one small skeleton before expanding [`L5`] · p4 section tab bars follow you onto pages they don't describe · p5 Home breadcrumb reads "Home" on Home · p6 two dismissible banners stack on every project page · p7 struck-through milestone titles are near-unreadable at 12 px · p8 agent id is hand-typed when it could be derived.

## What is genuinely good

The **writing**. Whoever wrote the Runs preflight, the brief empty state, the "Two things this does not do" box, the Settings copy admitting what isn't wired yet, and *"This is a verdict — signed evidence, not a claim"* understands that an autonomous system earns trust by naming its limits. The Deck's one-card-at-a-time model, the Library's live sandbox preview, the shape-adaptive pipeline, and the brief's chip-based question form are real product thinking. Eight legacy redirects mean no URL dead-ends. The gap isn't taste — it's that three or four surfaces were designed and the rest were assembled.

## Ten highest-leverage improvements

1. **Make a fresh install work** — seven `catch`es in `store/data.ts` and a README that says how to start the daemon and web app. Nothing else matters if screen one is an error. (B1)
2. **Fix the route-sort comparator** so Notes — and anything later with a short literal segment — stops 405-ing. (B2)
3. **Navigate on project creation, not on discovery completion**, and let the brief page own the wait. The single change that makes "the daemon deferred my work" legible instead of a hung button. (B3)
4. **Give waiting a vocabulary and use it everywhere** — queued / deferred by the governor / running 4 m / stalled. One shared waiting component across Runs, Terminal, Studio, verification and the composer removes five different silences. (M8, B3)
5. **Finish the rebrand**, starting with the first-run empty state and the Developer system prompt pointing at a dead `mission-control/` path. (M1)
6. **One noun per concept**, applied to H1s, breadcrumbs, buttons, empty states and URLs in one pass. (M2)
7. **Derive every status badge from the same counter as its progress bar**, and reconcile 200 vs 208. Contradictory status is the fastest way to lose trust in an autonomous system. (M3)
8. **Put a run list on Runs and cap the Board's Done column** — two surfaces failing at their one job in opposite directions. (M4, M5)
9. **Stop rendering internals** — ids as titles, transcripts as summaries, raw markdown in the feed. Also fixes the 4,019 px page. (M6, M7)
10. **Rewrite Health as a summary with detail on demand.** The most valuable table in the product and currently the least readable. (M9)
