# Ligma Codebase Audit — 2026-08-27

Adversarial, whole-repo audit performed across six lenses in parallel (daemon
engine/harness, daemon routes/store/studio, web app, shared packages,
desktop/CLI/scripts, docs/DX/content-trees), each read in full rather than
sampled. Findings the lead re-verified against source are marked **[re-verified]**.

Severity scale: **CRITICAL** (data loss, silent total-feature death, security
boundary breach) / **IMPORTANT** (feature broken or unsafe on a real path) /
**ADVISORY** (correctness/coherence gap with a workaround) / **MINOR** (cosmetic,
dead code, doc nit).

Finding IDs are stable and prefixed by area: **E**=engine/harness,
**R**=routes/store/studio, **W**=web, **P**=packages, **D**=desktop/CLI/scripts,
**X**=docs/DX. A fixing agent cites these IDs.

---

## 1. Summary

### Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 6 |
| IMPORTANT | 34 |
| ADVISORY | 33 |
| MINOR | 33 |
| **Total** | **106** |

### Counts by area

| Area | CRITICAL | IMPORTANT | ADVISORY | MINOR |
|---|---|---|---|---|
| Engine/harness (E) | 2 | 10 | 8 | 4 |
| Routes/store/studio (R) | 1 | 2 | 2 | 5 |
| Web (W) | 3 | 9 | 11 | 7 |
| Packages (P) | 0 | 6 | 15 | 13 |
| Desktop/CLI/scripts (D) | 0 | 8 | 6 | 8 |
| Docs/DX (X) | 2 | 6 | 5 | 10 |

### Top findings (read these first)

1. **E1 — Fresh install never dispatches anything.** On a default `~/.ligma/data`
   install, `decisions.json` is not seeded, `readJSON` throws on the missing file
   inside the dispatch filter, the dispatcher's catch swallows it, and **all
   dispatch and verification silently die every cycle** until something else
   creates the file. CRITICAL, CONFIRMED, [re-verified].

2. **R1 — Cross-process lost writes on every core store.** HTTP routes serialize
   `tasks.json`/`active-runs.json`/`inbox.json`/`decisions.json` with an in-process
   `async-mutex`; the engine (including *detached* child processes) serializes the
   same files with a `mkdir` file-lock; `run-task.ts` writes `active-runs.json`
   with *no lock at all*. The three regimes never exclude each other — last
   whole-file writer wins, silently dropping the other's change under the daemon's
   own documented concurrency model. CRITICAL, CONFIRMED, [re-verified]. (E3/E5 are
   the engine-side symptoms of the same root cause.)

3. **W1 — The decision-gate dialog is dead wire.** Daemon returns
   `pendingDecisions` (plural array); web reads `pendingDecision` (singular). A user
   clicking Run on a task parked behind an unanswered decision gets a raw error
   toast; the entire DecisionDialog re-run flow never fires. CRITICAL, CONFIRMED,
   [re-verified].

4. **W2 — Undo offered on data that was hard-deleted.** The delete toast always
   offers Undo (a PUT with `deletedAt:null`), but brain-dump entries, inbox
   messages, and decisions are hard-deleted server-side and their schemas don't even
   accept `deletedAt`. "Deleted [Undo]" → click → "Failed to restore" → data gone
   forever. CRITICAL, CONFIRMED, [re-verified].

5. **E2 — Self-verification always fails.** The dogfood boot adapter hardcodes
   `<worktree>/mission-control` and boots `next dev` there, but that directory no
   longer exists post-rebrand (now `apps/web`+`apps/daemon`). Every ligma-self
   verification fails at install, burns an attempt, parks the task at the cap.
   CRITICAL, CONFIRMED, [re-verified].

6. **X1 — README lies about `data/`; live daemon state is git-tracked.** README says
   "`data/` is gitignored"; `git ls-files data` returns 13 live-mutated store files,
   and new stores (`needs-you-pings.json`, `task-checkpoints.json`) land untracked
   and get swept into the next `git add -A`. Any `-a` commit commits daemon runtime
   state. CRITICAL, CONFIRMED, [re-verified].

---

## 2. System map

**What Ligma is.** A local-first, single-user "app factory." You describe a
project; a daemon runs discovery, dispatches AI agent sessions (Claude Code /
Codex / Gemini CLIs) to build it, then dispatches a persona panel + a
different-model judge to *verify* it; a Next.js web app is the cockpit. Everything
persists as JSON on disk under `LIGMA_DATA_DIR` (default `~/.ligma/data`; the
dogfood checkout pins it to `<repo>/data`). Binds `127.0.0.1:4477` only, no auth,
no cloud.

**Processes and how they coordinate.** Five process kinds — the daemon (HTTP API +
dispatcher loop in one process, `engine/index.ts`→`lifecycle.startEngine`), and
detached children spawned per job: `run-task.ts` (standalone builder),
`run-verification.ts`, `run-journey.ts`, adoption. They coordinate almost entirely
through ~15 JSON files. **This is the structural fault line**: some files are
locked with an in-process mutex (routes), some with a cross-process mkdir lock
(engine), some not at all (`active-runs.json` in run-task), some written
atomically (memory/references/studio stores use temp+rename), most not (core
stores use plain `writeFile`). Every CRITICAL/IMPORTANT race in this report traces
here.

**Real dispatch path (daemon).** Scheduler cron → `Dispatcher.pollAndDispatch`
(non-reentrant) → reconcile stale tasks → consume answered decisions → filter
pending tasks (Eisenhower-sorted; **this filter reads `decisions.json` and can
throw — E1**) → `quota-governor.claimSpawn("builder")` (atomic decide+book under
the mkdir lock) → build prompt → `spawnAgent` (`claude|codex|gemini -p`, argv
array, `buildSafeEnv`, role deny-rules) → on exit 0: boot-gate → record builder
report → task to `awaiting-verification`.

**Real dispatch path B (standalone).** `run-task.ts` is a *second, parallel*
implementation of chain-building, availability classification, deferral, and
completion, spawned by the run routes, coordinating with the daemon only through
the unlocked `active-runs.json`. It has already drifted from the daemon path
(E11/E12/E20).

**Verification.** Dispatcher costs the whole panel against the judge quota, claims
the judge slot, spawns `run-verification.ts` → Ed25519-signed contract →
`env/lifecycle.createEnv` (git worktree in `~/.ligma/envs`, boot adapter from
`.ligma/boot.json` or the stale dogfood adapter — **E2**) → token-gated loopback
bridges (browser/http/pty/fs) → persona panel → judge (different model enforced,
outcome computed in code, fail-default) → signed verdict → `applyVerdict` (**the
only writer of kanban `done`**).

**HTTP surface.** One Express app; `express.text({type:"*/*", limit:"50mb"})`
captures raw bodies; ~110 Next-style route modules adapted at
`routes/adapter.ts`; routes registered sorted by specificity to prevent param
shadowing (guarded by `route-order.test.ts`). Route paths come from `@ligma/api`'s
`API_ROUTES` — the single source of truth shared with web and CLI.

**Web.** Next 15 App Router, fully client-rendered; `/api/*` rewrites to the
daemon. Best idea in the app is the shared collection store (URL-keyed snapshots,
deduped fetches, visibility-paused polling, derived invalidation), but ~10
surfaces still hand-roll fetch+state — where most silent-failure findings live.
Agent-generated design HTML renders in `<iframe sandbox="allow-scripts">` (opaque
origin); markdown renders through a hand-rolled element renderer (no
`dangerouslySetInnerHTML` except shiki output).

**Packages.** Clean dependency direction (`shared ← providers ← core`; no cycles),
but the real shape is **two products in one repo**: the Electron desktop app
consumes `shared/providers/core/runtime/session`; the daemon+web+cli consume
`api` and *re-implement* the rest (R/E findings on drift). `deez`, `nuts`,
`templates` are vestigial.

**Desktop.** A standalone Electron product with **zero coupling to the daemon** (no
`@ligma/api`, no port 4477): its own config dir (`~/.config/ligma`), providers
stack, SQLite store, release pipeline. Security posture is broadly good
(contextIsolation+sandbox+no nodeIntegration, `allow-scripts`-only iframes) with
specific gaps (D4/D5/D8/D12). Undocumented in the README.

**Key invariants and where enforced.** Only `verdict.ts` writes `done`; the
governor gates every spawn via `claimSpawn` (**except E9's two escapees**);
contracts/baselines are denied to spawns via `--disallowedTools`; harness `error`
≠ product `failed` (judge/computeOutcome). The load-bearing gaps: the store lock
regime (R1), fresh-install file tolerance (E1), and the config→capability matrix
(E6/E11/E15 — config validated as legal yet structurally dead).

---

## 3. Findings by category

### 3.1 Correctness, races, silent failures

#### CRITICAL

**E1 — Fresh install silently never dispatches.**
`apps/daemon/src/engine/prompt-builder.ts:64-68,831-840` — `readJSON` does an
unguarded `readFileSync`; `pendingDecisionBlock` reads `decisions.json` inside the
dispatch filter (`dispatcher.ts:801`). On a default `~/.ligma/data` install nothing
seeds `decisions.json`; the first dispatchable task makes the filter throw,
`pollAndDispatch`'s catch (`dispatcher.ts:686`) swallows it, and **all dispatch +
verification pickup dies every cycle**. Tests never see it — the vitest setup
copies the dogfood store, which carries the file. CONFIRMED, [re-verified].
→ Make `readJSON`/`pendingDecisionBlock`/`getPendingTasks` fail-soft to empty
shapes like every other reader (`store/data.ts` `readOrDefault` already does).

**E2 — Self-verification always fails at install.**
`apps/daemon/src/env/mission-control-adapter.ts:34-36,447` — `appDir` hardcodes
`<worktree>/mission-control` and boots `pnpm exec next dev` there; that directory
was removed in the rebrand (now `apps/web`). Every ligma-self task (the path
`run-verification.ts:312` explicitly preserves) fails at install, burns a
verification attempt, parks at the cap after 3. `HEALTH_MARKER` was rebranded but
the path was not — half-migrated. CONFIRMED, [re-verified].
→ Point the adapter at `apps/web`, or require a boot recipe for the ligma repo.

**R1 — Two disjoint lock regimes over the same core JSON stores → cross-process
lost writes.**
`store/data.ts:435` (in-process `async-mutex`) vs `engine/dispatcher.ts:595,708,1172`,
`engine/run-task.ts:561`, `engine/lifecycle.ts:73` (`withFileLock` + bare
`writeFileSync`). HTTP routes and the engine (incl. detached children) serialize
the *same* files with locks that never exclude each other; `run-task.ts:87
writeActiveRuns` has no lock at all. CONFIRMED, [re-verified: `writeActiveRuns` is
a bare `writeFileSync` at `run-task.ts:87`]. Scenario: builder flips a task to
`awaiting-verification` and writes `active-runs.json` while the user PATCHes it or
`GET /api/runs` rewrites active-runs — last whole-file writer wins.
→ Route every writer of a shared store through one lock: make the engine use
`store/data.ts`, or make each mutex additionally take `withFileLock`.

#### IMPORTANT

**E3 — `withFileLock` steal is racy and blocks the event loop.**
`engine/file-lock.ts:46-61` — after 15s *any* waiter `rmdir`s the lock with no
liveness check; two stealers can interleave into the critical section, and A's
`finally` then deletes B's fresh lock. The wait is a **synchronous CPU spin** in
the daemon process — a leaked lock (e.g. a SIGKILL'd child whose `finally` never
ran) freezes the whole HTTP API for up to 15s per acquisition. CONFIRMED,
[re-verified]. → Stamp lock dir with pid+mtime, break only dead holders, async
wait.

**E5 — `active-runs.json` unlocked read-modify-write → duplicate builders.**
`engine/run-task.ts:77-89,444-451,545-546` — no lock, no atomic rename; the daemon
reads it in `reconcileStaleInProgressTasks`. A lost update or a mid-write crash →
`readActiveRuns` returns `{runs:[]}` → daemon sees no external run for an
in-progress task, resets to `not-started`, dispatches a **second concurrent
builder for the same task**. The "already running" check is check-then-act.
CONFIRMED. → Lock + atomic rename.

**E4 — Retry-cap park silently un-parks after ~50 sessions.**
`engine/health.ts:10,98-100,171-173` — `getRetryCount` counts failed rows in a
fixed 50-row global history ring. A task parked "not picked up again without a
human" gets `getRetryCount → 0` once its failure rows are evicted, and is retried
forever at ~50-session intervals. CONFIRMED. → Persist per-task retry counts on
the task.

**E6 — Judge routing off Claude is structurally impossible yet config-legal.**
`harness/judge.ts:90-106` + `engine/runner.ts:251-255` — `roleRouting.judge:
"codex"|"gemini"` validates, but `assertJudgeModel` + pinned-model rejection on
non-claude backends → `failClosed` throw → error verdict every run, while
`remainingForRole("judge")` returns `Infinity` for a routed-off judge → unbounded
panels, each burning a verification attempt to the cap. CONFIRMED. → Reject
`roleRouting.judge != claude` at config validation.

**E8 — Journey verdicts are unverifiable and mislabel persona reports.**
`harness/run-journey.ts:396,429,476-478` — (1) `personaReports` built from
`personaDirName` collapses every seeded walker to `<charter>-1`, so a 3-run naive
panel records one path thrice and never names 2/3; evidence links point at
missing files. (2) `verdict = {...verdict, journeyId, projectId}` mutates *after*
`signVerdict`, so every journey verdict's signature fails `verify()` by
construction. CONFIRMED. → Name paths from roster specs; sign the full payload.

**E11 — Two dispatch paths compute different failover chains; disabling failover
doesn't.**
`engine/dispatcher.ts:188,299-308` vs `run-task.ts:277-307` — dispatcher uses fixed
`BACKEND_ROTATION` and ignores `claudeAutoFailoverBackend` entirely; run-task
honors it but still pushes `codex` even when `claudeAutoFailoverEnabled:false`. A
user disabling failover to stop spending other backends still gets codex/gemini
spawns. CONFIRMED. → One shared chain builder honoring both config fields.

**W6 — "Task completed/failed" toasts almost never fire.**
`apps/web/src/hooks/use-active-runs.ts:21-36` — `announce()` keys on run *id*, but
`/api/runs` keeps a completed run's row with the same id, so any run first seen as
`running` is permanently muted. CONFIRMED. → Track `(id → last status)`, announce
on transition.

**W7 — Task comments: raw fetch, no `res.ok`, prop mutation → false success.**
`apps/web/src/components/task-detail-panel.tsx:601-627` — `await fetch(...)` never
throws on 4xx, then mutates `task.comments` (a store prop) and toasts success; the
next poll discards it. `handleMarkReviewed` (:587) also ignores `res.ok`.
CONFIRMED. → `apiFetch` + `res.ok` + store update.

**W8 — Bulk update/delete never check the response.**
`apps/web/src/hooks/use-data.ts:162-226` — no `res.ok` check; a rejected bulk
"Mark Done" shows a success toast, then the board silently reverts 15s later.
CONFIRMED. → `if(!res.ok) throw` + refetch.

**W12 — Settings cards clobber each other's edits.**
`settings/harness-card.tsx:85-103`, `models-card.tsx:97-135`, `settings/page.tsx:233-263`
— each caches the whole `execution` block at mount and PUTs it back; last save
wins, silently reverting a sibling card's change. CONFIRMED by construction. →
PATCH only the owned sub-object, or re-read before save.

**D6 — `ligma runs tail <bogus-id>` prints nothing, exits 0.**
`routes/runs/.../stream.ts:37-53` never checks the inner poll status; a 404
`{lines:[],done:true}` is streamed as a clean end, CLI (`tail.ts:48`) returns
success. CONFIRMED. → Surface non-200 as an SSE error frame.

#### ADVISORY

**E13** — Orphaned `claimSpawn` booking never refunded when the claimed backend is
filtered out of the chain (`dispatcher.ts:379-390`, `run-task.ts:686-697`); phantom
ledger entry per dispatch. CONFIRMED.
**E20** — Cost telemetry (`recordSpawnOutcome`) is called only from `run-task.ts`;
daemon-dispatched builders leave blank ledger entries. CONFIRMED.
**E23** — A process-death session can be double-ended (failed history row +
success transition) in a narrow race (`health.ts:197-207` vs `dispatcher.ts:972-985`).
CONFIRMED.
**W23** — `useConnection` first checks the daemon only after 30s and treats the
browser `online` event as daemon reachability (`use-connection.ts:54-65`).
CONFIRMED.
**P8** — Retry layer extracts HTTP status via "first 3-digit number in the
message" (`providers/src/retry.ts:105`, dup `core/src/errors.ts:49`); "exceeded 512
tokens" classifies as retryable 5xx. `extractRetryAfterMs` has no upper clamp — a
3600s header stalls generation an hour. CONFIRMED. → Carry structured status;
clamp.
**P19** — `session/resume.ts:94-103` unknown-entry forward-compat branch is
unreachable; the reader already drops unknown types as corruption. CONFIRMED.

#### MINOR
**E21** `awaitSpawn` is exported dead code (the racy primitive spawn-slot
replaced). **E22** `reportNoUsableBackend` / empty-chain branch is unreachable.
**E24** journey personas ignore `maxParallelPersonas`; `runner.ts:86-92` blocks the
loop with `Atomics.wait` up to 4s. **R10** tasks `meta.total` mixes pre/post-filter
populations. **P26** `maxRetries:3` actually means 3 attempts. **P27** `done`
tool's tag/id checks aren't string-aware (phantom "unclosed tag" fix loops).
**P33** new-loop error path emits two `error` events. **W25** client-generated
`proj_${Date.now()}` ids are dead weight (daemon regenerates). **W26** React keys
risk collisions (adoption proposals keyed by title). **D17** tool-call
result/duration never persisted though sent and shown live.

### 3.2 Security & boundary

#### IMPORTANT

**R2 — Path-traversal arbitrary file write via `POST/PUT /api/skills`.**
`store/validations.ts:296` (`skillCreateSchema.id` unconstrained) →
`routes/skills/route.ts:52` → `store/sync-commands.ts:130` (`path.join(SKILLS_DIR,
skill.id)` + mkdir + writeFile). CONFIRMED, [re-verified]. `POST /api/skills
{"id":"../../evil",...}` writes `<WORKSPACE_ROOT>/skills/../../evil/SKILL.md` with
attacker content. Its sibling `agentCreateSchema.id` *is* regex-constrained — skills
is the lone gap. → Constrain the id with the same `/^[a-z0-9-]+$/` (or
`assertSafeId`).

**E10 — Untrusted inbox content executed with store-write access.**
`engine/run-inbox-respond.ts:165-206` — message subject/body/thread/linked-task are
interpolated **unfenced** into a prompt for a spawn granted Edit/Write on
`inbox.json` and `skipPermissions` from config. `buildTaskPrompt` fences even
judge reasoning ("a page reading 'ignore previous instructions'…") — this path,
handling the most message-shaped input in the system, fences nothing. CONFIRMED. →
`fenceTaskData` the thread; have the daemon write the reply (talk's pattern).

**E9 — Two spawn paths bypass the quota governor and kill switch.**
`engine/run-inbox-respond.ts` and `run-brain-dump-triage.ts` — no `claimSpawn`, no
ledger, no kill-switch check; `run-talk-respond.ts:8-13` documents the class of bug
and fixes only itself. The kill switch advertised as "stop all autonomous spawns"
doesn't stop these. CONFIRMED, [re-verified: no `claimSpawn` in either file]. →
Gate both with `claimSpawn`.

**E16 — Persona/bridge commands run with the raw daemon env (secrets).**
`harness/pty-bridge.ts:185-191`, `fs-bridge.ts:209` — execute with `{...process.env,
CI:"1"}` while every CLI spawn uses `buildSafeEnv` to strip `ANTHROPIC_API_KEY`-class
vars; mitigated only by pattern-based scrub on return. CONFIRMED. → Base bridge env
on `buildSafeEnv()`.

**D4 — `settings:v1:open-folder` passes an arbitrary renderer string to
`shell.openPath` with no allowlist.**
`onboarding-ipc.ts:523-531` — while the same codebase allowlists `open-external`
and `showItemInFolder` roots precisely against a compromised renderer;
`shell.openPath` on a `.app`/script *launches* it. CONFIRMED inconsistency. →
Allowlist to config/logs/data dirs.

**D5 — Claude CLI discovery via bare `which claude` fails for packaged builds.**
`packages/providers/src/claude-cli/sdk-runtime.ts:98-111` — a Finder-launched DMG
build gets launchd's minimal PATH and misses npm-global/Homebrew installs; the
whole Claude Max provider becomes unusable while `pnpm dev` works. Mechanism
CONFIRMED, end-user impact PLAUSIBLE. → Resolve PATH from a login shell at boot.

**D8 — config.toml: plaintext keys, `mode:0o600` only on create, non-atomic
write.**
`config.ts:92` (`writeFile {mode:0o600}` applies only at creation) + `keychain.ts`
(plaintext `plain:<key>` by design) + non-atomic `writeConfig` while
`reported-fingerprints.ts` has a `writeAtomic` helper alongside. A pre-existing
looser-permission file keeps its mode; a crash mid-write corrupts config →
boot-error dialog. Mechanisms CONFIRMED. → chmod + writeAtomic.

**P5 — Markdown export URL sanitizer bypassed by named HTML entities.**
`packages/exporters/src/markdown.ts:196-206` — `decodeEntities` handles numeric refs
+ six named entities only; `<a href="javascript&colon;alert(1)">` has no literal
`:` so the scheme regex never fires, and CommonMark renderers reconstruct
`javascript:`. The test file guards numeric/percent variants — the named-entity
class is the gap. CONFIRMED, [re-verified]. → Decode named entities, or reject any
`&…;` in the scheme segment.

#### ADVISORY

**R6** — Error middleware returns raw `err.message` (leaks absolute server paths)
(`server.ts:25-28`). **P7** — `read_url` agent tool: no scheme/private-IP block,
unbounded body buffer before the 4KB cap (`core/tools/read-url.ts:57-75`) — SSRF to
`169.254.169.254`/localhost via prompt-injected reference. **P20** — Exporters
render LLM HTML in `--no-sandbox` Chrome with live network (`exporters/browser.ts:19`).
**D12** — `generate` attachments + `workspace:set` read arbitrary renderer-supplied
paths (inconsistent with D4's hardening). **W13/W14** — `NEXT_PUBLIC_MC_API_TOKEN`
ships in the client bundle and the daemon accepts unauthenticated requests on
:4477 directly (auth is proxy-only theater); agent design HTML runs scripts with no
CSP (author CSP deliberately stripped) — acceptable local-first but undocumented.
**P15** — Codex OAuth callback: any stray local request without `code` kills the
pending login; refresh-error classed via `/\b400\b/` on prose.

#### MINOR
**D21** two main modules bypass the `electron-runtime` test seam; renderer
`index.html` has no CSP meta (mitigated). **P18** `String.replace` with
`$`-pattern replacement in EDITMODE rewrite corrupts on token values containing
`$&`. **P21** see 3.4 (rebrand UA leak — user-relevant).

### 3.3 Incoherence, dead code, duplicated sources of truth

#### IMPORTANT

**W4 — Deep links use `?design=`; the studio only honors `?session=`.**
Producers: `routes/deck/deck-cards.ts:177,205`, `web/lib/deck-cards.ts:281,314`,
`task-detail-panel.tsx:322`. Consumer `studio/deep-link.ts:50` reads only
`session`/`file`. CONFIRMED, [re-verified]. Every "see where this came from" link
lands on `designs[0]`, not the design under review. → Accept `design` as an alias
(one line).

**W3 — The e2e suite asserts a retired IA; the `pnpm verify` gate is broken.**
`e2e/smoke.spec.ts`, `product-flows.spec.ts`, `studio.spec.ts`,
`failure-onboarding.spec.ts` click rail links ("Deck"/"Inbox"), section tabs, a
`/deck` heading, `data-failure-class="harness"` — all removed/renamed in the
current app. `test-results/.last-run.json` says "passed" (stale artifact). Unit
suites *were* updated; e2e wasn't. CONFIRMED. → Rewrite specs against the current
rail/tray/full-screen-studio IA.

**W5 — Twelve call sites use raw `fetch` instead of `apiFetch` → 401 under the
documented token config.**
The entire `settings/checkpoints/page.tsx`, `brain-dump/page.tsx` auto-process,
seed-demo on `page.tsx`+`settings/page.tsx`, comments in `task-detail-panel.tsx`.
CONFIRMED. → Route through `apiFetch`.

**W10 — `web/lib/deck-cards.ts buildDeckCards` is a dead duplicate that has already
drifted** from the live daemon copy, and the unit suites assert the dead copy; card
options travel as exact-match display strings across the process boundary
(`lib/deck-actions.ts`). CONFIRMED. → Delete the web copy, move tests to the
daemon, hoist option strings to a shared constant.

**D14 — Two divergent demo-seed implementations** (`scripts/seed-demo.ts` writing
files directly, unlocked, vs `routes/seed-demo/route.ts` via stores, different
record shapes) already drifted. CONFIRMED.

**P4 — `generateViaNewLoop` silently drops the design system prompt, skills,
attachments, and truncation detection.**
`packages/core/src/generate-via-new-loop.ts:136-144` sends `[...history, prompt]`
only; the referenced `streamViaClaudeCli` composes nothing and `sdk-runtime.ts:539`
sets `systemPrompt:''`. The beta produces un-prompted generic output while claiming
parity; a result-less stream end isn't treated as truncation. CONFIRMED.

**P12 — The daemon re-implements `@ligma/providers` and the twins drifted.**
`apps/daemon/src/studio/provider.ts:293` admits the package "does not currently
compile under this app's compiler options," so claude-binary resolution / SDK typing
exist twice; daemon's handles Windows (`where` vs `which`) while
`providers/sdk-runtime.ts:101` hardcodes `which`. CONFIRMED.

#### ADVISORY

**R5** — `POST /api/seed-demo` overwrites all core data with no in-flight guard,
unlike `checkpoints/load` (`routes/seed-demo/route.ts:7`). **R8** — `PUT
/api/decisions` bypasses the stale-card 409 guard that `PATCH` enforces; DELETE
routes return `{ok:true}` on missing ids. **R9** — `routes/pty/route.ts` docblock
says it's unregistered; it's live. **E15** — default `allowedTools` is
`["Read","Edit","Write"]` (no Bash) directly contradicting its own comments
("builder keeps Bash"); also the exact set codex can never honor, so
`backendMode:"codex"` silently routes to claude. **E18** — verdict `verify` trusts
the embedded key citing a "git-tracked contracts" rationale that `contract-store.ts`
says was retired 2026-08-13. **P2** — Settings "Reasoning depth"/`queryParams`
resolved but never passed to generation — a UI knob that changes nothing. **P3** —
Web "live tweaks" update the file but the tweaks bridge was never ported into the
web srcdoc; the preview never updates though the toast says "Applied live". **P10**
— Broad dead public surface (`isExporterReady()=>true`, `makeFs*Tool`, user/project
skill tiers, etc.). **P11/X13** — vestigial `templates`/`deez`/`nuts` packages;
`templates`' system prompt mandates "single file… multi-file is failure" — the exact
opposite of core's agent guidance. **P13** — Agent-mode prompt concatenates two
contradictory output contracts (single-doc Tailwind-CDN vs multi-file JSX); frames
hint names `frames/*.html` while the VFS seeds `frames/*.jsx` (model's first `view`
404s). **D1** — FS-ACK contract is dead wire: renderer can't send the ack channel,
so every file write logs a false "possible dropped update" timeout. **D11** —
Auto-update checks on every packaged boot against metadata that `--publish never`
never uploads; in-app download/install preload API is dead (banner only deep-links
GitHub).

#### MINOR
**W15** ⌘K "Talk" verb just navigates. **W16/W27/P25/P30/P31/D18** stale comments
and labels lying about behavior (deep-link "not wired up yet" is wired;
`api/index.ts` "no runtime logic" ships pure functions; `USE_AGENT_RUNTIME` "default
off" is on). **W18/W19** two parallel search UIs; `useSidebar` is a third polling
mechanism computing counts nothing renders. **W29** `ProjectQuickActions` dead code.
**P23/P24** `TweakSchema`/`ArtifactType`/`ReasoningLevel` defined incompatibly
twice. **D15/D16** `create-crew-tasks.mjs` hardcodes port 3000 + one instance's ids;
`triage-bd.js` is empty. **X17/X15** superseded DECISIONS entries.

### 3.4 Rebrand / lineage leakage (user-relevant per MEMORY)

**P21 — Upstream repo URL leaked in an outbound HTTP header.**
`packages/core/src/tools/read-url.ts:64` — the `read_url` agent tool sends
`user-agent: 'ligma/0.1 (+https://github.com/hqhq1025/codesign)'` on every fetch.
CONFIRMED, [re-verified]. The user's MEMORY rule forbids upstream-lineage prose;
this ships the ancestor repo URL to every site the agent reads. Also pervasive
legacy naming (`CodesignError`, `CODESIGN_CHROME_PATH`, `__codesign` postMessage
envelope, `codesign-zip-` temp prefixes) and a `paths.ts:9` comment that reads
"renames the `@ligma/*` → `@ligma/*`". → At minimum fix the UA URL.

### 3.5 Export/serialization correctness (packages)

**P1 — IMPORTANT — `prettifyHtml` corrupts exported HTML.**
`packages/exporters/src/html.ts:88` — `html.replace(/>\s+</g,'><').replace(/></g,'>\n<')`
runs over the whole document *before* script/pre detection, injecting newlines
inside JS string literals (SyntaxError, dead interactivity), deleting significant
inter-tag whitespace, and collapsing `<pre>`. `prettify` defaults true; both
consumers use the default; `html.ts` is the one exporter with no test.
CONFIRMED, [re-verified]. → Tokenize; skip transforms inside script/pre/textarea.

**P16 — ADVISORY — Any HTML with `<section class="slide">` exports as a 1280×720
deck** (`exporters/src/pdf.ts:80`). PLAUSIBLE. **P17 — `exportMultiFileZip` silently
overwrites a user file named `README.md`** (`zip.ts:175-178`). CONFIRMED.

### 3.6 Missing functionality

**D7 — IMPORTANT — CLI Ctrl-C is dead except in `runs tail`, and no command has a
timeout.** `cli.ts:69` installs a SIGINT handler (suppressing Node's default) but
only `tailRun` receives `controller.signal`; a wedged-but-connected daemon hangs
`ligma projects list` forever, unkillable. CONFIRMED. → Thread the signal through
`daemonJson`.
**E14 — ADVISORY — timeout kill sends SIGTERM with no SIGKILL escalation**
(`runner.ts:622-635`); a CLI ignoring SIGTERM leaks its slot forever.
**E19 — ADVISORY — `spawnHarness` runs bare `spawn("npx",…)`** (`verdict.ts:1105`) —
on Windows `npx` is a `.cmd` shim, EINVAL without `shell:true`; no verification can
start on Windows though `runner.ts` invests ~100 lines resolving exactly this.
**R3 — IMPORTANT — core stores written non-atomically** (`store/data.ts:169-171`
plain `writeFile`) while memory/references/studio stores temp+rename; a mid-write
crash truncates `tasks.json` → `readOrDefault` silently returns `{tasks:[]}` → the
board reads empty and a later save persists the emptiness. CONFIRMED, [re-verified].
**W9/W11/W17/W21/W22** — Studio Send has no in-flight guard (double-click → two
designs); terminal clears input before send and swallows failures; portfolio Tasks
table + answered-decisions list are unbounded; global Escape in TaskDetailPanel
discards unsaved field edits; `revokeObjectURL` right after `click()` can cancel the
export download.

### 3.7 Docs, DX, repo hygiene

#### CRITICAL / IMPORTANT

**X1 — CRITICAL — README claims `data/` is gitignored; 13 live stores are tracked**
(and new ones accrete untracked). CONFIRMED, [re-verified: `git ls-files data` = 13].
→ Decide seed-vs-ignore; add the two new stores now; fix the README sentence.
**X2 — IMPORTANT — `apps/web/DEPLOYMENT.md` describes a product that no longer
exists**: pnpm 10+ (repo pins 9.15.0), `.github/workflows/ci.yml` (no `.github`),
`STORYFORGE_MODEL`, "reads work on Vercel" (all data is behind the localhost
daemon; a Vercel deploy can never reach its API). → Delete or rewrite.
**X3 — IMPORTANT — NOTICE.md claims a `THIRD_PARTY_LICENSES.txt` "generated at
package time"** that no build step produces. → Add the collector or drop the claim.
**X4 — IMPORTANT — No CI anywhere, and `scripts/setup-branch-protection.sh:30-37`
requires phantom checks** ("Lint & Typecheck"/"Test"/"Build") — running it makes
`main` unmergeable forever. → Port a minimal workflow or park the script.
**X5 — IMPORTANT — CHANGELOG frozen at the pre-merge Electron product** while
packages are 0.2/0.9. **X6 — IMPORTANT — `apps/web/README.md` hands users a broken
start** (`start-mission-control.sh` boots web with no daemon → every `/api/*` dead-ends;
links a nonexistent `CLAUDE.md`; claims SWR when hooks are hand-rolled).
**X7 — IMPORTANT — 644-file `design-templates/` tree consumed by no code**, fronted
by an `AGENTS.md` asserting a `/api/design-templates` route that doesn't exist;
`skills/AGENTS.md` likewise mis-states `/api/skills` (the vendored catalog is
`/api/skill-catalog`). **X8 — IMPORTANT — dead changeset release toolchain**
(4 scripts + devDep, no `.changeset/`, every package private).

#### ADVISORY / MINOR

**X9** — `docs/evidence` = 2,218 files / 238MB in git ([re-verified: 238M]); `.git`
~300MB; deliberate per the brief but monotonically growing → LFS/release artifact.
**X10** — README points Codex/Gemini config at `docs/` where no such doc exists.
**X11** — tracked `data/daemon-config.json` ships automation ON (crons, 4 parallel
agents) — a README-following newcomer spawns scheduled model sessions on their own
quota against the committed dogfood data. **X12** — root `pnpm lint` (`biome check
.`) ignores the daemon, web, and api packages. **X13** — `deez`/`nuts` placeholder
packages with `tsc --noEmit || true` self-neutralizing checks. **X14** — conductor
archives (`FIX-PLAN.md`, `CONTRACTS.md`) cite pre-merge paths with no historical
banner. **D13** — desktop app and CLI are undocumented in the README (separate
config dir, providers stack, release pipeline; the CLI's existence is
undiscoverable). Plus X16-X23 (orphaned `apps/web/docs`, version incoherence,
desktop-era NOTICE dep tables, partial design-system dirs, no git remote, e2e runs
against the dogfood store, dogfood-product artifacts blurred into factory docs).

---

## 4. Design tensions (structural — the approach, not a line)

**T1 — JSON files + ad-hoc locks vs. a genuinely multi-process system.**
Five process kinds coordinate through ~15 JSON files under three different locking
disciplines (in-process mutex, cross-process mkdir lock, none) and two write
disciplines (atomic rename, plain overwrite), with a lock that busy-waits
synchronously and force-breaks at 15s without a liveness check. R1, R3, E3, E5 are
all symptoms. **Alternative:** make the daemon the single writer — children talk to
its already-in-process HTTP API — or move the hot stores (tasks, active-runs,
decisions) to SQLite (the desktop app already ships better-sqlite3), keeping JSON
only for human-inspectable evidence. Tuning the current split cannot make it
correct.

**T2 — Config surface validated as legal but structurally dead.**
`decideBackend` is a hard capability wall (no partial grants on codex/gemini, no
pinned models off claude), yet config lets users route builder/persona/judge
anywhere and pick failover backends freely — producing whole config regions that
pass validation and then fail at runtime as harness errors (E6, E11, E15; and P2's
reasoning-depth knob). **Alternative:** validate routing/failover against
`canBackendHonorRestrictions` at config-load and reject "this cannot work" as a
config error, not a per-run error; delete UI knobs with no wiring.

**T3 — Two products, one brand, no shared spine.**
The desktop app shares the repo and the name but not the daemon, API package,
providers stack, config location, or docs; the "shared" packages
(providers/core/runtime) are desktop-only in practice, and every port to the daemon/web
so far copied half a mechanism and dropped the other half (P3 web tweaks bridge, P12
daemon provider, R1/E11 dual dispatch). **Alternative:** either wire the desktop to
the daemon and make the packages compile for all consumers, or name it a separate
product with its own docs/release identity and stop paying the "shared" tax on drift
(D5/D10/D13/D14).

**T4 — Doctrine vs. edge reality on regex-over-prose.**
The repo's most-stated principle ("nothing is regex'd out of prose"; the
skill-injector's keyword-table repudiation; the owner's own standard) is honored in
the api/daemon layer and violated at every provider/exporter boundary (P5, P8, P14
bilingual keyword tables gating chart guidance, P15). The boundaries where prose is
unavoidable — upstream error strings, LLM HTML — need a *declared* policy (structured
error carriers, a real HTML parser), not ad-hoc regexes under a doctrine that
forbids them.

**T5 — Placeholder maximalism.**
`deez`/`nuts`, `isExporterReady()=>true`, Tier-2 "not yet implemented" comments over
implemented code, the reasoning-depth UI with nothing behind it (P2), broad dead
exports (P10): the codebase reserves names and surfaces aggressively, and a surface
that *reads* as done is exactly how an unwired knob ships unnoticed. **Alternative:**
delete-until-needed; a finished-looking affordance is a liability, not an asset.

---

## 5. Expectation gaps (expected X, found Y)

- Expected a fresh install to build tasks; found dispatch silently dies on a missing
  `decisions.json` (E1).
- Expected concurrent runs to mutate `tasks.json` safely; found HTTP and engine
  writers share no lock, and `active-runs.json` has none (R1/E5).
- Expected the kill switch to stop *all* autonomous spawns (its own docs); found
  inbox-respond and brain-dump triage exempt (E9).
- Expected `claudeAutoFailoverEnabled:false` to disable failover; found it only
  disables the sticky rotation (E11).
- Expected the builder default toolset to include Bash ("the one role that runs
  things"); found `["Read","Edit","Write"]` (E15).
- Expected a "signed verdict" to be verifiable; found journey verdicts mutated after
  signing and no code path verifying any verdict signature (E8).
- Expected the run button to show the decision dialog it was built for; found a
  singular/plural key mismatch kills it (W1).
- Expected "Undo" after delete to restore; found it fails permanently for
  brain-dump/inbox/decisions (W2).
- Expected "see where this came from" to open that design; found `?design=` is never
  read (W4).
- Expected the documented production token to secure the app; found it ships in the
  client bundle and the daemon accepts unauthenticated requests directly (W5/W13).
- Expected `pnpm verify` to gate merges; found the e2e half asserts an IA that
  shipped several phases ago (W3).
- Expected README to describe the product; found it omits the CLI, desktop app,
  tests, and MCP server, points backend config at a nonexistent doc, and claims
  `data/` is ignored while tracking live state (X1/X10/X21).
- Expected "Export HTML" to preserve the design; found it can break the design's own
  JavaScript (P1).
- Expected the new-loop beta to reach parity; found it generates without the
  product's entire design brain (P4).
- Expected `ligma runs tail <id>` to fail on a bad id; found silent success (D6).
- Expected outbound agent fetches to carry no lineage; found the ancestor repo URL in
  the User-Agent (P21).

---

## 6. Open questions (only the maintainer can resolve)

1. Is the committed `data/` store an intentional newcomer seed, or an accident of the
   dogfood pin? (Decides X1's fix: whitelist-as-seed vs full ignore + `seed:demo`.)
2. Does `github.com/alexraymond/ligma` exist yet? The repo has no git remote, yet the
   clone URL and all `gh` tooling depend on it.
3. Is `design-templates/` meant to be read by the studio agent at runtime (roadmap
   phase 7), or reference-only? Nothing consumes it today (X7).
4. Is the Electron desktop app a supported face or legacy awaiting removal? It drives
   most of NOTICE, the `pnpm i` postinstall cost, and the T3 drift.
5. Is the `MC_API_TOKEN`/Vercel/DEPLOYMENT.md remote-dashboard story still wanted, or
   should it be deleted outright (W13/X2)?
6. Are `deez`/`nuts` load-bearing name reservations or deletable (X13)?
7. Evidence locker: is the ~300MB clone budget acceptable, or should screenshots move
   to LFS/external storage with hashes in the manifests (X9)?
8. What is the intended default automation posture on first run — the committed config
   ships crons ON against the dogfood data (X11)?

---

*Report generated 2026-08-27. Read-only audit — no code changed, git untouched. Six
area agents read the codebase in full; the lead re-verified the six CRITICALs and a
sample of IMPORTANT findings against source (marked [re-verified]).*
