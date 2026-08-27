# Harvest memo — mining the three mission-controls

Written before Phase 2, per the brief. Sources: full clones of `MeisnerDan/mission-control`
(upstream), `builderz-labs/mission-control` (120,488 measured LOC in `src/`, SQLite), and
`crshdn/mission-control` ("Autensa", Next 14 + SQLite + OpenClaw gateway). Every claim below was
verified against the actual code by a dedicated reader, not READMEs. File paths refer to the
respective repos.

**Upstream first, briefly:** nothing to harvest. Confirmed by grep and full log sweep — upstream has
zero verification, acceptance-criteria enforcement, sandboxing, or browser-testing work, at or after
v0.9.0. Its direction is "agents acting on real-world accounts" (Field-Ops/Ventures), not rigor. Two
trivial off-mission cherry-picks if you want them: `6ffee06` (inbox text-selection fix), `49ced36`
(inbox Forward button); `b6224c2` (Mark Reviewed) conflicts with our local task-detail-panel changes.

---

## 1. Things worth stealing that you did not list

### From builderz-labs

1. **`src/lib/runs.ts` — the Agent Run Protocol schema.** `Provenance.run_hash =
   sha256(agent | model | sorted tools | config_hash | trigger)` is the *identity of a test
   configuration*; `EvalResult.benchmark_id` (frozen case set) and `regression_from` (pointer to the
   run this regressed against) are the two fields their own drift detection lacks and the reason it
   can't answer "is the harness degrading?". `getLeaderboard({benchmarkId})` = "which grader config
   performs best on the frozen set". This is the grade-the-grader primitive; the schema ports to
   JSON files nearly unchanged. (Caveat: in their repo it's half-wired — spawn history writes empty
   run hashes. Take the schema, not the usage.)

2. **`src/lib/atomic-file.ts`** *(you listed it — confirming with emphasis: highest-confidence steal
   in either repo)*: `mkdir`-based cross-process lock **with stale-PID reaping** (`process.kill(pid,0)`,
   reap on ESRCH) + `fsync`-before-`rename` atomic replace. Our `async-mutex` only protects one
   process; the moment the daemon and Next server both write (Phase 1), we need this. 110 lines, `node:fs` only.

3. **`scripts/e2e-openclaw/start-e2e-server.mjs` — Phase 1 nearly verbatim.** `findAvailablePort()`
   via `net.listen(0)` (ask the OS, no registry — contrast crshdn's racy DB allocator); wipe-and-seed
   from a fixture tree; env redirection of *every* state path into the runtime root; PATH-shadowing
   stub binaries to fake external CLIs without a mocking framework; teardown that kills the whole
   process tree on SIGINT/SIGTERM/child-exit. Health check delegated to a URL poll.

4. **`src/lib/task-dispatch.ts` — two mechanisms:** the atomic compare-and-swap work claim
   (`UPDATE … WHERE status='assigned'`, `changes === 0` → lost the race, exit silently) and
   `resolveCliSandboxOptions()`'s fail-closed validators — notably `filterCliAllowedTools()` returns
   `null` when nothing survives the allowlist *because omitting the flag is the more restrictive
   default*, and `resolveCliDispatchCwd()` realpaths both sides before the containment check.

5. **`src/lib/receipt-signing.ts` — evidence integrity in 148 lines of `node:crypto`.** Ed25519 over
   canonicalized (recursively key-sorted) JSON. Sign the frozen criteria file and each verdict at
   write time; a verdict you can't prove wasn't edited after the fact isn't evidence. Signing failure
   is non-fatal (the record still logs) — the right stance for an observer.

6. **`src/app/api/tasks/regression/route.ts` — the comparator to copy** (instead of their
   `checkDrift`, see §2): equal-duration windows enforced, nearest-rank p95, empty window → `null`
   not a passing 1.0, `metric_definitions` spelled out in the response, and **`intervention_rate`**
   ("how often did a human have to touch it") — the single best harness-quality metric because a
   lenient grader can't game it.

7. **`src/app/api/workload/route.ts` — the backpressure ladder** for Phase 3: four levels
   (normal/throttle/shed/pause), `escalate()` = max over independent signals, `suggested_delay_ms`
   per level, `_confidence` field instead of a faked estimate. Their limitation is our lesson: it's
   advisory and nothing reads it — **our governor must be a gate on the dispatch path, not an
   endpoint we hope callers poll.**

8. **`src/lib/agent-runtimes.ts:262` — `RUNTIME_CAPABILITIES` manifest.** Static table of what each
   runtime can *honestly* do, every `true` citing a shipping code path, with `receipts:
   {diff, tests, artifact, browser, telemetry}` as first-class. The honest alternative to their
   `adapters/` (see §2). Our `TargetAdapter` should carry exactly this shape — it's what stops us
   claiming evidence a backend can't produce (they mark `browser: false` everywhere; they knew).

9. **`src/lib/provider-subscriptions.ts` + the one branch in `token-pricing.ts` that matters:**
   marginal cost is **$0 when the provider is on a subscription — because a Max plan has no dollar
   cost, it has a quota.** Detection reads `~/.claude/.credentials.json → subscriptionType` with a
   `claude auth status` fallback. This cost-vs-quota distinction is the axis Phase 3 lives on.
   (Their substring model-matching fallback is a bug generator; use an explicit alias table à la
   their `models.ts` `MODEL_CATALOG`.)

10. **`src/lib/transcript-parser.ts`** — JSONL → typed message parts with per-field truncation caps
    already tuned (text 8k, thinking 4k, tool input 500). Exactly what keeps a judge prompt from
    blowing up when it reads a persona agent's browser session.

### From crshdn

11. **`src/lib/task-dispatch-context.ts` — the budgeted prompt assembler with an audit record.**
    15 declarative sections, per-section char budgets, role gating, and two gems: `clipText`
    truncates the *middle* (head+tail survive, loss stated inline), and every build emits a
    persisted `DispatchContextAudit` — which sections were included, truncated, how many chars.
    When a persona gives a wrong verdict, we can prove which context it actually received and
    whether the criteria got clipped. For a black-box harness that's the difference between an
    evidence trail and an anecdote.

12. **`src/lib/agent-health.ts` — liveness as a union of durable side-effects.** Max over activity
    rows, deliverables, checkpoints, task updates, session updates — then bucketed, with stored
    state split from a richer `display_state` (`working_silently`: "normal for long autonomous
    builds") so slow ≠ dead. Names the failure modes everyone misses: `zombie` (task active, no
    session exists) and `completed_not_surfaced` (agent finished, transport dropped it). And the
    single most reusable line in the repo — **nudge success verified by side-effect, not HTTP
    status**: dispatch returned 200 *and* a replacement session row exists, else it failed.

13. **`src/lib/autopilot/recovery.ts` — resume from the last durable phase.** Long operations
    persist `current_phase` + `phase_data` + heartbeat every step; on startup, work already past the
    expensive step completes from stored data without replaying it. Phase 1's lifecycle
    (clone → install → seed → boot → health → test → teardown) needs exactly this so a crash after a
    4-minute install doesn't redo the install.

14. **`src/lib/skills.ts` — Bayesian confidence that earns and loses trust.**
    `(succeeded + 0.5·2)/(used + 2)`: one lucky hit doesn't promote (1/1 → 0.60), sustained failure
    demotes (auto-deprecate at ≥3 uses & <0.3). Phase 2 wants this machinery for persona playbooks
    and re-verification priorities: a test recipe that keeps being wrong should demote itself.

15. **`src/lib/task-flight-recorder.ts`** *(you listed it — the verdict is STEAL, and here's the
    why)*: `computeGaps()` makes **absences first-class objects** (≥10 min holes become
    `{start, end, minutes, reason}` rows, with the monitor's own noise excluded so it can't paper
    over a gap), and it synthesizes diagnostic events for things that *didn't* happen ("chat reply
    was not surfaced"). Also steal `parseTimestampMs` verbatim — the correct fix for zoneless SQLite
    timestamps being read as local time; their repo applies it in exactly one file and has the bug
    everywhere else.

16. **`src/lib/repo-preflight.ts` + `src/lib/repo-readiness.ts` — checks that carry their own fix as
    data.** Preflight: `git ls-remote --symref` to learn the real default branch *before* creating
    anything (three port-time fixes needed: redact stderr, `GIT_TERMINAL_PROMPT=0`, `--` separator).
    Readiness: each failing check emits `actions: [{kind: 'set_actions_enabled_all', …}]` from a
    **closed set of kinds** that the fix endpoint executes and re-scans — the safe inverse of
    "exec whatever the LLM suggested" (see §2 on `environment-command-suggestion`). Port this shape
    for env preflight: node version, pnpm present, `.env.example` satisfied, port free, seedable.

17. **Failure fingerprinting** (buried in their environment-fix route): `sha256(normalizeFailureText(…))
    .slice(0,16)` where normalization scrubs timestamps/UUIDs/hex/pids so the same error hashes
    identically across runs — the "don't loop on the same failing remediation" primitive. Their
    surrounding generation logic is buggy; the fingerprint idea is the keeper.

18. **`bootstrap-agents.ts` + `browser-test-context.ts` — the persona prompt kit.** Two lines going
    into our judge persona verbatim: *"A false pass wastes far more time than a false fail … Never
    rubber-stamp."* and *"Never fix issues yourself — that's the Builder's job."* Their tester
    context (frozen spec under "What Was Supposed to Be Built", deliverables, checklist, verdict
    contract demanding specific evidence) is the Phase 2 prompt skeleton — what they never built is
    the harness underneath it.

19. **`src/lib/autopilot/ab-testing.ts` — the confidence tier ladder.** No chi-squared below n=5, no
    winner named below the data floor, and results labeled `raw | ci | significance` so you always
    know *which tier of evidence* you're looking at. ~40 portable lines. This is the discipline for
    iterating persona prompts and for reporting persona variance honestly (§5.7 of the brief).

20. **`docs/symphony-reliability-spec.md`** — their own unimplemented design doc naming, with
    file-level precision, the reliability holes (atomic dispatch locks, retry backoff schedule,
    a 30s reconciler loop). Free prior art to read before we extend our dispatcher.

### Deliberately not stolen, with one-line reasons

`secret-scanner.ts` (STEAL — one redaction pass on the evidence write path; our output-writer already
scrubs credentials, this extends coverage), `injection-guard.ts` normalizer-only (~120 dep-free lines
to sanitize product-page text before a judge reads persona transcripts), `use-smart-poll`
(visibility-aware polling for the env status board), `paths.ts resolveWithin`, event-bus
`globalThis` HMR trick — all small, all earn their place when their consumer exists; listed so they
don't get re-discovered expensively later.

---

## 2. Things you listed that are wrong

1. **"Port `workspace-isolation.ts`" — it is not an environment manager.** 802 lines that lease a
   worktree and a port number, and *nothing more*. No install, no seed, no boot, no health check;
   grep the whole repo — the allocated port is read in exactly one place, to build the tester's
   "Dev Server URL"… **which nothing ever binds.** Their tester browses a port no process listens on
   (fallback `localhost:3000` isn't even their app's port). Plus three defects not to inherit: the
   port allocator is check-then-insert with no transaction, no UNIQUE constraint, and never asks the
   OS; the merge lock is an in-process `Map` (safe only because pm2 pins one instance); filesystem
   paths and branch names derive from the *mutable task title* (rename a task and it operates on a
   different directory; `execSync` string-interpolates that title through a shell). I'm taking the
   *shape* (strategy selection from live sibling contention, `.mc-workspace.json` marker,
   worktree-with-branch-retry, the redacted clone-failure probe) and rewriting the rest. **Phase 1
   is net-new work, which the plan should price in.**

2. **`convoy.ts` is not "DAG parallel execution" — it's broken CRUD.** The AI-decomposition path
   emits index refs (`"subtask-0"`) that `createConvoy` never resolves to real IDs, so **any
   AI-generated subtask with a dependency is permanently undispatchable** — it compares
   `"subtask-0"` to UUIDs forever. Two contradictory definitions of "failed", both keyed off
   free-text `status_reason`. The 30-line dependency gate (`deps.every(id => doneIds.has(id))`) is
   the only idea, and we already have `blockedBy` semantics for it.

3. **`checkpoint.ts` + `rollback.ts` — half right.** Checkpoint: yes, steal (40 real lines; the
   clever bit is checkpoint-writes double as heartbeats). Rollback: **the revert does not revert.**
   First attempt sends `head: "<sha>~1"` to GitHub's merge API — git syntax the API can't resolve,
   422s every time; the fallback opens a PR from a branch strictly *behind* main — a zero-diff PR —
   and then records `revert_pr_status='merged'`. Any 4xx from a health endpoint (including a 401)
   triggers "rollback". Monitors are module-level `setTimeout`s lost on restart. Take only the
   "N consecutive health failures → act, demote automation tier" idea.

4. **`similarity.ts` is not semantic dedup.** It's a 256-bucket lexical feature hash — "dark mode"
   vs "night theme" ≈ 0.0 — with a self-admitted collision noise floor of 0.2–0.4, an auto-suppress
   threshold (0.90) their own tests can't reach, and embeddings that are never refreshed on edit.
   `maybe-pool.ts` is similarly broken in the details (resurfaced clones are invisible to dedup
   forever; originals stuck at `status='maybe'` permanently). When we need dedup, real embeddings
   are table stakes; neither file saves us any work.

5. **builderz's "4-layer eval with drift detection" is, as shipped, a 2-layer eval nothing reads.**
   Layers 2 and 3 read `mcp_call_log`, which has **zero writers** in the repo — and every empty
   window degrades to a *passing* 1.0, so a silent agent scores perfect and drift over an empty
   baseline is 0. The baseline is a rolling trailing window, never frozen. And no scheduler job,
   dispatch decision, or retry ever reads a score — it's a telemetry panel, not a control loop.
   What transfers: the human `feedback_rating` anchor, append-only `quality_reviews` rows, and the
   `benchmark_id` idea from `runs.ts`. What doesn't: `checkDrift` itself, the `:1.0` fallbacks, the
   symmetric |delta|. **Their honest answer to "how do I know the harness isn't degrading" is: they
   don't.** Nothing in either repo grades the grader.

   *(Also: `adapters/` is six byte-identical classes with zero framework-specific code — the
   RUNTIME_CAPABILITIES table is the version of that idea that earns its place. The builderz
   "knowledge graph" does not exist — it's a file-tree visualization. `schedule-parser` is a regex
   NL parser whose hand-rolled cron matcher silently ignores day-of-month. `prompt-improver` is
   write-only — its output is displayed and never re-injected. `health-score` can score >100 and
   awards perfect cost-efficiency when cost tracking is unwired — which, in their repo, it always
   is: every producer writes `cost_usd: 0`.)*

6. **One correction to your §3.2 diagnosis of *our* repo:** it was stale when written —
   `prompt-builder.ts:146` already injects `acceptanceCriteria` into the builder prompt (landed in
   one of the recent local commits). The surviving defect is narrower and worse: the criteria are
   *advice to the builder, checked by no one* — and they're injected at 100%, which leaks the whole
   oracle to the builder and forecloses the §5.4 holdout. Phase 2 changes that injection to the
   visible slice.

---

## 3. Ideas that are mine

*(Not in any of the four codebases, and distinct from the directions you sketched.)*

### 3.1 Blind spec reconstruction
Before the Spec Auditor walks the contract, one fresh agent gets ONLY the running URL — no contract,
no repo — and writes down what it believes the product does, what the main flows are, and how it
figured that out. Diff the reconstruction against the actual contract. Criteria the blind agent never
discovered are **discoverability failures**: the feature may work, but a person who wasn't told it
exists can't find it. No charter in your §6 panel catches this — the Naive User is handed a goal, the
Spec Auditor is handed the answers. One cheap run, one comparable number (% of contract
reconstructed), and its transcript is a usability report written by the failure itself.

### 3.2 Verification decay: the churn-weighted re-verification lottery
"Passed" is a timestamp, not a state. Every harness pass records the git tree hash and the file
footprint the task's build touched. Each daemon cycle allocates a small re-verification budget by
lottery, weighted by (a) churn that has since landed in files overlapping that footprint and (b) age
since last verification. Old passes over hot code decay to "passed — stale" and re-enter the queue;
passes over untouched code stay cheap. This replaces the Regression Prober's "re-run everything"
with an economic model (and it's what your §7 "spend budget where uncertainty is highest" instinct
looks like applied to *time* instead of criteria). A green tick six weeks and 40 commits old is not
the same green tick, and the dashboard should say so.

### 3.3 Criterion ↔ conversation provenance
Each compiled criterion stores a pointer to the exact exchange in the planning conversation that
produced it (message id + quote). When the judge fails a criterion, the decision card shows the
verdict, the artifact, **and what you said that created the criterion**. Disputes resolve against
the source ("that's not what I meant" → criterion edit via the existing approval escalation), and
contract drift becomes auditable instead of archaeological. Cost: one string field per criterion at
compile time. This composes with `receipt-signing` (§1.5): the signed thing includes its own
justification.

### 3.4 Counter-criteria: the contract's other half
Compile the planning conversation into two lists: what the product must do, and what it must **never**
do (lose typed input, double-charge, show another session's data). The Saboteur currently improvises;
counter-criteria give it a target list, and give the judge grounds to fail a build for violating an
invariant no positive criterion covers. Invariants are also the natural survivors across contract
versions — they almost never change, so they're the cheapest regression set we'll ever own.

---

## 4. What I would cut

1. **Regression Prober as a separate charter** — it's the Spec Auditor pointed at historical
   contracts; the §3.2 lottery decides *what* it re-checks. Fold it.
2. **Accessibility Auditor as a separate charter (v1)** — keyboard traversal, focus order, labels,
   contrast fold into the Visual Critic's rubric, with axe-core as a library call, not an agent.
   Split it out when the rubric outgrows one report.
3. **TargetAdapter `cli`/`api` stubs as files** — the interface + `web`, and two comment lines.
   A stub file is a promise nobody scheduled; the RUNTIME_CAPABILITIES-style manifest (§1.8) makes
   "not supported yet" explicit without scaffolding.
4. **Contract versioning workflow** — v1 is an append-only JSONL of signed contract versions plus
   the existing decision-card escalation for edits. No diff UI, no merge tooling.
5. **"Budget remaining" as UI investment** — a field in daemon-status.json and a badge on /daemon.
   The governor's enforcement matters; its dashboard doesn't (yet).
6. **Video recording as the default evidence format** — Playwright *traces* (step screenshots, DOM,
   network, console — scrubbable in a viewer) are cheaper and more inspectable than mp4 for every
   charter except the Naive User, where watching hesitation is the point. Traces by default, video
   for personas only. This also keeps the evidence locker within the existing 72h-prune discipline.
7. **Multi-backend generality in Phase 1** — the ephemeral-env lifecycle should assume
   pnpm + Next.js (our world) with the assumptions *named* in a manifest, not abstracted over.
   Generalize when a second real product type shows up.

**On SQLite** (you asked for the argument rather than initiative): JSON files stay the source of
truth for all state — that property is load-bearing for "agents read state off disk". The one place
a database earns a seat later is a **derived, rebuildable index** over evidence artifacts and persona
transcripts (builderz's FTS5 `memory-search` pattern) once there are hundreds of runs to search.
Derived + rebuildable = agents still read truth from JSON; deleting the index loses nothing. Not
needed for Phases 0–3; flagged so it isn't a surprise.

---

## 5. What this changes about the §6 plan

- **Phase 1 is bigger than the brief assumed** (workspace-isolation.ts is a leaser, not a manager —
  §2.1) and **Phase 2's panel is smaller** (two charters folded — §4.1, §4.2). Net scope ≈ constant.
- The judge gains three hard invariants borrowed from watching two other teams fail: **different
  model/config than the builder as an enforced invariant, not a fallback chain** (builderz's Aegis
  falls back to grading with the builder's own config); **structured-output verdicts, never
  regex-parsed prose** (their `VERDICT: APPROVED` regex + a string-prefix mismatch silently killed
  their entire rejection-feedback loop — three identical retries, then fail, no test caught it);
  **the judge reads evidence, never the builder's self-report**.
- Phase 3 confirmed greenfield in both repos (crshdn: every cost event is `cost_usd: 0`, caps polled
  by the UI and never checked pre-flight; builderz: per-invocation CLI flag, no windows, no reserve).
  The governor gates the dispatch path; `workload`'s ladder + `provider-subscriptions`' quota-vs-cost
  distinction are the two imports.
- Every stolen mechanism lands with its named source and its known bugs fixed at port time (each
  item above lists them), and non-trivial ports get a test — two of the three repos taught us what
  untested feedback paths cost.
