# Process audit — 2026-08-27

A process-level audit of ligma's end-to-end workflows: not a line-by-line code review, but whether the journeys the product promises actually compose into complete, walkable paths — walked twice, once as a first-time human following only the docs, once as an agent chaining HTTP calls and exit codes.

**Method.** All flows were exercised empirically against a real daemon started from this checkout with a throwaway store (`LIGMA_DATA_DIR`, `LIGMA_ENVS_DIR`, `LIGMA_PRODUCTS_DIR` pointed at a session scratchpad, port 14747), never against the repo's own `data/`. Backend CLIs (`claude`, `codex`, `gemini`) were stubbed via PATH shims plus `claudeBinaryPath`/`codexBinaryPath`/`geminiBinaryPath` config pins, so every spawn returned an instant no-op envelope — this is why every "the model replied garbage" path below is a *legitimately exercised failure path*, and why happy paths that need real model output (discovery, planner, judge) were walked via `LIGMA_DISCOVERY_STUB=1` or by hand-supplying the artifact the agent would have produced (a reviewed promote preview; a committed `.ligma/boot.json`). Each finding was re-tested before being reported; **CONFIRMED** = reproduced against the running daemon (or proven by git/state inspection), **PLAUSIBLE** = traced in code but not reproduced.

This is the process lane of a three-lens audit; the docs lane (`docs/audits/docs-audit-2026-08-27.md`) covers documentation drift in depth. Where a docs finding has a process consequence that was hit empirically (README onboarding), it appears here with the process facet only.

Severity: **CRITICAL** (a promised journey is unwalkable, or data is destroyed/lost) · **IMPORTANT** (a journey strands the user, lies to them, or silently corrupts downstream state) · **ADVISORY** (friction, latency, agent-hostility) · **MINOR** (cosmetic/edge).

**Counts: 3 CRITICAL · 9 IMPORTANT · 7 ADVISORY · 4 MINOR** (23 findings).

---

## 1. Summary table

| ID | Severity | Process | One-line issue | Status |
|----|----------|---------|----------------|--------|
| P1 | CRITICAL | Onboarding / first project | On a fresh data root, the first **write** to projects/tasks/goals/inbox/decisions/brain-dump 500s with raw ENOENT — the composer's very first submit fails; reads were fixed (`readOrDefault`), the six mutate helpers were not | CONFIRMED |
| P2 | CRITICAL | Workspace lifecycle | `POST /api/checkpoints/new` wipes the entire workspace instantly: no confirmation, no automatic pre-snapshot, body ignored, no engine-stopped guard (which `checkpoints/load` *does* have), and it leaves orphans — central project dirs, contracts, verification runs, deck spot-check cards all survive pointing at deleted rows | CONFIRMED |
| P3 | CRITICAL | Every store write | Store mutations in the daemon (`mutate*` in `store/data.ts`) hold only an in-process mutex — a second API process over the same store (a shape `server.ts` explicitly supports) lost **12 of 40** concurrent project creates; the daemon side also never takes the cross-process `withFileLock` that its own detached children (run-task, run-verification) rely on for tasks/inbox/decisions | CONFIRMED |
| P4 | IMPORTANT | Brief → stale-flag loop | `brief.compiledAt` is never written anywhere, so `editFlagsStale()` is always false: editing a brief **after contracts compiled** raises no stale flag and no Deck card — the pinned product default ("editing a brief after contract compilation flags dependents stale") is dead code; a *locked* brief also accepts prompt edits silently | CONFIRMED |
| P5 | IMPORTANT | Promote | Promote is not idempotent: POSTing the same reviewed preview twice lands duplicate tasks + duplicate signed contracts, both dispatchable — two builders will build the same thing into the same repo | CONFIRMED |
| P6 | IMPORTANT | Promote | The preview body is committed unvalidated (`jsonBody` + cast, no zod): an invalid criterion `kind` bypasses `assignHoldouts`' "at least one visible criterion" guarantee (observed: contract with 0 visible / 1 holdout — builder flies blind); malformed proposed journeys are dropped with only a daemon-log warn while the response reports success | CONFIRMED |
| P7 | IMPORTANT | Build retry queue | A retry scheduled for a failed run still fires after the task has since **completed**: observed the dispatcher start a builder retry and a verification run for the same task in the same tick — double-build racing the harness's snapshot, and the builder's settle path resets `verificationAttempts` to 0, undermining the D4 cap accounting | CONFIRMED |
| P8 | IMPORTANT | Runs | Interrupting an already-**finished** run returns 200 "interrupted" and rewrites history: the failed run's error ("No .ligma/boot.json…") was replaced by "Stopped by you" and `completedAt` bumped — diagnostic evidence destroyed, run now claims a human stopped it | CONFIRMED |
| P9 | IMPORTANT | Deck / spot-check loop | The verdict-spot-check card has **no server-side answer path** — "looks right" memory lives in browser localStorage (stated in `routes/deck/route.ts` header): unanswerable from CLI/API, resurrects in every other client, and an orphaned card was observed persisting for a task wiped by P2 | CONFIRMED |
| P10 | IMPORTANT | Settings → backends | Changing `claudeBinaryPath` (or any backend path) in daemon config takes effect only on full process restart: `cachedBinaries` in `runner.ts` is never invalidated by config hot-reload or `POST /api/backends/rescan` — observed `GET /api/backends` probing/reporting a *different* binary than the configured one | CONFIRMED |
| P11 | IMPORTANT | Onboarding / data hygiene | The README's only run commands go through pnpm scripts that pin `LIGMA_DATA_DIR=../../data` — every newcomer gets the dogfood pin, and the gitignore block guarding it is incomplete: `data/needs-you-pings.json` and `data/task-checkpoints.json` sit untracked-and-unignored in `git status` right now | CONFIRMED |
| P12 | IMPORTANT | Greenfield build → verify | A greenfield product repo is provisioned with no `.ligma/boot.json`; when a build ends without creating one, the run fails at the boot gate (`causeKind: env`), the task silently re-queues and re-dispatches the identical build — user signal is one "Blocked:" inbox report; terminal behavior after the retry cap was not observed | CONFIRMED (loop) / PLAUSIBLE (terminal state) |
| P13 | ADVISORY | Deck coverage | A build that failed (boot gate, backend crash) produces only an unread inbox report — the Deck, "what needs me?", stays empty; only verification-cap exhaustion earns a card | CONFIRMED |
| P14 | ADVISORY | CLI / agent ergonomics | `ligma runs tail <nonexistent-id>` exits 0 with no output — the output route's 404 carries `done: true` and the SSE stream converts it into a clean `end` frame, so no client can distinguish "no such run" from "run finished silently" | CONFIRMED |
| P15 | ADVISORY | API surface | Unknown `/api/*` paths return Express's HTML error page, not JSON — an agent probing the API gets `<!DOCTYPE html>` where every real route speaks JSON | CONFIRMED |
| P16 | ADVISORY | Deck decision loop | Answered cap-cards are consumed only on the dispatcher poll cycle: up to 5 minutes between answering a card and the task actually moving — observed 4½ minutes of "answered but nothing changed" | CONFIRMED |
| P17 | ADVISORY | Project shapes seam | `POST /api/projects/:id/designs` happily creates a Studio design (and spawns a design turn) on a **headless** project — "a headless project never sees a Studio" is enforced only client-side | CONFIRMED |
| P18 | MINOR | Adoption review | A malformed review body returns the raw multi-line zod issue dump as the `error` string — parseable but hostile compared to the talk route's structured `details` array | CONFIRMED |
| P19 | ADVISORY | Checkpoints | A checkpoint snapshots only the 8 JSON stores — not briefs, contracts, verification runs, activity log, or product repos — so restore resurrects task rows whose contracts/briefs may be gone, or vice versa; nothing in the flow says so | CONFIRMED |
| P20 | ADVISORY | Security seam | The localhost API has no auth and `express.text({type: "*/*"})` accepts any content type: a malicious web page in the user's browser can fire form/no-cors POSTs at `127.0.0.1:4477` — including the P2 wipe — without reading responses | PLAUSIBLE |
| P21 | MINOR | Engine CLI | `daemon:status` exits 0 whether the engine is running or stopped — a script cannot branch on it without parsing ANSI-colored prose | CONFIRMED |
| P22 | MINOR | Onboarding noise | Fresh install's first poll logs two dispatcher **ERROR** lines (stale-reconciliation + poll, both ENOENT) before the user has done anything — a healthy empty install announces itself as broken (same root as P1) | CONFIRMED |
| P23 | MINOR | Product repo naming | Greenfield slugs truncate mid-word (`…-with-rate-li`) — cosmetic, but it is the directory name the user lives with | CONFIRMED |

---

## 2. Process map — the task state machine as it actually runs

Built from the walk, not the docs. `(cmd)` names the owning command/route.

```
                              POST /api/briefs  (composer)
                                      │  creates project + brief(status: discovery)
                                      ▼
                     brief: discovery ──POST …/brief/answers──▶ discovery (next form)
                                      │                        └─ 502 w/ causeKind on agent failure
                                      │  PATCH …/brief {lock}      (answers already saved — retryable)
                                      ▼
                     brief: locked ── POST …/promote/preview ──▶ pending-promotion (Deck card)
                                      │                          └─ DELETE …/promote/preview = cancel
                                      │  POST …/promote  (+ ensureProductRepo for greenfield)
                                      ▼
        brief: compiled ✗ UNREACHABLE (P4 — compiledAt never written; stale-flag-on-edit dead;
                                       stale card reachable only via DRIFT_AGE_DAYS age trigger)

 TASK:
  not-started ──dispatcher poll / POST /api/tasks/:id/run──▶ in-progress
     ▲   ▲                                                       │
     │   │                                       ┌───────────────┼─────────────────┐
     │   │                                  build failed     boot gate failed   build ok + boot ok
     │   │                                  (backend)        (causeKind: env)       │
     │   │                                       │               │                  ▼
     │   └── reconcileStaleInProgressTasks ◀─────┴───────────────┘        awaiting-verification
     │        (next poll, ≤5 min; task was                                 (+ auto verification run)
     │         left lying as in-progress                                        │
     │         until then)                                                      ▼
     │        + retry queue (attempt N/cap) ── fires even if task since   verification run
     │          completed → double-build (P7)                                   │
     │                                                        ┌─────────────────┼──────────────┐
     │                                                     passed            failed          error (harness)
     │                                                        │                 │               │
     │                                                        ▼                 ▼               ▼
     │                                                      done         not-started    awaiting-verification
     │                                                 (verification-   (verification-   (attempts++, re-run
     │                                                  Status passed,   Status failed,   next poll … until cap)
     │                                                  deps unblocked)  judge feedback)        │
     │                                                                                          ▼ at cap
     │                                             DECISION CARD (verification-cap, 4 options; Deck+CLI)
     │                                                        │ consumed at next poll (≤5 min, P16)
     └───"Send back to the builder" / "Raise the cap"─────────┤
                          "Accept as is" → done(waived)  "Investigate" → stays put (parked)
  done ──POST /api/tasks/archive──▶ archived

 DEAD ENDS / UNREACHABLE:
  · spot-check card: options exist, no server-side answer route (P9) — exits only via one browser's localStorage
  · brief "compiled" state + edit-triggered stale flag: unreachable (P4)
  · finished runs: mutable via interrupt (P8) — history not append-only
  · post-P2-wipe orphans: contracts/, data/projects/<id>/, verification runs, spot-check cards
    reference rows that no longer exist; no sweeper reclaims them
```

Side processes walked: **adoption** (create → error w/ `bootDraft` fallback → retry works; review validates); **talk** (post → agent-failure produces an honest system reply naming the failure and inviting retry — a model failure path done right); **checkpoints** (create → list → load blocked while engine runs ✓ → engine stop via `POST /api/daemon` → load restores → engine start — walkable, subject to P19); **engine lifecycle** (second `start` refused with exit 1 ✓; stop/status clean; stale-PID cleanup works); **runs** (interrupt/defer exist per-run — subject to P8).

---

## 3. Gaps and errors by process

### Onboarding

**P1 — CRITICAL, CONFIRMED. The first thing the README tells a new user to do fails.**
Repro (fresh data root):
```
LIGMA_DATA_DIR=/tmp/fresh tsx src/engine/index.ts start   # apps/daemon
curl -X POST localhost:4477/api/briefs -H 'content-type: application/json' \
     -d '{"prompt":"Build a REST API that shortens URLs"}'
# → 500 {"error":"ENOENT: no such file or directory, open '…/projects.json'"}
```
`apps/daemon/src/store/data.ts:435–508`: `mutateTasks`, `mutateGoals`, `mutateProjects`, `mutateBrainDump`, `mutateInbox`, `mutateDecisions` all do a raw `readFile` and throw on a missing store — while `mutateTasksArchive`, `mutateActivityLog`, `mutateAgents`, `mutateSkillsLibrary`, `mutateActiveRuns`, `mutateDaemonConfig` (and every read, via `readOrDefault`, whose own comment records fixing exactly this class for reads) tolerate it. Stranded user: follows README, opens composer, types the prompt, gets "ENOENT" — the fix today is hand-creating six JSON files, or discovering that `POST /api/checkpoints/new` (the wipe!) happens to seed them. Note the trap interaction: the dogfood pin (P11) masks this for anyone running from this checkout, because the tracked `data/*.json` already exist — the bug bites precisely the fresh `~/.ligma/data` install the DECISIONS doc says is the real default. Direction: give the six strict mutate helpers the same `readOrDefault` fallback (one-line each), and delete the ENOENT class entirely.

**P22 — MINOR, CONFIRMED.** Same root: the very first dispatcher poll on a fresh store logs `[ERROR] Failed stale in-progress reconciliation: ENOENT` + `[ERROR] Poll error: ENOENT`. A newcomer's first daemon start opens with two ERROR lines about files nobody created yet.

**P11 — IMPORTANT, CONFIRMED. The documented run path quietly opts every user into the dogfood store.**
`apps/daemon/package.json` — every script (`dev`, `start`, `daemon:*`, `seed:demo`, …) hardcodes `LIGMA_DATA_DIR=../../data`, and README's run instructions use those scripts exclusively. So the "data root moves outside the checkout" decision (DECISIONS 2026-08-13) holds for no journey a reader can actually follow. The `.gitignore` dogfood block exists to keep that pin from turning the repo into an artifact dump, but it must be hand-maintained per store file and has already fallen behind: `git status` in this checkout shows `data/needs-you-pings.json` and `data/task-checkpoints.json` untracked and unignored (both are new engine stores: `engine/needs-you-ping.ts`, `engine/checkpoints.ts`). Stranded user: a newcomer's `git status` fills with JSON noise they didn't create; a `git add -A` commits their personal store. Direction: make the dogfood pin opt-in (e.g. `dev:dogfood`), let plain `dev` use the real default; or ignore `data/` wholesale and force-add the intentionally tracked seeds.

### Workspace lifecycle

**P2 — CRITICAL, CONFIRMED. One unguarded POST destroys everything, and the "safety" sibling has the guard this one lacks.**
Repro: `curl -X POST :4477/api/checkpoints/new -d '{"name":"audit-1"}'` → `{"ok":true}` — and projects, tasks, goals, inbox, decisions, brain-dump, skills, activity are gone, agents reset to 5 defaults. `apps/daemon/src/routes/checkpoints/new/route.ts:84–97`. Observed consequences in the walk: it ran happily **while the engine was dispatching** (whereas `checkpoints/load` correctly 409s with "Stop the daemon before restoring"); it took no automatic snapshot first (there were zero checkpoints at the time); it ignored the body I sent (I believed I was *creating a checkpoint named audit-1*); and it left orphans everywhere — `data/contracts/*.jsonl`, `data/projects/<id>/` (briefs, baselines), verification runs, and a Deck spot-check card that still displayed the wiped task's title. Stranded user: anyone or anything (a retried request, an agent exploring the API, a P20 cross-site POST) fires this once; with no checkpoint existing, there is no recovery path at all. Direction: require `{confirm: true}` at minimum; take an automatic checkpoint before wiping; add the same engine-stopped guard load has; wipe or archive the central project dirs/contracts it currently orphans.

**P19 — ADVISORY, CONFIRMED.** `checkpoints/export` shows the snapshot's full extent: `tasks, goals, projects, brainDump, inbox, decisions, agents, skillsLibrary`. Briefs, contracts, verification runs, activity, product repos are outside it. Restoring after any promote/verify activity resurrects task rows whose `contractId` chain may be gone, and leaves contracts for tasks that no longer exist. The restore flow never mentions this partiality. Direction: include the central project dirs + contracts in the snapshot, or say what a checkpoint does and doesn't cover at create/load time.

### Store integrity (every process crosses this)

**P3 — CRITICAL, CONFIRMED. Concurrent writers lose data — and the product ships two writers.**
Repro: daemon on :14747, plus the explicitly supported API-only process (`tsx src/server.ts`, "the shape the web e2e run and the CLI want") on :14749 over the same store; 40 parallel `POST /api/projects` split across both → **28 survived** (`before=11 after=39 expected=51`). `store/data.ts` guards every store with `new Mutex()` (in-process only) and `_writeJson` is a plain overwrite — no cross-process lock, no temp-file+rename. Meanwhile the daemon's own detached children (`run-task.ts`, `run-verification.ts`) write tasks/inbox/decisions/activity under `withFileLock` (`.locks/` dir, cross-process) — but the daemon's route-side `mutateTasks`/`mutateInbox`/`mutateDecisions` never take that lock, so the children's discipline is one-sided: a promote (`mutateTasks`) racing a run-task settle is an unguarded read-modify-write against a guarded one (this half traced, not reproduced). The plain overwrite also means a crash mid-write leaves a torn JSON file, after which the strict mutate helpers (P1) throw forever — a dead end fixable only by hand-editing the store. Direction: route all mutating store access through `withFileLock` + atomic rename; that one change closes the two-process loss, the daemon-vs-child race, and the torn-file dead end together.

### Brief lifecycle

**P4 — IMPORTANT, CONFIRMED. The stale-brief loop's main trigger cannot fire.**
Repro: full F1 walk (brief → lock → promote; two contracts compiled and signed), then `PATCH /api/projects/:id/brief {"prompt":"…AND custom aliases."}` → 200 with `staleFlaggedAt: null`, Deck stays empty — and note `status: "locked"` accepted the edit without friction. Root: `packages/api/src/briefs.ts:171` — `editFlagsStale = brief.compiledAt !== null` — and `compiledAt` is written exactly once in the entire codebase: to `null`, at creation (`engine/discovery.ts:89`). Neither `commitPromote` nor the contract compiler ever stamps it. The web app's only `flagStale` call is the *undo* of an acknowledge (`apps/web/src/lib/deck-actions.ts:71`), so the edit-triggered card promised by the pinned product default ("editing a brief after contract compilation flags dependents stale — Deck card") is unreachable; only the age-based drift trigger (`DRIFT_AGE_DAYS`) can raise the card. Stranded user: edits the brief after promote, correctly assumes the system will flag dependents stale, and nothing downstream ever learns the oracle moved. Direction: stamp `compiledAt` in `commitPromote` (one line, inside the same mutate that pushes tasks); decide whether a locked brief should take prompt edits at all.

### Promote

**P5 — IMPORTANT, CONFIRMED. Double-commit = double pipeline.**
Repro: `POST /api/projects/:id/promote` twice with the identical preview → two 201s, two `Scaffold API` tasks, two signed contracts, both dispatchable. `studio/promote.ts:391` checks error/emptiness/project-match but nothing about "this preview was already committed" (the `pending-promotion` record is cleared by the first commit, but nothing checks it on the second). Stranded user: the sheet's confirm times out or an agent retries a 504; two builders now race each other into one repo and two verification pipelines burn double quota. Direction: make the preview carry a nonce recorded on commit; refuse (409) a second commit of the same nonce.

**P6 — IMPORTANT, CONFIRMED. The most consequential write in the product accepts arbitrary JSON.**
`routes/projects/_id/promote/route.ts` casts `body.preview as PromotePreview` with no schema (`jsonBody` is `request.json()`); every other write route in the codebase validates with zod. Two observed consequences: (a) criteria with `kind: "behavior"` (not in `CriterionKind = "criterion" | "invariant"`) sailed through and produced a signed contract with **visibleCriteria 0 / holdoutCriteria 1** — `assignHoldouts`' explicit "at least one visible criterion always (else the builder is flying blind)" guarantee (`harness/compile-contract.ts:68–90`) only repairs `kind === "criterion"` entries, so the invalid kind bypassed it and the builder gets a contract it cannot see; (b) proposed journeys whose shape doesn't match are dropped inside a per-journey catch (`studio/promote.ts:485–505`) with only a daemon-log warn — the 201 response reports `journeyIds: []` but no error, so the sheet the user reviewed promised a journey the commit silently discarded. Direction: zod-validate `PromoteRequest` at the route; surface per-journey write failures in the response (`journeysDropped: [...]`).

### Build / retry

**P7 — IMPORTANT, CONFIRMED (from the daemon's own log, one tick):**
```
02:00:00 Starting verification run for task_5bx… (7 session(s) admitted)
02:00:00 Retrying task task_5bx… (attempt 2, agent=builder)
```
The retry entry was queued when the task's first run failed the boot gate; before it came due, a second manual run completed and settled the task `awaiting-verification`. The due retry fired anyway — a builder rebuilding a task the harness was concurrently snapshotting (`captureChanges`/env worktree racing a live builder in the same repo), and the builder settle path (`harness/verdict.ts:239`) reset `verificationAttempts` to 0, wiping the cap bookkeeping the verification side had accrued. Stranded user: none visibly — which is the problem; quota burns and the D4 cap silently restarts. Direction: on settle (any terminal state), drop the task's pending retry entries; and have the retry dispatcher re-check `kanban === "not-started"` at fire time.

**P12 — IMPORTANT, CONFIRMED (loop) / PLAUSIBLE (terminal).** Greenfield provisioning (`store/product-repo.ts`) creates README + git only; `.ligma/boot.json` is delegated to the builder prompt (`prompt-builder.ts:417`). When the build ends without one, the run fails `causeKind: env`, `reportBootGate` files one inbox report ("Blocked: …"), the reconciler returns the task to `not-started`, and the identical build re-dispatches on the retry schedule. With a builder that consistently fails to write the recipe (weak model, artifact-shaped project it doesn't understand), the loop is signal-poor: no Deck card (P13), no env-preflight linkage, and the terminal state after the retry cap was not reached in this walk (open question §5). Direction: seed greenfield repos with a valid stub `boot.json` at provisioning (the planner already knows the shape), so the gate can only fail on *regression*, not on absence.

### Runs

**P8 — IMPORTANT, CONFIRMED. Finished runs are mutable.**
Repro: `POST /api/runs/run_1787795551343/interrupt` where that run had `status: "failed"`, `completedAt` set, `error: "No .ligma/boot.json…"` → 200 `{"status":"interrupted"}`; the row now reads `error: "Stopped by you"` with a new `completedAt`. The route's own intent ("the row reads 'stopped by you', not 'a run malfunctioned'") inverts here: a run that malfunctioned now claims the human stopped it, and the original failure cause — the only pointer to the boot-gate problem — is gone. (A truly unknown id 404s correctly, so the finished-run check in `stopRun` treats `failed` as stoppable.) Direction: `stopRun` should treat any `completedAt`-bearing run as finished → 404/409.

### Deck / decisions

**P9 — IMPORTANT, CONFIRMED.** Spot-check cards (`deck-cards.ts:262`, options "Looks right"/"The judge got this wrong") have no server-side answer: `routes/deck/route.ts:20` states the review memory "lives in the browser's localStorage". So the card is unanswerable via API/CLI (the D4 story "everything answerable from Deck cards alone" holds only inside one specific browser profile), reappears in every other client, and survives the deletion of its task (observed post-P2: card titled with a wiped task's name, its `href` pointing at a verification run whose task row no longer exists). Direction: persist spot-check reviews server-side (a `reviewedSpotChecks` store or a decision row), and drop cards whose task/run rows are gone.

**P16 — ADVISORY, CONFIRMED.** The full cap-card loop *does* close — `ligma decisions answer <id> "Send back to the builder"` moved the task to `not-started`, attempts 0 — but only at the next dispatcher poll (`consumeAnsweredCapCards` is poll-cycle-only): observed 4½ minutes of "answered, nothing moved". A user who answers and watches sees a card flip to answered and a task that doesn't move; nothing says "takes effect at the next cycle". Direction: consume answered cap-cards in the decisions-answer write path (or immediately after answer), keeping the poll as backstop.

**P13 — ADVISORY, CONFIRMED.** Deck card kinds are decision, design-approval, promote-pending, stale-brief, adoption-review, verdict-spot-check. A failed build (boot gate or backend) produces only an inbox report. During the walk, a blocked greenfield build left the Deck empty while "What needs me?" had an obvious answer. The needs-you ping engine likewise pings only the four blocking kinds. Direction: a `run-blocked` card kind (or fold `causeKind: env` failures into env-preflight's recovery surface).

### Settings / backends

**P10 — IMPORTANT, CONFIRMED.** Sequence: daemon started with no configured paths → `runner.ts` cached `/opt/homebrew/bin/claude`; wrote `claudeBinaryPath` into daemon-config (the Settings card's mechanism); `GET /api/backends` then reported `path: /opt/homebrew/bin/claude, version: 2.1.247` alongside `configuredPath: <shim>` — probe and future spawns still using the *cached* binary, `probedAt` post-change. `POST /api/backends/rescan` clears only the probe cache (`probeAllBackends(true)`), never `cachedBinaries` (`runner.ts:41`, cleared only on ENOENT at spawn, `:680`); config hot-reload (`lifecycle.ts:167–185`) reloads scheduler config but not the binary cache. Stranded user: points ligma at a different CLI build (or moves their install), Settings says saved, rescan says available — and every spawn still uses the old binary until a full daemon restart nothing tells them to do. Direction: `rescan` (and config hot-reload on path-field change) must clear `cachedBinaries`.

### Agent ergonomics

**P14 — ADVISORY, CONFIRMED.** `ligma runs tail run_bogus` → exit 0, zero output. Chain: `runs/_id/output/route.ts:52` returns 404 **with `done: true`** for a missing output file; the SSE wrapper (`stream.ts:46`) checks only `chunk.done` — the 404 status and `error` field are erased into a normal `end` frame; the CLI exits clean. An agent scripting `ligma runs tail $id && next-step` proceeds on a typo'd id. Direction: stream an `error` frame (and CLI exit ≠ 0) when the poll route returns non-2xx.

**P15 — ADVISORY, CONFIRMED.** `POST /api/talk` (a plausible guess for the talk route, which actually lives at `/api/projects/:id/talk`) → Express HTML error page. Every unknown `/api/*` path should fall through to a JSON 404 handler.

**P18 — MINOR, CONFIRMED.** `POST /api/adoption/:id/review` with a wrong-shaped body → the `error` field is a raw pretty-printed zod issue array as one string. The talk route shows the house style (`{error, details:[{path,message}]}`); adoption review should match.

**P21 — MINOR, CONFIRMED (code).** `engine/index.ts handleStatus()` prints Running/Stopped but always exits 0. `handleStop` on a not-running daemon also exits 0. Scripts get no exit-code signal; direction: exit 1 (or 3, LSB-style) when stopped.

### Shape seams

**P17 — ADVISORY, CONFIRMED.** With `project.shape: "headless"` set by discovery, `POST /api/projects/:id/designs {"prompt":"landing page"}` → 201, design created, design turn spawned. The shape rule ("headless projects never see a Studio") lives only in web navigation. An agent, the MCP surface, or a stray client can attach Studio state (and burn governor spawns) on projects whose pipeline will never surface it. Direction: the designs route should 409 on shapes whose pipeline excludes a design stage (with an explicit override if "opt-in design stage" is intended to be togglable).

### Security seam

**P20 — ADVISORY, PLAUSIBLE (not exercised).** `server.ts`: bind 127.0.0.1 (good), no auth token, `express.text({ type: "*/*" })` — so a hostile web page can fire `fetch("http://127.0.0.1:4477/api/checkpoints/new", {method:"POST", mode:"no-cors"})` or an auto-submitting form; the response is unreadable cross-origin but the side effect (P2's wipe, promote, task runs) doesn't need reading. Browser Private-Network-Access is narrowing this class but is not a contract. Direction: a per-install bearer token in `~/.ligma` that web/CLI read and send; or at minimum require `content-type: application/json` (form posts can't send it) on mutating routes.

---

## 4. Missing-process backlog

Prioritized by unblocking value; each row is the command/flag/behavior a documented journey needs to complete end-to-end.

| # | Needed | Completes which journey | Notes |
|---|--------|------------------------|-------|
| 1 | Store bootstrap on first write (fix P1) — or an explicit `init` the README can name | README onboarding → first project | One-line fallback ×6 in `store/data.ts`; kills P22 too |
| 2 | Cross-process locking + atomic writes in `store/data.ts` (fix P3) | Every journey that writes while anything else runs | `withFileLock` exists and is proven; the daemon just doesn't use it |
| 3 | `compiledAt` stamped at promote (fix P4) | Brief-edit → stale-flag → Deck card → acknowledge/undo loop | The consuming side (card, acknowledge, undo, snooze) is all built and waiting |
| 4 | Confirmation + auto-snapshot + engine-guard on workspace wipe (fix P2) | Workspace reset without data loss | Also: sweep orphaned contracts/central dirs/spot-check cards after wipe or project hard-delete |
| 5 | Server-side spot-check answer (fix P9) | D4 daily loop from any client, incl. CLI/agents | Card kind exists, options exist, evidence exists — only the answer write is missing |
| 6 | Promote idempotency nonce + zod validation of `PromoteRequest` (fix P5/P6) | Promote under retries/agents | Also surface dropped journeys in the response |
| 7 | Retry-queue invalidation on task settle (fix P7) | Build → verify without double-builds | Plus fire-time kanban re-check |
| 8 | Finished-run immutability in `stopRun` (fix P8) | Runs surface as trustworthy evidence | `completedAt` set ⇒ 409 |
| 9 | `cachedBinaries` invalidation on rescan/config change (fix P10) | Settings → backend switch without restart | Rescan route + hot-reload hook |
| 10 | Seed `.ligma/boot.json` at greenfield provisioning (fix P12) | D1 headless greenfield without builder-dependent boot | Planner already knows shape; artifact recipe is 5 fields |
| 11 | JSON 404 fallback under `/api/*`, SSE/CLI error frames for missing runs, zod-style errors on adoption review, non-zero `status` exit when stopped (P14/P15/P18/P21) | Agent-driven operation of every flow | Small, mechanical |
| 12 | `run-blocked` Deck card or env-preflight linkage for `causeKind: env` failures (P13) | "What needs me?" completeness | The inbox report exists; it just isn't a card |
| 13 | Shape guard on designs route (P17); auth/content-type hardening (P20); checkpoint scope disclosure or widening (P19); untracked-store gitignore repair + opt-in dogfood pin (P11) | Hygiene of the seams above | — |

---

## 5. Open questions (maintainer-only)

1. **P12 terminal state:** after a task exhausts the *builder* retry cap (attempt 2/2 — distinct from the verification cap, which has its decision card), what is the intended resting state and its surface? The walk saw the cap approached but the second attempt succeeded (boot.json supplied); code suggests the task simply stays `not-started` with an inbox report — is a Deck card intended here?
2. **Locked-brief edits (P4's second half):** is a `locked` brief accepting `prompt` PATCHes intended (the lock only gates re-discovery), or should lock freeze the text until an explicit amend (`brief/amend` exists — is it meant to be the only post-lock write path)?
3. **`checkpoints/new` naming:** is this endpoint meant to be "new workspace" (as implemented) or "new checkpoint" (as its URL reads)? The web UI presumably frames it correctly, but the API surface will keep collecting P2-class accidents while a wipe lives under `checkpoints/*` and the create lives at bare `POST /api/checkpoints`.
4. **Two-API-process topology (P3):** `server.ts`'s header endorses running the API alone alongside a hand-started daemon (`reuseExistingServer`). Is that combination meant to be safe for *writes*, or e2e-read-only? If the latter, a `--read-only` flag would make the contract enforceable.
5. **Spot-check memory (P9):** was localStorage a deliberate "this signal is disposable" call, or a port shortcut? The card asks the user to audit the judge — if the answer never reaches the daemon, the 1-in-10 sample can't feed anything (calibration, judge trust metrics) later.

---

*Audit artifacts (throwaway store, shim logs, daemon logs) live under the session scratchpad (`…/scratchpad/paudit/`) and are disposable; nothing in the repo or the real `~/.ligma`/`data/` stores was mutated. The two pre-existing untracked files named in P11 were present before this audit began (see the session's opening `git status`).*
