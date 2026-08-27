# Round 2 — Four non-technical personas (verbatim report, 2026-08-14)

**Method.** Four personas, 19 flows, each walked against (a) the shipped UI and (b) UX-REDESIGN Parts 1–2 with amendments A–F assumed adopted. Verdicts are about *this population*, not about the product in general.

**Headline.** The redesign is genuinely strong for one of the four personas (the PM) and structurally incomplete for the other three. The failures cluster in three places the document never looks at: **money**, **reversal**, and **"show me the thing."** Separately, the proposal's flagship move — discovery from form to conversation — silently deletes three affordances the current form has and the walkthrough praised.

---

## Two corrections to my own priors, found in the code

**1. The pre-spend confirmation sheet already exists and is well built.** `apps/web/src/components/studio/promote-sheet.tsx` shows the full task breakdown, acceptance criteria with the holdout note, proposed journeys, and a governor estimate — *before* the confirm. My drafted "add a commit sheet" amendment collapsed to "rewrite its sentences," which is a much smaller change. But read the sentences it actually shows a non-technical user:

> "One confirm compiles and signs the contract, freezes the oracle and lands the tasks on the Board."
> "Governor estimate · 12 spawns · window 43/100 over 5h · reserve floor 10 · 47 left for autonomy"

The single highest-stakes, most irreversible moment in the product is narrated in compiler vocabulary. A code comment in that file reads *"Shown before the confirm precisely because it is irreversible after"* — the file knows it is irreversible; the copy never says so to the user.

**2. Per-project pause is not "a small daemon change" — it is currently a lie.** `ProjectStatus` already includes `"paused"`, it is selectable in `edit-project-dialog.tsx`, and it has a color in search. But `apps/daemon/src/engine/dispatcher.ts` (eligibility filter) never reads project status — it checks running/retry-queue/`deferredUntil`/`blockedBy` only. **Setting a project to Paused today does nothing and tells the user it did.** Flow B's fix is not an enhancement; it is repairing a control that already appears to work.

---

## Persona 1 — Maya, non-coding founder

*Dog-grooming booking app. Motivated, no git/terminal vocabulary. Two live fears: breaking something, and spending money she can't see.*

### M1 · "I have an idea. Start."
**Current: BROKEN.** She types into the composer (correctly the eye's landing point), presses Start, and the button spins. The project is already on disk; the page doesn't move; the welcome panel below still tells her she has nothing. **Divergence: +3s after Start.** (walkthrough B3/J3)
**Proposed + A: WORKS.** "+" → modal → avatar drops into the rail pulsing → she lands in the project with discovery open. Action and result are finally in the same place.
*Residue:* her idea becomes a 40px circle with two initials while the brief doesn't exist yet. She will ask "where did my sentence go?" Cheap fix: the pulsing avatar's tooltip is her raw sentence until the brief lands.

### M2 · Discovery: answering the questions
**Current: WORKS — and it is the best thing in the product for her.** `question-form.tsx` has thirteen native input types, a per-question **Skip**, and a live `Still needed: …` status with a disabled **Answer** button. She can see the whole set, answer the four she knows, skip two.
**Proposed (Flow F, discovery-as-Talk-thread): CONFUSED — a real regression.** Converting to a message thread costs her three things the form gives her free:
- **Scope.** A form shows six questions. A thread shows one. She cannot tell if this is a 2-minute or 40-minute commitment.
- **Skip.** A chat has no "leave blank." She will type "I don't know" as prose, and prose is not a skip.
- **Order.** She can no longer answer the easy ones first and come back.

**Divergence: question 3, on a question she can't answer.** Part 2 §12 says "the question-form input types survive as inline message widgets" — it preserves the *controls* and drops the *scaffolding around them*, which is the part that was doing the work.

Worse, there is no back door: `question-form.tsx`'s comment records that the daemon's `applyAnswers` throws **"That form is no longer the open one"** — so **there is no server path to edit a prior answer** in either design. Her `← Back` is read-only review. She answers "no payments" on question 2, realises on question 5 she meant "payments later," and the product has no verb for that.

### M3 · "Start building" — the fear moment
**Current: CONFUSED.** The verb is "Promote to build," which means nothing to her; the sheet behind it is thorough but speaks daemon.
**Proposed + B: better, still CONFUSED, and for this persona arguably BROKEN.** Amendment B fixes the *verb*. It does not fix the *sentence*. She is about to trigger the one irreversible action in the product and what she reads is "compiles and signs the contract, freezes the oracle," priced in "spawns" against a "reserve floor."

The asymmetry underneath is the sharper finding, and it is inverted for a frightened user:

| Direction | Guard |
|---|---|
| **Launch a task** (spends a session) | one click, no dialog, no estimate — `run-button.tsx:44` |
| **Launch Autopilot** (unbounded spend) | one click, direct `onClick={start}` — `runs/page.tsx` |
| **Interrupt a run** (stops spending) | confirmation dialog |
| **Defer a run** (stops spending) | confirmation dialog with a paragraph of reassurance |

**Starting costs nothing to do; stopping is gated twice.** Amendment B arms dispatch on this button, so it inherits the whole asymmetry. **Divergence: cursor hovering the button, asking "how much is this?"**

### M4 · "Can I see it?"
**BROKEN in both.** After Build goes green she wants a URL. Studio shows design images, Build shows task cards, and Proof's Ship panel offers **export · open-in-editor · MCP handoff** — three developer verbs and no fourth option for her.

The capability exists and nobody points her at it: `data/ephemeral-envs.json` records envs that boot a git worktree with a `port`, a `url`, a health check and timings. They surface only on the Runs preflight card and the adoption review. (`previewUrl` in `deck-cards.ts` is a *design thumbnail*, not a running app — the two "preview" concepts share a word and do not connect.)
**Divergence: she scans the Ship panel for "View" or "Open" and finds "MCP handoff."**

### M5 · "I changed my mind — undo it."
**CONFUSED in both, and the answer is genuinely uneven.** Undo exists in three places and is deliberately refused in the two that matter most:

| Thing | Undo |
|---|---|
| Answered decision | Yes — server-granted window with a live countdown, then "Undo window closed" |
| Deleted entity | Yes — soft delete + 5s toast |
| Studio version | "Restore" — *appends* a new version. The file's own comment: *"That is the difference between a rail and an undo button."* Correct and honest. |
| **Design approval** | `undo: null`, deliberately |
| **Promote / start building** | Irreversible by design |

So the answer to "can I undo this?" is *yes for the small things, no for the two big ones*, and the UI never tells her which is which until after. Proposed adds **Pause project** (Flow B) — but pause is not undo. She pauses, then says "delete the payment screen it already built," and no surface has that verb. Talk will reply in prose; the code stays.

**Cross-cutting fear this population has and the proposal never answers: blast radius.** Nothing anywhere states what the agents can touch. The containment story is actually excellent — worktrees under `.envs/`, off her real tree — and it is told to nobody.

---

## Persona 2 — Dre, designer

*Judges everything by canvas quality, direct manipulation, visual feedback.*

### D1 · "Open the canvas and move that button."
**CONFUSED in both.** `wall.tsx` is a pannable canvas of screens rendered as iframes (`srcdoc`); its gesture handling resolves to pan only. Objects do not move. The nouns "Studio" and "canvas" promise Figma; the surface is a **review** canvas.
**Amendment F helps and also sharpens the mismatch:** the Talk composer targets the selected design and produces a **pin**. Pins are real machinery (`pin-overlay.tsx`, `pin-chips.tsx`) so F is cheap and correct — but a pin is a *comment*, and he came to *edit*. **Divergence: the first click-and-drag, within ten seconds.**

**Under-credited:** `tweaks-panel.tsx` is his actual direct-manipulation surface — agent-declared design tokens as native `range`/`color`/`checkbox`/`select` controls, where `live` tokens apply **with no model spawn**, i.e. instant, free, reversible. That is the tightest feedback loop in the product and the one thing on this canvas that behaves like Figma. UX-REDESIGN §11 lists Studio's drawers as "design files, versions, Talk" and never mentions it. Part 1 §4 claims "nothing is deleted"; tweaks is the counterexample — not deleted, just invisible to the plan.

### D2 · "Here's my Figma file / here's the link."
**CONFUSED → likely BROKEN.** He pastes a `figma.com` URL into Talk. Talk is designed to answer conversationally and write memory; nothing maps a design-source link to an action. The product has a References board and design files, but no surface says what it can and can't do with an external design source. **Divergence: paste + Enter.**

### D3 · "Give me three versions of this screen."
**CONFUSED.** No variant concept exists. He gets one revision plus a critique lane. The versions rail is *temporal* (v1→v2→v3), not *lateral* (A|B|C), and those are different mental models wearing the same word. **Divergence: at the reply.**

### D4 · "What does Approve mean?"
**CONFUSED.** To him, approve = sign-off: per-screen, reversible, low-stakes. Here it is a gate that arms a build, and `deck-actions.ts` sets `undo: null` on it deliberately. Amendment B made *building* one honest verb but left *approving* as a silent gate whose consequence is invisible until it fires. **Divergence: he approves screen 1 of 5 to unblock someone and cannot tell whether anything happened.**

### D5 · "Does the built thing match my design?"
**BROKEN in both.** Proof is signed verdicts over criteria — words. He judges pixels. Both halves exist in the store (design baseline is frozen at a version at promote time; the built app boots at an env `url`) and no surface puts them side by side. **Divergence: Proof opens and it is a table.**

---

## Persona 3 — Priya, PM

*Fluent in Linear/Jira. Will try to manage the agents like a team. **Best-served persona in the redesign.***

### P1 · "Show me the sprint."
**Current: BROKEN** (36,900px of Done; Objectives says "Not Started" over 7/7; four names for the work surfaces).
**Proposed: WORKS.** Build with **Flow (kanban) · Plan (goal → milestone)**, honest derived status pills, Objectives retiring into Plan. This is the redesign at its best.
*Residue:* no time-box. She will look for Sprint/Cycle/Iteration and find a goal tree. Mild confusion, correctly so — there are no sprints here.

### P2 · "Assign this to someone."
**BROKEN as attempted, in both.** She opens a task card looking for **Assignee** and there isn't one. She goes to Crew — which the rail calls *Crew* and whose own button calls *New Agent* — and finds role definitions with editable system prompts, not a roster with load. `/team/me` shows a `0/8` checklist next to a **Done** badge, which she will read as a person's workload.
**Divergence: the task card's missing Assignee field.** Her conclusion is the damaging part: *these are configuration, not colleagues, and I cannot direct them.*

### P3 · "When will this be done?"
**CONFUSED — honestly, but silently.** No estimates, no velocity, no dates; "deferred by the governor" is a nondeterministic delay. The right answer is *"we don't estimate"*, and the UI doesn't say it — so she infers the product forgot rather than that it refuses. This product is unusually good at naming its own limits; this is a limit it forgot to name.

### P4 · "Send stakeholders a status report."
**BROKEN in both.** Ship panel = export / open-in-editor / MCP handoff. Activity is a drawer inside Build. Nothing produces something she can paste into Slack. **Divergence: she looks for Share/Report and finds a developer handoff.** The raw material exists — the summary-first health roll-up already computes "9 met · 1 not met · 6 unknown."

### P5 · "It keeps failing — stop it and escalate."
**Mixed.** Amendment E (stalls → tray) **WORKS**. Amendment D (reject-with-note → new task + memory) **WORKS**, and is real new capability: today she can *challenge* a verdict only through the spot-check card's canned options, and `verification-report.tsx`'s "Needs a human decision" is a display-only callout with no input.

Two gaps:
- **No attempt counter, and D creates a spend loop.** Reject → task → verdict → reject, uncapped, each iteration costing sessions. This repo's own history is the existence proof (d2 attempts). Nothing on a task or verdict says "this is attempt 3."
- **"Pause project" must resolve §13 Q5 in the label.** To a PM, *pause* unambiguously means *stop now*. Shipping dispatcher-gate-only under the word "Pause" is a trust break — and today's cosmetic `paused` status means she may already have learned that Pause does nothing.

---

## Persona 4 — Nour: the intermittent sole approver

*Operations manager at a 12-person clinic, automating an internal rota tool. Works in 15-minute gaps, disappears for 3–10 days, checks on her phone. She is the only person who can approve anything.*

She matters because she stress-tests Flow A at a harsher setting than "Monday morning," and because **an autopilot that runs while its only approver is absent is the product's actual steady state.**

### N1 · "What happened while I was gone?"
**CONFUSED.** Flow A's rail status rings answer *what is true now*. After ten days everything is idle-grey and the tray says 3 — and she cannot tell whether it built forty tasks and stopped, or stalled on day one. Rings encode **state**, and her question is **delta**. **Divergence: the rail is all grey and she has no idea if that's good.**

### N2 · "Nobody told me it was blocked."
**BROKEN.** Everything is pull. A decision blocking twelve tasks sat nine days while the governor kept deferring around it. Amendment E escalates stalls **to the tray** — a surface only visible to someone already looking. The interrupt layer has no out-of-app edge. This repo's own recent commits are what silent multi-day stalls look like from inside.

### N3 · "Answer it from my phone."
**BROKEN.** The three-zone model is desktop-native: 64px rail + workspace + right slide-over, ⌘K, ⌘J. There is no responsive story anywhere in the proposal. The cruel part is that **the interrupt layer is the one part that must work on a phone** — decisions are the critical path, they are 15 seconds of work, and they block everything — and it is the one part specified as an overlay with no URL. Part 1 §3 is explicit: Zone 3 is "overlays, not destinations." A slide-over cannot be a push notification's destination.

### N4 · "Did my answer matter?"
**Amendment C: WORKS in the moment, CONFUSED in her life.** C shows the consequence on the answered card. She answers in the tray and closes the laptop in thirty seconds. Re-planning is async. The consequence arrives after the human left, to a card that is gone. Today the answered row shows only `Answered: {answer}` — no consequence vocabulary exists anywhere — so C is real new work, and it should be built as a **durable receipt**, not card state.

### N5 · "Is this costing me money while I'm not looking?"
**BROKEN.** The vocabulary is *sessions* and *spawns*; there are zero dollar amounts, zero token counts, zero "credits" strings in the entire UI. That's defensible for a subscription product — but there is **no cumulative view at all**. The governor gauge is instantaneous; nothing answers "what did the last ten days consume." Part 1 demotes it further, to "the tiny heartbeat it is" at the rail's bottom. For a user who is absent by design while dispatch is armed by design (amendment B), that gauge is her only meter and it has no memory.

---

# New amendments (G1–G15)

### Money and commitment

**G1 · Rewrite the promote sheet in the user's language; keep its structure.** *(M3, N5)* "Compiles and signs the contract, freezes the oracle" → "This locks what 'done' means and starts the work. It can't be undone." "Governor estimate · 12 spawns · reserve floor 10 · 47 left" → "About 12 agent sessions. You have 47 left in this 5-hour window." The `OnboardingHint` pattern already in that file is the right home for the longer gloss.

**G2 · Put the estimate on the one-click launches too.** *(M3)* `GovernorLine` already exists in `promote-sheet.tsx`. Render it in `RunButton`'s hover/press affordance and beside `Launch Autopilot`. Right now the only pre-spend number sits on the action that already has the most friction, and the unbounded one has none.

**G3 · One cumulative line per project.** *(N5, M3)* Build header: "24 agent sessions on this project so far." Deliberately *not* a spend dashboard.

**G4 · Say what the agents can touch, once, before the first build.** *(fear)* One sentence in the promote sheet: "Agents work in an isolated copy of this project. Your files and your GitHub are not touched." The containment is already real and worktree-based; it is currently a secret. Highest trust-per-word in this list.

### Reversal

**G5 · Reversibility is stated at the moment of commitment, not discovered after.** *(M5, D4)* Every gate carries one line: what it unlocks and whether it can be taken back.

**G6 · Surface restore where the fear lives.** *(M5, P5)* Checkpoints live in Settings and describe themselves as "Share checkpoints with others" in a single-user product. Add "Restore to a checkpoint" in the Build header's overflow.

**G7 · Make Pause real, and make its label the answer to §13 Q5.** *(P5, M5)* The dispatcher ignoring `paused` is a live correctness bug. Fix: one clause in the eligibility filter. Then two explicit buttons, never one ambiguous "Pause": **"Stop starting new work"** and **"Stop everything now."**

### Discovery and consequence

**G8 · Discovery-as-conversation must keep the form's scaffolding.** *(M2)* Keep all three: a persistent thread header with `Still needed: …` and *N of M*, the per-question **Skip**, and an explicit **"You decide."** A header and two buttons on the thread — they do not make it a form again.

**G9 · Add the missing edit path for a locked answer.** *(M2, M5)* Today there is *no* way to change your mind about a discovery answer, in either design. Constraints render as an unlabelled bulleted list. Label the list, make each item editable, route the edit through amendment C's consequence machinery ("changing this re-plans 4 tasks").

**G10 · Consequences are durable receipts, not card states.** *(N4)* The consequence lands as an entry in an **"Answered"** section of the tray, dated. Show it honestly when it is *nothing* — "your answer confirmed the current plan; nothing changed."

### Studio

**G11 · Studio names its own mode.** *(D1–D3)* Canvas header: "Review canvas — you shape it by asking, not by dragging." Reuse the design-system wizard's **"Two things this does not do"** idiom: no direct editing, no Figma import, no variants.

**G12 · Promote the tweaks panel; give pins an intent.** *(D1, D3)* Add tweaks to §11's drawer list, open by default for design-shaped projects. Pins carry a type (*change this · try variations · this is a reference*).

**G13 · Proof shows the design beside the built screen.** *(D5, M4)* Design baseline (frozen at promote) beside the built app's env `url`, above the verdict list. Ship panel leads with **"Open preview"**; export/editor/MCP behind a "For developers" disclosure.

### Team, honesty, interrupts

**G14 · Derived handler, read-only — never a fake Assignee.** *(P2)* Task cards show "handled by: Developer" derived from the run. Crew gets a "now working on" column. Settle **Crew vs Agent** naming.

**G15 · The tray tiers, ages, and gets a URL.** *(N1–N3, all)*
- **Two sections, one badge.** *Blocking* vs *FYI*; the badge counts blocking only.
- **Age on every item**, plus a "since you were last here" divider.
- **The tray has a route** (`/needs-you`) and a single-column phone layout — the one overlay that must also be a destination.
- **One out-of-app ping** when a blocking item ages past a threshold.

**Also:** "Drill" never appears in the UI (one less hazard than assumed). "Waived" appears as a pill and **has no verb** — a word the user can read but never cause is a word they will misread.

---

# Conflicts

1. **G1 vs the honest vocabulary** — never rename the load-bearing nouns (verdict, evidence); gloss them once via `OnboardingHint`. G1 targets incidental jargon only ("freezes the oracle", "reserve floor", "spawns").
2. **G3 vs the operator** — one line, not a chart; named cost surfaces breed anxiety faster than control.
3. **G14 vs honesty** — read-only derived handler; give her the information, refuse her the lever.
4. **G11/G12 vs the designer's actual want** — do not add direct editing (second source of truth, unimplementable states); name the limit and promote the safe loop that exists (tweaks).
5. **G15 vs "overlays, not destinations"** — break the principle once, deliberately, and write down why.
6. **G8 vs Flow F's point** — the conversation is still the input; the header is a status line, not a control. Most likely amendment to slide back into a form during implementation.
7. **Rejected: collapsing the rail for single-project users** — adds a mode, breaks muscle memory; the empty rail is honest.
8. **The kill-switch contradiction, unresolved:** `quota-card.tsx` argues "a stop button reachable from a browser tab is a stop button an agent with a browser can un-press" — and `governor-card.tsx` exposes the kill switch as a checkbox anyway. One of those is wrong. Alex's call.

## What the redesign gets right for this population

Amendment A alone converts Maya's worst moment into her best one. B's single verb is right. Build's Flow/Plan serves the PM well enough that she is the only persona with no BROKEN verdict. F is cheap because pins are already built. **The failures found here are almost all failures of placement and naming, not of capability** — preview environments, checkpoints, the tweaks panel, the promote estimate, worktree isolation: all built, none reachable by the people who need them most.
