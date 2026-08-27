# Execution / planning / prioritisation review — 2026-08-26

> **Status update (2026-08-27):** this doc's own contract is "strike items
> through as they land"; only Phase 0 (C1, C3) and H5 were struck through as
> of this update, but a source audit (`docs/audits/codebase-audit-2026-08-27.md`
> finding D2) confirmed the following are also landed in code: **C2**
> (`dispatcher.ts` — all-or-nothing admission), **H1/H2** (`dependsOn`,
> `promote.ts`), **H3** (`promote.ts`/`panel.ts`), **H4** (`parkedReason` in
> types+tests), **H6** (dedupe, `verdict.ts`), **H7** (`prompt-builder.ts`),
> **H8** (`verdict.ts`), **M1/M2/M6** (`dispatcher.ts`). Treat every item below
> except the still-open ones (check `docs/parity/feature-track.md` or the
> dispatcher source directly for current state) as landed — this file is not
> re-struck line-by-line here because dispatcher/harness source is under
> active concurrent work and exact line citations would go stale immediately.

Fresh-context adversarial review of the task pipeline, evidence-first, mined
from the live `proj_DSI_uzQjuVqx` incident (16 tasks, 32 verification
launches → 27 run dirs, 180 in-window quota bookings, 82 decisions, 70 poll
cycles). Fix phases at the bottom; strike items through as they land.

## CRITICAL

- **C1 — `vrun_${Date.now()}` collides.** The dispatcher spawns up to 4
  verifications in one tight loop; same-millisecond ids merged four tasks
  into one run directory — cross-contaminated persona evidence (each judge
  read whichever reports landed last), 84 of 180 quota bookings (47% of the
  window) were collision duplicates, 5 runs lost entirely.
  Fix: `generateId("vrun")` (run-verification.ts). Land before measuring
  anything else. **[FIXED — Phase 0]**
- **C2 — one-slot admission for a ~14-session fan-out.** `dispatchVerifications`
  gates on a single `canSpawn("judge")` (which reserves nothing) then claims
  13 personas + judge individually, each waiting 20 min. 15 of 20 run.json
  ended governor-denied with zero reports; one run did 13 personas over 50
  minutes then starved on the judge — 13 sessions, one attempt, no evidence
  retained (refund correctly withheld since the panel had started).
  Fix: all-or-nothing admission — require `remaining >= rosterSize + 1` at
  the door and claim the judge slot up front. Effort M, depends C1.
- **C3 — auditor runs last.** The spec-auditor is the only charter that may
  mark criteria met, and the roster ran it after every walker/saboteur/
  visual-critic — a starved panel spent budget on colour commentary and died
  before adjudication. Fix: auditor first. **[FIXED — Phase 0]**

## HIGH

- **H1 — `dependsOn` cannot work and fails silently.** `tempId` (`t1..tN`) is
  assigned AFTER the planner emits its plan, so the planner has no vocabulary
  for dependencies; unresolvable deps are dropped by a `.filter` with no
  warning. docs/history/harvest.md:174-178 diagnosed this exact bug upstream
  ("permanently undispatchable") and it was inherited anyway. Fix: planner
  emits its own `id: "t1".."tN"`, keys `dependsOn` off them; THROW on an
  unresolvable dep. Effort S, blocks H2.
- **H2 — planner never asked for priority/deps/sizing.** Promote hard-codes
  importance/urgency for every task, so the Eisenhower sort is a no-op and
  dispatch order is plan order. Fix: `dependsOn` guidance + a per-task
  `risk: low|high` mapped to urgency. Effort S, depends H1.
- **H3 — promote preview under-quotes cost ~5×.** `estimateSpawns = tasks*3`;
  the real mixed-shape roster is 15/task (up to ×3 attempts). `willDefer`
  said false for a plan that consumed the whole 5-hour window. Fix: derive
  from `panelTransports`/`transportRoster` (pure, exported). Effort S, land
  with C2.
- **H4 — the most common parked state is invisible.** The ≥3-pending-decisions
  park produced 413 log lines and zero UI. No API field carries the reason;
  the task panel has no decisions section; the manual Run button ignores the
  park entirely (routes/tasks/_id/run) so daemon and button disagree. Same
  class: `deferredUntil` ("nothing else reads it") and builder-side governor
  denial. Fix: return the reason, persist `Task.parkedReason`, render in the
  existing FailureCard slot, deep-link to the pending decisions. Effort M —
  highest user-visible payoff per line.
- **H5 — no shape for a project that isn't a running program.** Boot schema
  requires dev/healthPath/healthMarker; a research repo fabricated a server
  and got 13 browser/http personas incl. saboteur + visual-critic pointed at
  a markdown paper. Fix: `"artifact"` project shape + `"fs"` transport
  (worktree read + declared run command; ~100 lines against the Bridge
  interface), boot `dev: null` + `artifacts:` globs (Zod `.refine`), roster
  = reviewer + auditor (2 sessions/task instead of 15). Effort M.
  **[FIXED — Phase 5]** `"artifact"` shape → single `"fs"` transport;
  `fs-bridge.ts` (list / read / run-the-declared-check, worktree-contained
  incl. symlinks, records as citations); `boot.json` is a union — server
  (`dev` argv) or artifact (`dev: null`, `artifacts[]`, optional `check`);
  an artifact env is worktree + install, no port, no health poll; roster is
  auditor + one reader, 2 sessions/task.
- **H6 — judge questions never dedupe.** `appendHumanDecisions` pushes
  unconditionally — the cap-card dedupe (ad3b052) was never applied to its
  sibling. One task: 11 pending near-duplicates from two runs 84s apart; the
  judge parked the task by talking (trips H4's ≥3 rule). Fix: fingerprint on
  normalized text (harvest.md:126-129 primitive) now; judge-declared
  `duplicateOf` (structured, no string matching) as the honest version.
  Effort S/M, pair with H4.
- **H7 — attempt N+1 sees one verdict, not the attempt history.** Feedback
  reads only the latest failed verdict; three attempts relitigate the same
  ground. Fix: one-line-per-attempt digest from the persisted Final Reports
  (8dc1af2) above the existing block. Effort S.
- **H8 — "Open a follow-up task" is a dead string.** Offered on every judge
  decision card; zero handlers. Fix: extend `consumeAnsweredCapCards`'s
  existing answered-card pass — insert one task (title = question,
  description = context + runId, `blockedBy: [originTask]` once H2 lands),
  record in the existing-but-unwritten `consequenceTaskIds`. ~25 lines.

## MEDIUM

- **M1** — verification ignores `pausedProjectIds` / deferral / blocking
  decisions: pausing a project doesn't stop its quota burn. S.
- **M2** — builders structurally starve verification (both draw from 4 slots,
  builders first; 19 cycles of "awaiting verification but no slots"). Reserve
  one slot for verification. S.
- **M3** — `ctr_${Date.now()}` collides in commitPromote's loop (5 tasks, one
  contract id). **[FIXED — Phase 0]**
- **M4** — crash retries and verification send-backs share one counter
  (`retries: 1` can skip a healthy third build). Separate them. S.
- **M5** — `blockedBy` destructively pruned as blockers complete; compute
  blockedness instead (web already does). S, matters after H1.
- **M6** — 2-minute poll adds dead time at every chain transition (~16 min
  on an 8-task chain). Trigger `pollAndDispatch()` on session exit (hook
  exists). S.

## LOW

- **L1** — first governor denial breaks the whole dispatch loop (other
  backends never considered). S.
- **L2** — file-lock force-acquire after 15s can rmdir a live lock. S.
- **L3** — verification-cap cards lose `kind` en route to the UI, rendering
  as generic decisions. S.

## Un-ported harvest items that matter here

Verified zero hits for `agent-health` (zombie / completed_not_surfaced
liveness — why stale reconcile has to blanket-reset), `DispatchContextAudit`
(prove which context a persona actually received — C1 made this urgent), and
failure fingerprinting (the H6 primitive).

## Fix order

- **Phase 0 — done 2026-08-26**: C1, C3, M3 (three one-line fixes; stopped
  47% quota waste, cross-contaminated verdicts, and no-verdict starved runs).
- **Phase 1 — quota sanity**: C2, H3, M1, M2 (shared arithmetic, one change).
- **Phase 2 — legibility**: H4, L3, M6 (+ manual-Run/daemon agreement).
- **Phase 3 — planning**: H1 → H2 → M5 (strictly ordered).
- **Phase 4 — feedback loop**: H6, H7, H8, M4.
- **Phase 5 — artifact shape — done 2026-08-27**: H5 (makes research projects
  cheap, ×5 better C2 arithmetic).
