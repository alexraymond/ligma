# Ligma UX Rebuild — goal and definition of done

Owner: Alex (alex@tyrell.global) · Date: 2026-08-14 · Status: READY TO SEND
Spec: `docs/design/UX-REDESIGN.md` (Parts 1–3 — Part 3 §16 is the merged design and
supersedes Parts 1–2 where they conflict) · Evidence culture: `docs/evidence/DONE.md`

## Goal

Rebuild Ligma's UI around the merged three-zone design so that the product's surfaces
match what it actually is: one loop (say it → shape it → build it → prove it) per
project, one interrupt channel from the system to the human, one conversation channel
from the human to the system, and one honest view of the machine itself. Ship it in
four phases, each independently green and committed, so the app is never broken and
the owner can stop after any phase with a better product than before it.

You are building against a working app with 1,500+ passing tests, three zero-token
drills, and two audits (nav-crawl, seam-audit) that are the regression harness for
exactly this kind of move. Every phase must leave all of them green.

## Owner decisions — already made, do not re-litigate

These resolve the spec's §18 open questions. Override only by editing this section.

1. All four phases are approved, in order. Stop after any phase if the owner says so.
2. Kill switch: file/CLI-only. Remove the browser checkbox from governor-card; the
   machine overlay states why ("a stop an agent's browser can reach is a stop an
   agent can un-press"). This matches the audit-§4 hidden-by-design list.
3. Engine cost recording (tokens in/out, duration per spawn in the quota ledger):
   yes, in phase 2. Show as one line per project, sessions stay the primary unit.
4. Out-of-app ping for aged blocking items: local system notification only in v1.
   No email, no external services.
5. Inbox merges fully into the tray queue as items, not as a separate section.

## Phases and their definitions of done

### Phase 0 — fix-now list (spec §15)

Seven fixes, each with a regression test that fails without it:
- F1 dispatcher honors `ProjectStatus === "paused"` (skips dispatch; running agents
  unaffected); the edit dialog's Paused option now does what it says.
- F2 checkpoint restore no longer wipes the activity log, and stops the engine (or
  refuses while sessions are live); dialog copy names its true scope.
- F3 handoff prompt is project-scoped — the workspace-wide context digest is removed.
- F4 per-project board gets the Done collapse (`collapseAfter`), same as global.
- F5 use-everywhere copy stops denying the MCP server exists; document its six tools.
- F6 version rail renders `createdAt` via lib/time.ts.
- F7 kill-switch checkbox removed per owner decision 2 above.

**Done when:** 7 regression tests exist and pass; full daemon+web+api suites,
typecheck, lint green; drills 3/3.

### Phase 1 — interrupt layer + the machine (spec §16 themes 1–3)

- Tray v2 at `/needs-you`: Blocking vs FYI sections; badge counts blocking only;
  age on every item; "since you were last here" divider off one `lastSeenAt`;
  focus mode below 8 items, grouped-by-project list mode with select-all/bulk above
  (thresholds hardcoded, not preferences); Running and Activity tabs reusing the
  existing pages' rendering; single-column layout at phone widths; fetch failure
  renders as an error state, never an empty tray; a down daemon inserts a blocking
  "machine unreachable" item.
- Machine overlay behind one top-bar heartbeat (the governor gauge and autopilot
  pill merge — one heartbeat, not two): daemon state, governor window with deny
  reason, backends, kill-switch state (read-only + why), `/api/logs` tail (first UI
  consumer), and the stated safety posture.
- Stop/start verbs: "Stop starting new work" per project (uses F1); "Stop everything
  now" on the heartbeat (existing `stopEngine()`), with an aftermath panel naming
  sessions killed / tasks reset and linking the three rollback routes; promote sheet
  rewritten in plain language + the isolation sentence + reversibility line; session
  estimate shown on every launch affordance (RunButton, autopilot).
  [CORRECTED during phase 1: the spec's isolation sentence ("agents work in an
  isolated copy; your files and GitHub are untouched") is FALSE for builders —
  `builderCwd` is the project's real repoPath; only verification/journey runs use a
  throwaway worktree, and nothing in the daemon pushes to GitHub. The shipped copy
  states that truth. Never reintroduce the "isolated copy" claim for builders.]
- Local system notification when a blocking tray item ages past 24h (one ping per
  item, ever).
- `/deck` and `/inbox` redirect to `/needs-you` (redirect pages, like the eight
  existing legacy redirects).

**Done when:** all suites green; drill-d4 updated to drive the tray (same journey:
answer, undo within server window, re-answer, bulk clear) and passes; nav-crawl PASS
with the new route + redirects in its inventory; seam-audit PASS (tray states speak
the one vocabulary — borrow paint, never repaint); phone-width screenshot of
/needs-you recorded in evidence.

### Phase 2 — conversation + data model (spec §16 themes 4–5, decisions 3)

- Data model first, each field with a migration that tolerates old data
  (readOrDefault pattern; absent ≠ empty): `projectId` on ActivityEvent + new event
  kinds (run, verdict, promote, design-turn); consequence links on DecisionItem
  (task ids created/changed by the answer — written where the answer is applied,
  never parsed from text); commit SHA on runs and verdicts (`git rev-parse` at
  spawn/verdict time; absent for repo-less projects); tokens/duration on ledger
  entries. Proof marks "code moved since" when HEAD differs; the 7-day timer remains
  only where no SHA exists. `stale` joins the Proof header counts.
- Talk: per-project thread store; drawer (⌘J) in every project surface; addressable
  to the system or a crew role; dispatches through the governor's human reserve
  (never "deferred" on day zero); replies cite object chips (task/run/verdict/
  design) that deep-link; "remember this" appends to `.ligma/project.md` Quirks and
  says so on the button.
- Discovery runs in the Brief thread with the form's scaffolding kept: persistent
  "Still needed: N of M" header, per-question Skip, "You decide", the existing
  typed input widgets inline, an "I'll write the brief myself" exit link, and an
  edit path for locked answers routed through the consequence machinery (requires a
  daemon path to amend an answered form — build it; the current "form is no longer
  open" throw stays for the stale-client case only).
- Task detail gains Changes · Log · Prompt tabs: persist the built prompt beside the
  run record at spawn time; capture the task's diff (worktree `git diff` at run
  end); Log is the default tab; the others never auto-expand.
- Brief drift age trigger: brief unchanged 90+ days with 25+ tasks completed since →
  existing stale-brief card with "Re-run discovery / Still true (snooze 90d)".

**Done when:** all suites green including new store/migration tests (old-format
fixtures load); a zero-token Talk drill exists — fake-claude answers a thread message
and the reply's object chips resolve (extend the existing drill/fake-claude lane, env
switch on LIGMA_SPAWN_ROLE, never prompt text); discovery drill (drill-d1 extension)
walks the thread path: ask → skip → answer → lock → edit-one-answer → consequence
recorded; drills 3/3 + the new lanes; no live-LLM calls anywhere in tests.

### Phase 3 — the shell (spec §16 themes 6–8, Part 1 zones)

- Project rail replaces the sidebar: mark at top; pinned + recently-active avatars
  (name on hover, ring state also present as text in the tooltip and ⌘K); status
  rings with the no-signal desaturated state when the daemon poll fails; "+" opens
  the composer modal (make / adopt); from the empty state kickoff navigates into the
  project with discovery open, from inside another project it pulses + toasts
  without navigating; past 8 projects a "+N" chip opens the portfolio grid.
- Portfolio grid (evolves /projects): status chips, sortable columns, goals
  including project-less ones, and the cross-project task table with the existing
  bulk bar. Objectives and the global Board retire into it with redirects.
- Stage bar: Brief · Studio · Build · Proof (shape-adaptive via the existing
  pipeline-strip logic), absorbing the eleven tabs as panels/drawers per spec §11 —
  including the tweaks panel in Studio (open by default for design-shaped projects),
  typed pins, the command runner renamed "Run a command" beside Talk, Build's
  Flow/Plan toggle with goals/milestones, Proof leading with "Open preview" and the
  design-beside-built comparison, Share design (Studio) vs Hand off (Proof), and
  the honest-copy items from §16 (Studio names its mode; derived "handled by";
  "we don't estimate" line; attempt counter on tasks/verdicts).
- Every old route 301s (project tabs → stage+panel deep links); ⌘K becomes a command
  palette (project → stage → verb); G-chords and the `?` sheet remapped in the same
  commit that ships the rail; Home becomes the no-project state (composer over the
  grid) and `/` with projects opens the last-used project.

**Done when:** all suites green; nav-crawl PASS with the full new inventory — every
old route redirecting, zero orphans, gates re-argued as needed; seam-audit PASS with
zero new exemptions; drills 3/3 re-pointed at the new routes; a fresh-install
walkthrough (empty data dir) reaches: composer → project → discovery thread → (stub)
design → Start building → tray item → answer → consequence, all via drill lanes at
zero tokens; keyboard map documented in the `?` sheet and true.

## Global rules (binding, all phases)

- No live-LLM calls in any test or acceptance path — drills, fake-claude, and suites
  only. Proof runs are minted only if the owner explicitly asks.
- No new dependencies without listing them in the phase report with the license
  (MIT-compatible only). No virtualization/chat/date libraries — the codebase's own
  primitives cover all of this.
- The honest vocabulary is load-bearing: verdict/evidence/waived/error≠failed are
  never renamed; total-Record status rendering everywhere; status colours come only
  from status-pill.tsx; absent ≠ empty in every read path.
- Never regex/keyword-parse structured data from free text — if a fact needs
  rendering, add the field where the fact is written.
- Never UI-editable: `execution.skipPermissions`, the Ed25519 signing key, oracle
  deny-rules, the governor kill-switch file (audit §4).
- Conventional commits, small and per-surface; no AI-attribution trailers; no
  open-codesign references in any ligma-authored content.
- Config lives in `~/.ligma` / env; project artifacts never land in the ligma repo;
  contracts and runtime state stay untracked.
- Multi-agent execution: file-ownership contracts per wave (see docs/history/CONTRACTS-*.md
  for the format); no two agents edit the same file; conductor applies shared-file
  handoffs (routes/index.ts, packages/api/src/routes.ts, settings inclusions).

## The deliverable the owner reads

`docs/evidence/DONE-UX.md`: per-phase scoreboard — what shipped, the test/drill/audit
tails proving it, screenshots (fresh-install and dogfood, desktop and phone width for
the tray), route-redirect census, and anything deliberately deferred with its reason.
Same tier discipline as DONE.md: name what is proven and how, never more.
