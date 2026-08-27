# Ligma Product & UX Specification

**Status:** draft for Alex's review, 2026-08-11
**Companion docs:** `2026-08-11-ligma-merger-design.md` (architecture), `2026-08-11-twin-primitives-design.md` (data model)
**Grounding:** first-hand knowledge of mission-control's UI; UX field surveys of open-design `apps/web` and ligma-classic's renderer (2026-08-11)

---

## 1. Product definition

**Ligma is an autonomous app factory for one person.** You describe a product; it designs it with you where a UI is called for, builds it without you, and proves the result works the way its real consumer would experience it — a human at a browser, a developer following the README, a client calling the API — with signed evidence, not claims.

The one-sentence UX thesis: **you direct; it builds; it proves.** Every screen in the product exists to answer exactly one of four questions:

| Question | Surface |
|---|---|
| What needs *me*? | **Deck** |
| What's happening right now? | **Home / Runs** |
| Is it actually done? | **Verify** |
| What are we making? | **Studio / Board** |

The scarce resources are the human's attention and the human's Claude allocation. The UX treats both as budgets: the Deck is the attention queue, the Governor gauge is the token queue, and both are always visible in the rail.

## 2. Evaluation of the three products today

### mission-control — the cockpit (strong loop, no creation surface)

*Strengths:* the only product of the three with real verification (personas, judge, signed verdicts, evidence locker); the full delegation loop (tasks → daemon → runs → reports → decisions); live output streaming; quota governor; decision deck with undo. The control loop is genuinely complete.
*Weaknesses:* ~13 flat top-level pages with no hierarchy — board, launch, daemon, inbox, decisions, verification, crew, skills, goals, brain dump all siblings; nothing to *create* with — products enter as text in a task description; verification is a destination page rather than woven into where tasks live; the aesthetic is competent-shadcn, not memorable.

### open-design — the storefront (best kickoff, fatal seams)

*Strengths:* the Home hero kickoff (one prompt box, optional skill/design-system chips, required-input gating that names the missing field *before* submit); master–detail browsing that scales to 150 design systems; one shimmer primitive as the app-wide "in progress" language; failure-class-aware error recovery (auth vs retry vs switch-runtime, each with its one right button); milestone-scoped one-shot onboarding hints that never nag returning users.
*Weaknesses — and these are the seams the merged UX exists to eliminate:* entering Studio **severs global navigation** (a different component tree with no shared rail — you leave the app to enter the project); **Automations is fully built and has zero navigation entry point** — a shipped feature reachable only by typing the URL; the critique theater — their most interesting feature — is **off by default behind a settings toggle** with no in-Studio discovery; no artifact version history despite being an iteration tool; dead `/brands` routes that silently redirect.

### ligma-classic — the studio (best feel, no memory)

*Strengths:* the Wall — a pannable/zoomable grid of every screen in the project with per-card "writing…" pulses, comment badges, and drag-reorder — is the right default for multi-screen products; progressive throttled rendering (the artifact visibly rebuilds itself at a human-legible ~250ms cadence — "watch it get built"); click-to-pin comments with live-tracked rects and a three-state visual (note / pending / applied); agent-declared tweak schemas rendering as instant no-reload sliders and pickers; the iframe pool that makes design switching instant.
*Weaknesses:* no version history or diff — the only "what changed" is scrolling chat; comment "Apply" is an invisible batch re-generation with no preview of what's being sent; Electron-bound.

**The synthesis in one line:** open-design's front door, ligma-classic's studio, mission-control's engine room — connected by a spine none of them have.

## 3. The object model as the user sees it

The user thinks in **Projects**. A project owns everything else, arranged along a pipeline:

```
Brief → [Designs] → Tasks → Runs → Verdicts
                       ↘ Journeys / Baselines / Knowledge (the project's memory)
```

- A **Brief** is what you asked for (discovery-refined prompt + constraints).
- A **Design** is an approved visual artifact from the Studio — **an optional stage, not a gate**. An approved design is not documentation — it **compiles into the contract** (design-as-oracle). Projects without a UI never pass through it.

### Project shapes — design is opt-in per project (and per feature)

Many products built with ligma will have no UI at all: APIs, CLIs, libraries, daemons, pipelines. The pipeline adapts to the project's **shape**, inferred from the brief and confirmed as one discovery question (changeable later in Knowledge):

| Shape | Pipeline | The oracle compiles from | Who verifies |
|---|---|---|---|
| **UI app** | Brief → Design → Build → Verify → Learn | approved design baseline + criteria (holdout) | browser personas |
| **Headless** (API/CLI/library/service) | Brief → Build → Verify → Learn | criteria (holdout) + journey baselines | consumer personas |
| **Mixed** | Design stage present; opt-in per feature at task creation | whichever the feature carries | both |

**Consumer personas** are the headless generalization of the browser panel, same principles (never sees source, structured output, fail-default judge):
- *naive-developer* — clean ephemeral env, reads only the README/quickstart, follows it literally. Doc rot and broken quickstarts become behavioral failures, not prose complaints. For a library, **the README is the UI**.
- *API/CLI journeys* — sequences of calls or commands with expected shapes; baselines record response schemas, exit codes, and outputs instead of screenshots.
- *saboteur* — malformed inputs, unchanged in spirit.

Engine note: the browser bridge gains HTTP and PTY siblings; everything downstream (judge, verdicts, evidence, attempts) is transport-agnostic and unchanged.
- A **Task** is a unit of delegated build work; it can carry a thumbnail of the design region it implements.
- A **Run** is an agent session (build or verification), always watchable live.
- A **Verdict** is signed evidence of pass/fail against the contract, with screenshots and step logs.
- A **Journey** is a named user flow validated independently of any task; **Baselines** record what "working" currently looks like; **Knowledge** (`.ligma/`) is what the system has learned about the repo.

Every object renders links both directions: *what made this* and *what this made*. A verdict links its run, its task, its design, its criteria. A design links the tasks it spawned. Nothing is a dead end — that is a hard UI rule, not an aspiration.

## 4. Information architecture

### Global rail — persistent everywhere, including inside projects

This single decision fixes open-design's worst seam. The rail never disappears:

```
◆ Home           portfolio dashboard + kickoff composer
▣ Deck           the attention queue                    [badge: needs-you count]
✉ Inbox          reports & updates (informational)      [badge: unread]
▤ Projects       all projects → project space
❖ Library        design systems · skills · craft rules  (master–detail)
♟ Crew           agent registry & instructions
⚙ Settings       governor, backends, daemon, appearance
─────────────
▮▮▮░ Governor gauge (persistent): window usage, reserve floor, cooling state
```

Rules: **every shipped feature has a rail or pipeline entry point** (no orphaned `/automations`); the rail is identical signed-in state everywhere; the Governor gauge is always visible because the token budget shapes what the user can ask for next.

### Project space — the pipeline is the navigation

Opening a project keeps the rail and adds a project header:

```
UI app:    Brief ✓ · Design ●3 · Build ▶2 · Verify ✗1 · Learn ↻
           Overview | Studio | Board | Runs | Verify | Knowledge

Headless:  Brief ✓ · Build ▶2 · Verify ✓ · Learn ↻
           Overview | Board | Runs | Verify | Knowledge
```

The **pipeline strip** is both status display and navigation: each stage shows live chips (3 designs, 2 running builds, 1 failed verdict) and clicking a stage jumps to its surface. **Only the stages the project uses render** — a headless project shows no Design stage and no Studio tab at all, rather than an empty one (an unused stage is noise, an absent one is information). A small "＋ Design" affordance in Overview adds the stage later if the project grows a face. The user always knows where their product is in the factory, from anywhere in the project.

## 5. Core flows

### F1 — Greenfield: idea to proven product (with or without a UI)

1. **Home composer** (open-design's hero pattern): one prompt box. Optional chips: project kind, design system (picker popover with live preview — UI shapes only). Required-input gating client-side, naming the missing field.
2. **Brief**: the agent asks discovery questions *as a form in the thread* (open-design's question-form pattern), not a chat interrogation — including one shape-confirming question ("this reads as an API service — correct?"). The locked brief becomes the Brief stage artifact — editable until a contract is compiled against it.
3. **Studio — UI shapes only**: prototypes stream onto the Wall progressively. The critique pass runs **visibly by default** as a collapsible lane under the artifact — score ticker, threshold, interrupt button (theater UI, never hidden in settings). User iterates via pinned comments and tweaks. **Headless projects skip this step entirely** — the flow goes straight from brief to Promote.
4. **Promote to build**: the seam that must feel like one motion, with two entrances — from an approved design (UI) or **directly from the brief** (headless). Either way it opens the same single review sheet: the generated task breakdown (with design-region thumbnails where designs exist), acceptance criteria (with the holdout note: "the builder will see 30% of these"), proposed journeys, estimated token budget from the governor. One confirm → contract compiled and signed — with the design as baseline where there is one, criteria + journeys alone where there isn't — tasks land on the Board, daemon picks them up.
5. **Build**: runs stream live in Runs; blocking questions surface as Deck cards; the user can be absent.
6. **Verify**: the right panel for the shape — browser personas walk the app, consumer personas exercise the API/CLI/quickstart. The judge scores against the contract. Verdict cards land in Inbox; failures return to the builder automatically with the judge's reasoning (attempt-capped).
7. **Done means proven**: a task's checkmark never renders green without a verdict link beside it. "Done (unverified)" is a visually distinct, slightly uncomfortable state — by design.

### F2 — Brownfield: adopt an existing repo

1. Home composer → "Adopt a repo" chip → path picker.
2. Adoption run (watchable like any run): infers `boot.json`, boots an ephemeral env, an exploratory persona crawls the running app and **proposes journeys** from what it finds; its confusion log doubles as the first UX audit.
3. Review sheet: confirm boot recipe, accept/edit/reject proposed journeys — one screen, batch actions.
4. First panel run records **characterization baselines** ("this is what working currently looks like"). The project arrives with Verify and Knowledge already populated; Brief and Design stages show "adopted" placeholders until first used.

### F3 — The daily loop (the five-minute morning)

Home shows the portfolio: each project card with health (verified %, decaying with staleness), running agents, and needs-you count. The flow is: **Deck until empty → Inbox skim → done.** Deck cards are self-sufficient — a verdict spot-check card carries the screenshot and criterion inline; a design-direction card carries the two candidate thumbnails; answering never requires navigating away. Swipe/keys, batch mode at ≥10, 10-second undo (all already built).

### F4 — Design iteration

Wall as default canvas (multi-select cards to scope the next prompt), focus mode with device frames, pinned comments staged as chips above the composer — but fixing ligma-classic's opacity: **"Apply (N)" shows a preview of the compiled instruction block before sending**, and each applied edit's pin links to the turn that applied it. **New: a version rail per design** (content-addressed snapshots already exist in the engine) — restore, and side-by-side before/after compare. Both parent products lack this; an iteration tool without memory is half a tool.

### F5 — Build monitoring & intervention

Runs surface: live session streams (existing), env preflight card, flight-recorder timeline. Every failure renders **failure-class-aware recovery** (open-design's pattern): auth failure → "Re-authenticate"; rate limit → "Deferred by governor, resumes ~14:30"; parse failure → "Retry" / "Switch backend"; each class gets its one right button, never a bare error string.

### F6 — Verdict review & visual feedback

The evidence locker gains ligma-classic's overlay: **pin comments directly onto evidence screenshots**. A pinned comment on a verdict screenshot compiles into a structured instruction (the `buildEnrichedPrompt` pattern) and becomes either feedback on the fix-task's next builder prompt or a new task — user picks in the pin's popover. This closes the loop the merger thesis promises: the human points at the defect in the *evidence*, and the pointing itself becomes the instruction.

## 6. Screen inventory

| Screen | Contents | Provenance |
|---|---|---|
| **Home** | portfolio cards (health, running, needs-you), kickoff composer with chips, activity ticker | open-design hero + mission-control dashboard |
| **Deck** | unified attention queue: decisions, design approvals, contract promotions, verdict spot-checks, criterion challenges; inline evidence; batch + undo | mission-control deck, widened |
| **Inbox** | reports, updates, morning smoke digest; mark-reviewed | mission-control |
| **Project Overview** | pipeline strip, stage summaries, health board (criteria with staleness decay), quick actions (Prove it, New design, New task) | new |
| **Studio** *(UI shapes only — tab absent on headless projects)* | chat pane + Wall/focus canvas, progressive render, pins, tweaks panel, critique lane (visible by default), version rail, design-system picker, Promote to build | ligma-classic + open-design |
| **Board** | kanban + Eisenhower views; task cards carry design thumbnail + verification pill + run badge; task drawer shows criteria (visible slice), linked design, runs, evidence | mission-control |
| **Runs** | daemon status, live streams, preflight, flight recorder, failure-class recovery, interrupt/defer | mission-control |
| **Verify** | journeys — browser or API/CLI per shape (Prove it, schedule, last verdict), evidence locker with screenshot pinning (transcript/output pinning for headless), health board, regression corpus | mission-control + new |
| **Knowledge** | `.ligma/` rendered: boot recipe status, project.md, quirks, baselines browser | new (twin primitives) |
| **Library** | master–detail catalogs: design systems (live preview pane), skills, craft rules; same picker popover reused in all composers | open-design |
| **Crew** | agent registry, instructions, skill links | mission-control |
| **Settings** | governor config, backends, daemon schedule, appearance | mission-control |

## 7. Status & progress language (one vocabulary, everywhere)

- **Verification states** (the product's soul): `unverified · in-review · passed · failed · waived · stale`. One pill component. A green check **never** appears without a verdict link. `waived` and `stale` are visually honest (amber, not green).
- **Execution states**: `queued · running · deferred · done · error`. `deferred` (governor) is calm, not alarming — "waiting its turn" with a resume estimate. `error` (harness malfunction) is visually distinct from `failed` (product defect) — D3 carried into the UI.
- **One progress treatment**: the shimmer-text primitive on labels, thinking blocks, and tool titles — no zoo of spinners.
- **One error model**: failure-class cards with a single primary action, everywhere an agent can fail.
- **Working-status everywhere the work is represented**: the Wall card pulses while its file is edited; the task card pulses while its builder runs; the journey row pulses during a panel walk. Same pulse.

## 8. Seamlessness principles (the merge contract)

1. **No orphan features.** Every feature has a rail or pipeline entry. If a feature can't earn one, it doesn't ship.
2. **Nothing load-bearing hides in Settings.** Critique lanes and verification run visibly by default; settings tune, they don't reveal.
3. **No dead ends.** Every object links *what made this* and *what this made*.
4. **The card is the context.** Deck cards carry their evidence inline; answering never requires navigation.
5. **One vocabulary.** Status pills, shimmer, failure cards — identical across studio, board, runs, verify.
6. **Keep state warm.** Iframe pools, keep-alive views, visibility-paused polling (all built) — switching surfaces is instant, drafts survive.
7. **Both budgets always visible.** Deck badge (attention) and Governor gauge (tokens) live in the rail.
8. **Evidence over claims, in pixels.** The UI never asserts done-ness it can't link to a verdict. This is the differentiator rendered as a design rule.

## 9. Design language

Two moods, one token system:

- **The cockpit** (Home, Deck, Board, Runs, Verify, Settings): mission-control's clean shadcn/Tailwind-v4 professional surface, light/dark. Dense, calm, glanceable.
- **The studio** (Studio canvas only): ligma-classic's warmth is allowed here — the paper-texture surface class, handwritten frame captions, pin aesthetics. The studio should feel like a drafting table inside a mission control room; the boundary is the canvas edge.
- Mechanics: single `tokens.css` + Tailwind v4 preset (ligma-classic's pattern); `craft/` rules govern *generated artifacts*, not app chrome; no hard-coded colors downstream of tokens.

## 10. What we cut

Teams/workspaces/members/board-of-boards routes (single-user product), external console links, community gallery (later), 17-language i18n machinery (later), `/brands`-style legacy aliases (nothing to be legacy to), HyperFrames/video (later), terminal tabs (keep the flag off), marketplace backend (Library is local catalogs until there's something to distribute). Eisenhower matrix survives as a Board view — it's cheap and Alex uses it.

## 11. Phasing (aligned with the merger plan)

- **Phase 2 (daemon extraction) carries the IA skeleton**: global rail + project space wrap the *existing* mission-control pages first — navigation ships before new surfaces.
- **Phase 3 (studio + design-as-oracle)**: Studio (wall, pins, tweaks, critique lane, version rail), Promote-to-build sheet, Verify surface upgrades (screenshot pinning), Knowledge tab, twin primitives.
- **Phase 4 (distribution)**: Library catalogs, desktop shell, onboarding funnel (milestone-scoped one-shot hints, adopted last — onboarding is designed after the thing it onboards into is stable).

## 12. Open questions for Alex

1. **Default kickoff mode**: should the Home composer default to greenfield (prompt-first) with "Adopt a repo" as the chip, or ask the mode first? (Spec assumes prompt-first.)
2. **Brief mutability**: after designs are approved, does editing the brief invalidate approved designs (strict, matches contract-freezing) or just flag them stale? (Spec assumes flag-stale + Deck card.)
3. **Verdict spot-checks in the Deck** (judge calibration): opt-in sampling rate — 1 in 10 feels right for launch?
