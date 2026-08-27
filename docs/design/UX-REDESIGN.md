# Ligma UX Redesign — from scratch, given what the product actually is

Date: 2026-08-14 · Status: PROPOSAL for Alex · Prior art: docs/reviews/ui-ux-review.md
(all findings fixed at the surface level; this document is about the architecture those
surfaces sit in).

## 1. Diagnosis — why it feels like "screens scattered everywhere"

The product is **project-centric**: everything Ligma does — compose, discover, design,
promote, dispatch, verify — happens *to a project*. But the UI is **feature-centric**:
seven global destinations (Home, Deck, Inbox, Projects, Library, Crew, Settings), eleven
flat tabs inside a project (overview, brief, studio, board, runs, verify, knowledge,
references, notes, design-files, terminal), and three surfaces that duplicate each other
at both levels (Board/Runs/composer exist globally AND per-project).

Concrete symptoms Alex hit in one session:

- "Adopt a repo" lives in the Home composer, but the project it creates appears in a
  list at the bottom of the same page — the action and its result are strangers.
- The canvas — the signature capability — is reachable only as the 3rd of 11 tabs
  inside a project the user must first find and open.
- Deck and Inbox are two separate "the machine needs you" destinations with two badges.
- The logo had to be added retroactively because no surface *owns* identity.

Root cause: the IA grew one route per feature. Nothing was ever demoted, merged, or
nested, so every capability is a peer of every other capability.

## 2. The organizing idea

Ligma has exactly **one loop**: *say it → shape it → build it → prove it*. Everything
else (Library, Crew, Settings, governor, memory) is either fuel for that loop or
housekeeping around it. The UI should BE the loop:

- The loop's stages are the project's navigation. Not eleven tabs — four stages.
- Everything global is either **identity/switching** (which project?), an
  **interrupt** (the machine needs a human), or **housekeeping** (settings-class).
  None of those deserve a full-page destination in the daily path.

## 3. The three-zone model

Borrowed deliberately from apps people already know: Slack's workspace rail, Linear's
opinionated per-item flow, GitHub's PR-checks page, Vercel's deploy feed, Notion's ⌘K.

### Zone 1 — Project rail (far left, ~64px, Slack-style)

- **Ligma mark at top** — identity lives here permanently, answering "what am I using".
- One avatar per active project (color + initials, or the design system's brand color
  once one is promoted). Click = switch. Current project visibly ringed.
- **“+” button = the composer as a modal**: "What are we making?" with its two moves —
  make new / adopt repo — right where the result will appear: the rail. The new
  project's avatar drops into the rail the moment discovery starts, pulsing until ready.
  This kills the "action here, result at the bottom of the page" split permanently.
- Bottom of rail: Library, Crew, Settings as small icons (housekeeping tier), governor
  gauge as the tiny heartbeat it is.
- The existing 56px nav sidebar **disappears**. Home/Deck/Inbox/Projects/Board/Runs as
  global destinations dissolve into zones 2–3.

### Zone 2 — The project workspace (everything else on screen)

A project opens to its **stage bar** — the pipeline strip promoted from a widget to THE
navigation, shape-adaptive exactly as it already is:

| Stage | Absorbs today's tabs | One-line job |
|---|---|---|
| **Brief** | brief, references, notes, discovery | What are we making and what constrains it |
| **Studio** | studio (canvas), design-files, critique | Shape it on the canvas until it's approved |
| **Build** | board, runs, terminal | Watch agents burn it down; intervene when asked |
| **Proof** | verify, knowledge | Signed verdicts, baselines, what's actually true |

- Each stage shows its state in the bar (the strip's existing chips: `queued/running/
  done/error` + counts), so the bar is also the project's status-at-a-glance.
- Absorbed surfaces become **panels inside their stage**, not routes: references is a
  drawer inside Brief; terminal a bottom split in Build; design-files a rail inside
  Studio. Deep links keep working — old routes 301 into stage+panel.
- An adopted repo simply opens with Brief pre-filled and Studio optional — the
  shape-adaptive logic already computes this today.
- **The canvas is one click from anywhere**: rail avatar → Studio is the default stage
  for design-shaped projects (the stage bar remembers the last stage per project).

### Zone 3 — The global layer: overlays, not destinations

- **Needs-you tray** — Deck and Inbox merge into ONE interrupt surface: a top-bar badge
  (single number) opening a right slide-over. The Deck's one-card-at-a-time flow stays
  as the tray's "focus mode" (it's genuinely good). Decisions, approvals, stale briefs,
  inbox messages — one queue, one badge, one muscle memory. GitHub notifications, done
  right.
- **⌘K** — already exists; becomes the only "go anywhere" (projects, stages, actions).
  ⌘P stays as the project quick-switch.
- **Top bar** — mark + project switcher (shipped yesterday), breadcrumb of
  project/stage, needs-you badge, autopilot heartbeat (running/paused + governor state
  — the machine's vital sign belongs in the chrome, not buried in a Runs page).
- **Home becomes the empty state, not a destination**: with no project open, the app
  shows the composer centered ("What are we making?") over the project grid. With
  projects, the app opens into the last-used project. There is no dashboard to
  maintain, so there is no dashboard to go stale — the review's frozen-"needs you"
  class of bug becomes structurally impossible.

## 4. Where every current surface lands (nothing is deleted)

| Today | Lands in |
|---|---|
| Home composer + widgets | Rail “+” modal; widgets dissolve (needs-you → tray, activity → Build feed, stats → stage chips) |
| Projects page | Rail; grid view stays as rail-“⋯” → "All projects" for archive/manage |
| Deck / Inbox | Needs-you tray (badge + slide-over + focus mode) |
| Global Board / Runs | Build stage of each project; a cross-project "what's running" lens lives in the tray's header line |
| brief/references/notes | Brief stage panels |
| studio/design-files | Studio stage panels |
| board/runs/terminal | Build stage panels |
| verify/knowledge | Proof stage panels |
| Library / Crew / Settings | Rail bottom icons, pages unchanged |
| Activity / Wall / Health | Feed panel in Build; Wall stays Studio's live lane; Health card tops Proof |

## 5. Visual layer (second-order, but part of "thoughtful")

- One container system: the stage fills the viewport minus rail+top bar; panels use
  consistent 16/24 insets (the audit already normalized the outliers).
- Stage-tinted accents: Brief neutral, Studio violet, Build blue, Proof green — the
  same hues the status vocabulary already owns, so color = meaning, never decoration.
- Typography: one scale step down on data-dense panels (Build, Proof), the current
  scale for Brief/Studio. Relative time everywhere (lib/time.ts, already shipped).
- The mark: rail top at 28px, favicon (shipped), and the empty-state composer header —
  three placements, never more.

## 6. Migration — three phases, each shippable alone

1. **Interrupt layer** (small): merge Deck+Inbox into the tray + top-bar badge;
   autopilot heartbeat into the top bar. Kills two rail items, one badge war.
2. **Stage bar** (medium): four stages absorb the eleven tabs as panels; old routes
   redirect. The pipeline-strip logic is 80% of this already.
3. **Rail + Home dissolution** (medium): project rail replaces sidebar; composer
   becomes the “+” modal and the no-project empty state; Home/Projects retire into it.

Each phase keeps the suites/drills/audits green; nav-crawl's route inventory and the
seam audit are the regression harness for the whole move.

## 7. What survives untouched (the genuinely good, per the review)

The honest vocabulary and total-Record rendering; Deck's one-card model (as tray focus
mode); Library's sandbox + wizard; the shape-adaptive pipeline computation; signed
verdicts as the only green; the writing.

## 8. Decisions for Alex

1. Ship order: phases 1→2→3 as above, or straight to 3 in one campaign?
2. Needs-you tray: is merging Inbox INTO Deck's queue acceptable, or must inbox
   messages stay a separate list inside the tray?
3. Default stage on open: last-visited (proposed) or always Studio for design-shaped
   projects?
4. The global cross-project Runs lens: tray header line (proposed) or keep a full page?

---

# Part 2 — Walking real flows through the model (2026-08-14)

Part 1 solved navigation. Alex's push: walk *work* through it — project management,
and the human↔system conversation. Six flows, walked honestly; where the model broke,
it's revised below. Part 1 stands except where §12 amends it.

## 9. The flows, and what each one broke

**Flow A — Monday morning: "what needs me, across everything?"**
Open app → last project's Studio. But the Monday question is cross-project. Tray badge
says 7 → focus mode: two decisions, a failed spot-check, two inbox messages, a stale
brief. Good — until the last card is answered and the question becomes "so what's the
machine doing *now*?" — and Part 1 left only a thin tray-header line.
*Broke:* killing global Runs left mornings without a pulse.
*Fix:* ambient status instead of a page — **rail avatars wear status rings** (pulsing
blue = building, amber = needs you, green = fresh verdict, grey = idle), and the
no-project grid shows the same chips per project card. The rail becomes the dashboard;
glancing left answers Monday. (Slack's unread dots, promoted to process state.)

**Flow B — mid-build course correction: "drop feature X, customers hate it"**
User is in Build, 12 tasks in flight. Needs to: see what's running, stop two tasks,
edit three, add one, and — critically — record *why*. Board handles the task surgery
(exists today). Two real gaps: there is **no per-project pause** ("hold dispatch while
I rethink" — today only the global daemon toggle), and the *why* has nowhere to live —
it belongs in project memory so future planning knows, not in a task description.
*Fix:* Build header gets **Pause project** (a dispatcher-level per-project gate, small
daemon change); the why goes to Talk (§10), which writes project memory.

**Flow C — the system needs a decision mid-flight**
Agent hits a fork → decision card. Tray shows it (quick answer path — good). But a
decision *about a design* answered as a disembodied tray card, away from the canvas,
is how bad calls happen.
*Broke:* one queue is right for triage, wrong for context.
*Fix:* decisions render **in-context too**: the blocked task's card in Build shows
"waiting on you: ⟨question⟩ [Answer]" inline; design approvals surface on the canvas in
Studio. Tray and in-context views are the same queue objects (the server deck-queue
route already exists) — answering in either place clears both. Tray = triage;
in-place = context. Never two sources.

**Flow D — the human talks: "why did this fail?" / "@researcher, compare onboarding flows"**
Today this conversation *cannot happen* — interaction is form-shaped (composer,
discovery form, decision dialogs). Yet the engine already has the pieces: inbox +
`run-inbox-respond` (agents answer messages), agent dispatch under the governor, crew
roles, per-agent memory.
*Broke:* the biggest gap in Part 1 — no conversational surface at all.
*Fix:* **Talk** — §10. This is the flagship revision.

**Flow E — judging proof: "can we ship?"**
Verdict lands → rail ring green → Proof. Health summary top (already summary-first),
verdict list below, baselines behind. Spot-check goes through the tray like any
decision. The one missing action: *handoff* — "it's proven, now get it out of Ligma" —
export, open-in-editor, MCP handoff all exist (R4) but live in Settings/Integrations.
*Fix:* Proof gets a **Ship panel**: the handoff actions surface where the proof is,
plus "what's still unproven" as the honest blocker list.

**Flow F — day zero: adopt a repo**
"+" → adopt → discovery asks its questions. Part 1 left discovery as the form it is
today. But discovery *is* a conversation — the system asking, the human answering,
answers becoming locked constraints.
*Fix:* discovery runs **in the Talk thread of the Brief stage** — same message
components, system-authored questions with the existing typed inputs inline (the
range/date/switch controls survive as message widgets). The brief page then shows what
the conversation produced: brief text + locked constraints, each tracing back to its
message. Kickoff stops being a form you fill and becomes the first conversation of the
project — which is what it actually is.

## 10. The interaction model — two channels, one rule

**System → human: the tray.** Everything the machine needs from a person — decisions,
approvals, spot-checks, stale briefs, inbox — one badge, one queue, focus mode for
card-by-card. Every tray item also echoes in-context at the object it blocks (Flow C).

**Human → system: Talk.** A right-hand drawer, available in every stage of every
project (⌘J), scoped to that project:

- Address the system (default) or a crew member (`@researcher …`).
- Under the hood it reuses what exists: messages land in the project's thread; ones
  that need intelligence dispatch through the governor to the addressed agent (the
  `run-inbox-respond` path, project-scoped); answers come back as messages **citing
  objects** — task/run/verdict/design chips that deep-link. No new engine, one new
  store (thread per project), one new surface.
- Statements of intent ("we're dropping X because Y") get a "remember this" affordance
  → project memory, which planning already injects.
- Discovery (Flow F) and the notes thread (today's notes-panel, self-described as
  side-chat v1) both fold into Talk — notes become plain unaddressed messages.

**The rule: forms for structure, conversation for everything else** — and every
conversation outcome must land in a structured object (constraint, memory, task,
decision), because agents plan from the store, not from chat history. Talk is a
channel, never a second source of truth.

## 11. Each stage, from scratch

Discipline per stage: **one primary surface, drawers for the rest, one header row**
(stage state + its one or two verbs). No stage becomes a junk drawer.

**Brief** — *what are we making, and what's locked.*
Primary: the brief document + locked constraints (each links to the Talk message that
set it). Drawers: references/mood-board, Talk (opens here during discovery).
Header verbs: Edit brief · Re-run discovery. Empty state = discovery conversation.

**Studio** — *shape it until it's approved.*
Primary: the canvas (Wall/critique lanes as today). Drawers: design files, versions
(rail exists), Talk. Header: critique/approve state chip · Promote to build (gated on
approval, as today). Design decisions echo here on the canvas (Flow C). Default stage
for design-shaped projects.

**Build** — *the machine works; the human steers.*
Primary: the board, with **two view toggles: Flow (kanban) · Plan (grouped by
goal → milestone)** — this is where project management lives. Goals/milestones are
panels of Build's Plan view, not a global Objectives page; the derived status pills
(deriveGoalStatus, shipped) make the Plan view honest for free. Task cards carry their
live run state inline (SSE, shipped) and their blocking question inline when one
exists. Drawers: activity feed (project-scoped), terminal, Talk. Header: running/
queued/deferred counts · **Pause project** · dispatch-next.

**Proof** — *what's true, and shipping it.*
Primary: health summary (summary-first, shipped) over the verdict list; baselines
behind a drawer. **Ship panel**: export, open-in-editor, MCP handoff, and the honest
"still unproven" list. Header: proven/pending/waived counts. Verdict spot-checks
arrive via tray, echo here.

## 12. Amendments to Part 1

- Rail avatars get status rings; the no-project grid gets matching chips (Flow A).
- Surfaces missed in Part 1's mapping: **Objectives → Build's Plan view** (page
  retires); **Priority Matrix → a Flow-view lens** on the board; **Brain-dump → a
  Talk affordance** ("dump" = unaddressed messages + triage, reusing its engine);
  **Activity → the Build activity drawer**, cross-project slice in the tray header.
- Discovery moves from form to Talk-thread (Flow F); the question-form input types
  survive as inline message widgets.
- New capability requirements surfaced: per-project dispatch pause (daemon),
  project Talk thread store + governor-gated respond dispatch (daemon), decision
  echo on task cards and canvas (web).

## 13. Revised decisions for Alex (supersedes §8)

1. **Ship order** — proposal: Tray (§8's phase 1) → **Talk** (new phase 2, it
   unblocks the discovery-as-conversation and memory flows) → Stage bar → Rail.
   Talk-before-stages because it changes what Brief/Build stages contain.
2. Inbox merges fully into the tray queue, or stays a section within it?
3. Talk dispatches through the governor like any agent work (proposed) — accepting
   that an answer may be *deferred* when quota is tight, shown honestly in-thread?
4. Objectives page retiring into Build's Plan view — any attachment to it as a
   global page?
5. Per-project pause: dispatcher gate only (proposed), or also pause running agents?

---

# Part 3 — Synthesis of four rounds (2026-08-14)

Round 1 (solo technical founder, in conversation) produced amendments A–F. Rounds 2–4
(non-technical · power users · lifecycle/disaster) ran independently; full reports in
docs/design/ux-rounds/. 63 flows walked in total. This part merges ~50 lettered
amendments into one design, resolves the cross-population conflicts, and separates
"design" from "these are bugs, fix now."

## 14. The verdict across all rounds

The three-zone model survives — no round proposed replacing it, and its two best
instincts (one interrupt queue with in-context echoes; retiring the stale-dashboard
class) were validated by every population. What failed was everything the model didn't
look at: **money, reversal, scale, the machine itself, and time.** The recurring
pattern in all four rounds: the reassuring machinery already exists (worktree
isolation, checkpoints, tweaks panel, promote estimate, stopEngine, preview envs,
batch decisions) and is either unreachable, unnamed, or deleted by the proposal.

## 15. Fix now — bugs and lies, independent of any redesign

| # | What | Source |
|---|---|---|
| F1 | Dispatcher ignores `ProjectStatus="paused"` — the control is cosmetic. Wire it or remove the option | G7/J3 |
| F2 | Checkpoint restore wipes the activity log (`saveActivityLog({events:[]})`) and doesn't stop the engine first | J6 |
| F3 | "Copy CLI prompt" handoff embeds the workspace-wide context digest — cross-project privacy leak | J14 |
| F4 | Per-project board lacks the Done collapse the global board has (36,900px bug still live one route over) | J9 |
| F5 | use-everywhere page claims "ligma has no MCP server"; the daemon ships one with six tools | H-note |
| F6 | Version rail never renders `createdAt` — one line | J5 |
| F7 | Kill-switch contradiction: quota-card argues browser-reachable stops are un-pressable by agents; governor-card ships the checkbox anyway | G-conflict |

F1–F6 are unambiguous. F7 is Alex's security-posture call (§18 Q2).

## 16. The merged design, by theme

**The machine gets a home.** One heartbeat (not two) in the top bar; clicking it opens
the machine overlay: daemon state, governor window with the *deny reason*, backends,
kill switch, `/api/logs` tail, and the safety posture stated (`skipPermissions`
refused server-side). Rings desaturate to a no-signal state when the daemon poll
fails; a stopped/unreachable machine is itself a blocking tray item. (H1, J4, H12, S1/S2)

**Verbs for starting and stopping — never the word "Pause" alone.**
Start: per-project, deliberate — "Start building (≈12 sessions)" with the estimate on
every launch affordance, promote sheet rewritten in human language with the isolation
sentence ("agents work in an isolated copy; your files and GitHub are untouched"), and
reversibility stated at every gate. Stop: three tiers, distinct labels — *Stop
starting new work* (per-project dispatcher gate, F1 wired), *Stop everything now*
(global, the heartbeat's click-through to existing `stopEngine()`, aftermath panel
naming what was killed/reset + the three rollback routes), *Kill switch* (in the
machine overlay, posture per §18 Q2). Start is deliberate and scoped; stop is one
button everywhere. The asymmetry is the point. (B, G1–G5, G7, H6, J2, J3)

**Tray v2 — the interrupt layer, hardened.** Two sections, one badge: *Blocking*
(decisions, approvals, stalls, machine-down) vs *FYI* (inbox, activity); the badge
counts blocking only. Age on every item + a "since you were last here" divider
(one `lastSeenAt`). Focus mode below ~8 items; grouped-by-project list mode with
select-all/bulk above (thresholds, never preferences). Two further tabs: *Running*
and *Activity*, reusing today's pages' rendering. The tray has a URL (`/needs-you`)
and a single-column phone layout — the one overlay that is deliberately also a
destination, because it must be reachable from a notification. One out-of-app ping
when a blocking item ages past a threshold. "Can't tell" renders as an error, never
as an empty tray. (G15, H2, H3, H12, J1, E)

**Truth gets bound to facts, not timers.** Commit SHA recorded on every run and
verdict (`git rev-parse`, the one non-trivial engine add) — Proof marks "code moved
since" instead of a 7-day guess; `stale` joins the Proof header counts; brief drift
gains the age trigger it lacks (unchanged N months while M tasks completed →
existing stale-brief card with "Re-run discovery / Still true"); `projectId` lands on
ActivityEvent and run/verdict/promote/design events enter the enum; DecisionItem
gains a consequence link (ids of tasks re-planned) so amendment C renders data, not
an LLM summary of free text. (J10–J12, J16, C, G10)

**Conversation with guardrails.** Talk ships with: the discovery thread keeping the
form's scaffolding (persistent "Still needed: N of M" header, per-question Skip,
"You decide"); locked answers become editable, routed through the consequence
machinery; "I'll write the brief myself" as the first thread's exit link; Talk and
discovery draw from the governor's *human reserve* so day zero never gets "deferred";
"remember this" lands in `.ligma/project.md` Quirks (the store that exists) until a
real project-memory store ships; in Studio the composer targets the selected design
and produces *typed* pins (change this · try variations · reference). (F, G8, G9,
H8, J7, J8, G12)

**Show me the thing.** Proof leads with "Open preview" (the ephemeral-env URL that
already exists) and the design baseline beside the built screen, above the verdict
list; export splits into two named actions — *Share design* in Studio (client,
pre-build), *Hand off* in Proof (developer, post-proof, project-scoped after F3);
"what travels" stated in one line; a stakeholder-pastable status line generated from
the health roll-up. (G13, J13, J15, M4, P4)

**Scale by tiers.** The rail holds pinned + recently-active avatars (names on hover,
words not just colours); past ~8 it overflows into a "+N" chip opening the portfolio
grid — the true cross-project dashboard: status chips, sortable columns, goals
(including project-less ones), and the cross-project task table with today's bulk
bar. Objectives and the global Board retire *into the grid*, not into thin air.
(H4, H13, M6)

**Observability depth, summary-first.** Task detail gains Changes · Log · Prompt
tabs (engine: persist the built prompt; capture the task diff) — Log default,
never auto-expanded; the command runner gets its honest name ("Run a command") and
moves beside Talk; ⌘K becomes a real command palette (project → stage → verb) with
the G-chords and `?` sheet remapped in the same commit that ships the rail; every
ring state exists as a word somewhere reachable. (H7, H10, H11, R1/R3/R4)

**Honest copy debts.** Studio names its mode ("Review canvas — you shape it by
asking, not by dragging" + a "Two things this does not do" box); task cards show a
read-only derived "handled by"; Crew-vs-Agent naming settled; "we don't estimate
dates" stated where a PM will look; waived's no-verb nature glossed; the attempt
counter surfaces on tasks/verdicts so reject-loops are visible spend. (G11, G14,
P3, P5)

## 17. Resolved conflicts (recommendations, overridable)

1. **Plain language vs honest vocabulary** — never rename verdict/evidence/waived;
   gloss once via OnboardingHint; rewrite only incidental jargon (oracle, reserve
   floor, spawns).
2. **B's purity vs a global stop** — keep both: per-project deliberate start, global
   one-click stop. Asymmetry is correct.
3. **Simplicity vs depth** — thresholds and defaults, never modes or preferences:
   focus mode under 8 items, Log tab default, Changes/Prompt collapsed, machine
   overlay behind a click.
4. **Direct manipulation vs single source of truth** — no canvas editing; name the
   limit, promote tweaks, type the pins.
5. **"Overlays not destinations" vs the phone** — break the principle exactly once
   (the tray's URL), documented.
6. **Cost visibility vs cost anxiety** — record everything (ledger fields), show
   one line per project; sessions stay the primary vocabulary.
7. **Honesty vs looking worse** — accept "312 proven · 300 stale" on mature
   projects; it is the product's own thesis applied to itself.

## 18. Decisions for Alex (final, supersedes §13)

1. **Adopt the merged design?** Phases: **0** fix-now list (§15) → **1** tray v2 +
   machine overlay + stop verbs → **2** Talk + discovery-thread + data-model fields
   (J16, SHA, ledger cost fields) → **3** stage bar + rail + portfolio grid +
   keyboard parity. Each phase green on suites/drills/audits before the next.
2. **Kill switch posture (F7):** browser-reachable checkbox, or file/CLI-only with
   the UI stating why? (quota-card's argument is sound; it's your threat model.)
3. **Engine cost recording (H5):** tokens/duration per spawn in the ledger — adopt
   now (phase 2) or defer? Without it, multi-client use has no cost story.
4. **Out-of-app ping channel** for aged blocking items: system notification, email,
   or none for v1?
5. **Inbox inside the tray:** fully merged into one queue (proposed) or a labelled
   section?
