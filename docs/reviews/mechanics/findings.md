# Web app mechanics review — refresh, workflow completeness, residue, errors, IA

> **Closed.** This is a raw defect inventory, not a live status — read
> [`../ui-ux-review.md`](../ui-ux-review.md) first for the synthesis, and
> [`../../evidence/DONE-UX.md`](../../evidence/DONE-UX.md) for the campaign
> that closed the findings here. Reading this file directly (rather than via
> ui-ux-review.md) will
> make fixed issues and since-retired surfaces look open.

Static analysis only, tree at `main` (`546d775`). Everything cited to `file:line`.

**Verdict:** the surfaces are well built and the vocabulary is unusually disciplined; the *plumbing between them* is not. Twenty-nine independent fetch mechanisms, no shared cache, no invalidation model. Almost every cross-surface bug below is the same bug — a mutation refreshes the one hook that owns the thing it changed, and the three hooks that derive from it never hear about it.

## 1. Refresh mechanics inventory

| # | Hook / provider | Endpoint | Mechanism | Interval | Vis-gated | Backoff | Mutations |
|---|---|---|---|---|---|---|---|
| 1 | `useTasks` `hooks/use-data.ts:220` | `/api/tasks` | `setInterval` `:44` | 15s | yes | no | optimistic + revert-by-refetch `:98,:107` |
| 2 | `useGoals` `:224` | `/api/goals` | none | — | — | — | optimistic; **never refreshes** |
| 3 | `useProjects` `:229` | `/api/projects` | none | — | — | — | **never refreshes** |
| 4 | `useBrainDump` `:234` | `/api/brain-dump` | none | — | — | — | **never refreshes** |
| 5 | `useActivityLog` `:239` | `/api/activity-log` | `setInterval` | 30s | yes | no | — |
| 6 | `useInbox` `:244` | `/api/inbox` | `setInterval` | 10s | yes | no | optimistic |
| 7 | `useDecisions` `:249` | `/api/decisions` | `setInterval` | 10s | yes | no | optimistic |
| 8 | `useAgents` `:254` | `/api/agents` | none | — | — | — | **never refreshes** |
| 9 | `useSkills` `:259` | `/api/skills` | none | — | — | — | **never refreshes** |
| 10 | `useActiveRuns` `hooks/use-active-runs.ts:61` | `/api/runs` | raw `setInterval` | **3s** | **NO** | **no** | refetches runs only |
| 11 | `useDashboardData` `:81` | `/api/dashboard` | `setInterval` | 15s | yes | no | callers `refetch()` |
| 12 | `useDashboard` `hooks/use-dashboard.ts:46` | `/api/dashboard` | none | — | — | — | **ZERO CONSUMERS — dead file** |
| 13 | `useSidebar` `:45` | `/api/sidebar` | `setInterval` | 10s | yes | no | — |
| 14 | `useDeckCards` `hooks/use-deck-sources.ts:37` | `/api/deck` | **fetch-once** | — | — | — | only on explicit `refetch()` |
| 15 | `useDaemon` `:181` | `/api/daemon` | `useSmartPoll` | 5s | yes | ×1.5→3× | `setTimeout(refetch,2000)` `:195,:212` |
| 16 | `useDaemonLogs` `:37` | `/api/logs` | raw `setInterval` | 5s | **NO** | no | — |
| 17 | `useRunOutput` `:71` | `/api/runs/:id/output?offset=` | `useSmartPoll` + cursor | 2s | yes | yes | self-terminating |
| 18 | `useConnection` `:65` | `HEAD /api/dashboard` | `setInterval` | 30s | no | no | — |
| 19 | `useFastTaskPoll` `:18` | → `useTasks.refetch` | `setInterval` | 5s while live | yes | no | — |
| 20 | `useProjectPipeline` `:18` | `…/brief`, `…/designs` | **fetch-once** | — | — | — | **no refetch exposed** |
| 21 | `useVerificationRuns` `:16` | `/api/verification-runs` | **fetch-once** | — | — | — | **no refetch exposed** |
| 22 | `useJourneys` `:34` | `…/journeys` | fetch-once | — | — | — | `refetch()` exposed |
| 23 | `useVerdictOutcomes` `:56` | `/api/verification-runs/:id` **×N** | fetch-once, N-parallel | — | — | — | N+1 per journey list |
| 24 | `useBaselines` `:86` | `…/baselines` | fetch-once | — | — | — | none |
| 25 | `ProjectHealthBoard` `:31` | `…/health` | fetch-once | — | — | — | none |
| 26 | `AgentsCard` `app/settings/agents-card.tsx:75` | `/api/backends` | `useSmartPoll` | 15s | yes | yes | rescan→refetch |
| 27 | Adoption page `:93` | `/api/adoption/:runId` | `useSmartPoll`, `enabled:running` | 4s | yes | yes | review/retry→`load()` |
| 28 | `useDesign` `components/studio/use-design.ts:96` | `…/designs/:did/stream` | **SSE push** + ~250ms throttled refetch | push | — | — | turn→`refreshRef` |
| 29 | `TerminalPanel` `terminal-panel.tsx:73` | `/api/pty/:id/stream` | **SSE push** | push | — | — | server replay buffer |

Three idioms for one job: `useSmartPoll` (the good one — visibility pause, generation-guarded staleness, exponential backoff, `hooks/use-smart-poll.ts:33-107`), raw `setInterval` + a `visibilityState` check, and raw `setInterval` with nothing. Six hooks predate `useSmartPoll` and were never migrated.

### Cross-surface staleness — the owner's two questions

**"Answer a decision on Deck — does the badge elsewhere update?" *Only in swipe mode.*** Deck mode passes `onApplied={refetchAll}` (`app/deck/page.tsx:295`) which refetches `/api/deck`. **List mode does not**: `handleAnswer` `:115` and `bulkApply` `:211` call `refetchDecisions()` only, with a comment justifying it `:112-114`. But the rail badge reads `deckCards.length` (`components/layout-shell.tsx:103`) and the page's own header reads `{deckCards.length} waiting` (`app/deck/page.tsx:265`) — both from `/api/deck`, unrefetched. Answer twelve decisions in list mode and the rail still says 12. This is precisely the seam `providers/deck-queue-provider.tsx:9-24` documents as closed.

**"Promote a design — does the Board know?" *No.*** `components/studio/studio-surface.tsx:621` is `onPromoted={(result) => showSuccess(…)}` — a toast, nothing else. Until a hard reload: the pipeline strip's Design/Build chips are frozen (`useProjectPipeline` fetch-once, no refetch), and the Overview Health board still says *"No criteria frozen yet"* (`components/project-health-board.tsx:31`) although promote is exactly what freezes them. The Board picks up new tasks only on the next 15s `useTasks` tick, and only once the user navigates.

**Home never learns.** `app/page.tsx:116` reads `needsYou` from `useDeckQueue()`, sourced from #14 (fetch-once). Per-project "N needs you" badges (`app/page.tsx:766`, `project-card-large.tsx:144`) are frozen at page load. A decision raised while the user sits on Home is invisible there forever.

**Verify's evidence link never arrives.** `app/projects/[id]/verify/page.tsx:29` uses #21 (fetch-once, no refetch). `:59` wires `onRan={() => void refetch()}` — but that's `useJourneys`'s refetch, i.e. it refreshes *journeys*, not *runs*. Press "Prove it", wait ten minutes: the pill and Evidence link are unchanged.

**Fetch-once collections freeze session state.** `useProjects` never polls, so a project renamed, archived, or given a `repoPath` elsewhere never updates the Terminal tab gate (`app/projects/[id]/layout.tsx:105`), the shape-gated Studio tab (`:103`), or the Projects list.

### Flag: polls that hammer

`useActiveRuns` polls `/api/runs` **every 3s with no visibility gating** (`hooks/use-active-runs.ts:8,61`) — the only poller in the app that keeps hitting the daemon from a backgrounded tab, forever. Mounted app-wide via `ActiveRunsProvider` (`layout-shell.tsx:127`), and **twice on `/runs`**: the page imports the raw hook instead of the context (`app/runs/page.tsx:6,78`) → 40 req/min to one endpoint on one screen. The endpoint is not cheap: `apps/daemon/src/routes/runs/route.ts:23-53` reads the full active-runs store, the full tasks store, merges daemon sessions, and `statSync`s every running run's output file `:55-80`.

Idle-tab budget on `/board`: `/api/runs` 20/min, `/api/tasks` 8/min (two independent `useTasks` mounts — page `:41`, `search-dialog.tsx:53`), `/api/sidebar` 6/min, `/api/inbox` 6/min, `/api/decisions` 6/min, `/api/activity-log` 2/min, `HEAD /api/dashboard` 2/min. **~50 req/min with nothing happening.** The multiplication is structural: `useDataResource` (`hooks/use-data.ts:11`) gives every call site its own state and its own interval. `useAgents()` is mounted from `task-form.tsx:58`, `task-detail-panel.tsx:241`, `create-project-dialog.tsx:32`, `projects/[id]/page.tsx:22` — four separate `GET /api/agents`.

### Flag: SSE without reconnect

`components/studio/use-design.ts:96` opens an `EventSource` with **no `error` and no `open` handler**. Native `EventSource` retries a dropped connection, but a non-2xx or wrong content-type closes it permanently — the Wall silently stops moving, no indicator, no retry. `terminal-panel.tsx:88-90` *does* handle `error` and drops to a visible `unavailable` phase; the Studio's main live surface is the one without it.

`terminal-panel.tsx:108-119`: `submit()` is `try {…} finally {…}` with **no `catch`** around `sendTerminalInput` — a rejected send is an unhandled rejection; the input box just clears.

### Flag: refetch-the-world where targeted exists

- `hooks/use-data.ts:98,107,127,157,183` — every mutation failure refetches the whole collection to revert; the pre-mutation optimistic state was already the revert target.
- `hooks/use-journeys.ts:56-77` — one request per journey verdict because the list route omits the verdict, though it already opens each `run.json` (`verification-runs/route.ts:38-41`).
- `app/deck/page.tsx:165` `answerOtherCard` calls `refetchAll()` (decisions + whole deck) where only the deck changed.

## 2. Workflow completeness

### 2.1 Unconsumed routes — 12 endpoints, 159 total across 104 paths

`apps/desktop` never talks to the daemon (its only `/api/` strings are Ollama/OpenRouter, `connection-ipc.ts:846`), so "elsewhere" means the CLI.

| Endpoint | daemon file:line | What the user can't do |
|---|---|---|
| **GET `/api/runs/:id/output/stream`** | `routes/stream.ts:19` | **Live run output in the browser.** The CLI streams it (`apps/cli/src/commands/tail.ts:22`); web polls on a 2s timer instead (`use-run-output.ts:36`). Highest-value wire-up: endpoint exists, proven by the CLI, and `use-design.ts:96` already shows the EventSource pattern in-repo. |
| GET/POST `/api/tasks/archive` | `tasks/archive/route.ts:7,49` | No archive view and no archive action — the board only supports hard delete |
| GET `/api/tasks/:id/evidence-pins` | `tasks/_id/evidence-pins/route.ts:15` | Task detail can't show only its own pins; all three pinners use the project-scoped route (`evidence-pinner.tsx:51`, `record-pinner.tsx:50`, `pin-composer.tsx:73`) |
| GET/DELETE `/api/projects/:id/promote/preview` | `promote/preview/route.ts:28,53` | Can't resume a half-finished promotion after closing the sheet; no "cancel promotion" — stale previews accumulate server-side |
| GET `/api/projects/:id/baselines/:jid` | `baselines/_jid/route.ts:9` | Baseline rows on Knowledge are dead ends — can't open one to see what "working" looked like |
| GET `/api/briefs` | `briefs/route.ts:32` | No "all my briefs" index |
| GET `/api/projects/adopt` | `projects/adopt/route.ts:19` | Can start an adoption and open one by id, but can't list them |
| GET `/api/projects/:id/journeys/:jid` | `journeys/_jid/route.ts:12` | No journey detail page / deep link |
| GET `/api/mcp/servers/:id` | `mcp/servers/_id/route.ts:9` | No per-server detail view |
| GET `/api/data-root` | `data-root/route.ts:11` | Settings shows the *product* root but never the data root — user can't see where state lives |
| POST `/api/sync` | `sync/route.ts:10` | No manual resync when the UI looks stale |
| GET `/api/projects/:id/designs/:did/snapshots` | `snapshots/route.ts:16` | Redundant — Studio reads snapshots off `DesignState` (`api.ts:90`). Delete rather than wire. |

### 2.2 Dead client call — a real 405

**`PUT /api/activity-log` returns 405.** `routes/activity-log/route.ts` exports only `GET :7`, `POST :40`, `DELETE :62`. `useActivityLog` is built on the generic `useDataResource`, which PUTs from `use-data.ts:88` (`update`), `:127` (undo-restore), `:168` (bulk fallback). `mountRoute` answers 405 (`routes/adapter.ts:66-69`). Most reachable path: **delete an activity event → the Undo toast is shown unconditionally (`use-data.ts:122-140`) → clicking Undo 405s → "Failed to restore event", row still gone.** Every other `useDataResource` endpoint exports `PUT`; activity-log is the lone gap.

### 2.3 States with no UI representation — none

| Enum | Rendered? |
|---|---|
| `KanbanStatus` (`packages/api/src/types.ts:6`) | Yes — `lib/kanban.ts:9-21` is a total `Record`, so an added value is a compile error; four columns at `app/board/page.tsx:33-38` |
| `RunStatus` (`:391`) | Yes — `run-status-badge.tsx:50-80`, incl. governor `deferred` `:67` and derived `working-silently`/`possibly-stalled` `:36-42` |
| `DesignStatus` (`designs.ts:25`) | Mostly — `stale` has no distinct chip, falls into `●N` (`pipeline-strip.tsx:90-100`) |
| `DeckCardKind` (`lib/deck-cards.ts:23`) | Yes — `DECK_KIND_LABELS` total `Record` `:32-39` |

This is the strongest part of the codebase: total-`Record` discipline makes a missing state a compile error, not a blank pixel.

### 2.4 Dead-end affordances — none

Swept for console-only handlers, `alert(`, `onClick={() => {}}`, hardcoded `disabled`, TODO/FIXME/"coming soon", and every `href`/`router.push` against the route tree. **Zero hits on all of it.** The eight top-level routes that look orphaned (`/checkpoints`, `/decisions`, `/launch`, `/priority-matrix`, `/skills{,/new,/[id]}`, `/status-board`) are deliberate `redirect()` shims and every target exists. `studio/page.tsx:27`'s `notFound()` for headless projects is gated behind the same fact that hides the link (`layout.tsx:103`), so it's unreachable by navigation.

Only residue is comments that lie about their own wiring: `app/settings/agents-card.tsx:24-26` ("NOT wired into page.tsx" — it is, `settings/page.tsx:834`), `app/settings/integrations/page.tsx:10-11` (same, `:839`), and four "route not registered in `routes.ts` yet" comments that hardcode paths as a workaround (`terminal-api.ts:6-8`, `workspace-api.ts:7-10`, `library-meta.ts:6-9`, `brand-tokens.ts:18-20`) — all four are now registered (`packages/api/src/routes.ts:13-32`).

## 3. File-editing residue

Tonight's work **did land** — verified, not assumed. Journeys CRUD: `components/journeys-form-dialog.tsx`, `journeys-panel.tsx`, commit `b99bfb3`; the smoke schedule that once required hand-editing `.ligma/journeys/*.json` now has a `<select>` (`journeys-panel.tsx:111-122`, gap recorded in its own docblock `:61-67`). Settings gaps: commit `89596a9`; all seven cards mounted at `app/settings/page.tsx:831-844`.

What remains:

| # | Residue | Evidence | Impact |
|---|---|---|---|
| R1 | **`.ligma/boot.json` outside adoption.** Preflight *detects* it (`apps/daemon/src/env/preflight.ts:473-484`) but the four fix kinds are `reconcile-orphans`/`prune-boot-logs`/`reset-env-manifest`/`install-chromium` (`env-preflight-card.tsx:14`) — none writes a recipe | `engine/task-env.ts:105-110` instructs the *agent*; the human has no UI | A composer-built project that fails its boot gate is recoverable only by hand-editing JSON in the product repo. The editor already exists (`app/adoption/[runId]/page.tsx:236-242`) — just unreachable for non-adopted projects |
| R2 | **Studio model selection**, and the card says so: *"Set the env var and restart the daemon"* | `app/settings/models-card.tsx:58-60,199-210` | `LIGMA_STUDIO_MODEL`, `_CRITIC_MODEL`, `_PLANNER_MODEL` named in the UI, unsettable from it |
| R3 | **Library authoring, all three catalogs** — "Create your own" is by design a *guide to editing files by hand* | `components/library/authoring-guide.tsx:3-10`, bodies `:28,:47,:70` | Design system = create `design-systems/<id>/{manifest.json,tokens.css}`; skill = `skills/<id>/SKILL.md`; craft rule = `craft/<id>.md`. The DS wizard is the one exception |
| R4 | **Six more env vars with no UI** | `env/boot-adapter.ts:37-38` + daemon grep | `LIGMA_ENV_HEALTH_TIMEOUT_MS`, `LIGMA_ENV_INSTALL_TIMEOUT_MS`, `LIGMA_SMOKE_DIGEST_CRON`, `LIGMA_DATA_DIR`, `LIGMA_ENVS_DIR`, `LIGMA_WORKSPACE_ROOT`. Only `LIGMA_PRODUCTS_DIR` got a card (`project-locations-card.tsx:27`) |
| R5 | **`MC_API_TOKEN` / `NEXT_PUBLIC_MC_API_TOKEN`** — enabling API auth means editing `.env.local` twice and restarting both processes | `src/middleware.ts:29-33`, `lib/api-client.ts:31` | No Settings surface mentions authentication exists |

## 4. Error / edge presentation

### 4.1 Failure rendered as emptiness — the class that lies

Seven catch blocks degrade a *fetch failure* to an *empty result*, after which the surface makes a false positive claim:

| Swallower | Renders as |
|---|---|
| `hooks/use-deck-sources.ts:34` `setCards(EMPTY)` | Deck: *"Nothing is waiting on you"* (`app/deck/page.tsx:518`) |
| `hooks/use-project-pipeline.ts:26` `setBrief(null)` | **The Brief tab disappears** — `layout.tsx:102` derives `hasBriefStage` from it |
| `hooks/use-project-pipeline.ts:35` `setDesigns([])` | **The Studio tab disappears** (`layout.tsx:103`) |
| `hooks/use-verification-runs.ts:26` `setRuns([])` | Verify: *"No task in this project has been through the harness yet"* (`verify/page.tsx:70`) |
| `hooks/use-journeys.ts:93` `setBaselines([])` | Knowledge: *"No characterization baselines yet"* (`knowledge/page.tsx:360`) |
| `hooks/use-journeys.ts:66` `return null` | A verdict that failed to load reads identically to "no verdict" |
| `components/record-pinner.tsx:71` `setLines([])` | Record body blank rather than "couldn't read" |

The repo already states this rule twice — `regression-corpus.tsx:46-47` (*"'no probes' and 'could not read them' are different claims"*) and `project-health-board.tsx:40-41`. Two files got it right, seven hooks didn't. The `use-project-pipeline` pair is worst: a transient fetch failure **silently removes navigation**, near-undiagnosable from a bug report.

Two more where a button does nothing at all: `app/brain-dump/page.tsx:59` and `:75` (auto-process, "Auto-process all") swallow network errors with a comment and no toast.

### 4.2 Four competing error idioms

`FailureCard` (classified, 9 surfaces), `ErrorState` (raw `err.message` under generic "Something went wrong", `error-state.tsx:31-34`, ~20 surfaces), ad-hoc red `<div>` (`crew/new/page.tsx:139`, `library/new/page.tsx:84`, `env-preflight-card.tsx:117`), and toast-only (every Settings save path, all of `settings/checkpoints/page.tsx`). `env-preflight-card.tsx:117-124` stacks two of them in one card body.

Four of eleven classifiers in `components/failure/classify.ts` have zero call sites: `classifyStopReason :100`, `classifyInvalidReport :105`, `classifyPreflightCheck :110`, `classifyRunStatus :51` (deliberately bypassed — `app/runs/page.tsx:44-53` reimplements it locally because the wire type is a loose `string`). Meanwhile three surfaces hardcode the class a classifier would produce: `env-preflight-card.tsx:124` `"boot"` (with `classifyPreflightCheck` idle for exactly that shape), `studio-surface.tsx:367` `"harness"`, `promote-sheet.tsx:130` `"unknown"`.

Clean bill elsewhere: **zero** `console.log` swallows app-wide; the only two `console.error`s are the Next error boundaries (`app/error.tsx:24`, `global-error.tsx:17`).

### 4.3 Empty / loading / error triads

Complete on 8: `/activity`, `/crew`, `/deck`, `/inbox`, `/objectives`, `/projects`, `/team/[role]`, `/library`. Missing legs:

| Page | load | empty | error | Note |
|---|---|---|---|---|
| `app/projects/[id]/board/page.tsx` | ❌ | per-column | ❌ | Worst. `:66` calls `useTasks/useGoals/useProjects` and **discards both `loading` and `error`** — a failed fetch renders as an empty board |
| `app/projects/[id]/verify/page.tsx` | ❌ | inline `:70` | ❌ | `:30` drops the `loading`/`error` `useJourneys` exposes (`use-journeys.ts:39`) |
| `app/projects/[id]/runs/page.tsx` | ❌ | ✅ `:20` | ❌ | Empty state renders during load — indistinguishable from "no runs" |
| `app/library/[id]/page.tsx` | ❌ | ❌ | ❌ | `:18` destructures `useSkills()` without `loading`; `:43` renders breadcrumb **"Not Found"** — flashes *Not Found* on every cold load. `projects/[id]/layout.tsx:36-47` does it correctly two dirs away |
| `app/projects/[id]/page.tsx` | layout only | inline `:152` | ❌ | |
| `app/settings/checkpoints/page.tsx` | ✅ | ✅ | ❌ | Toast-only errors; a failed list shows "No checkpoints yet" |
| `app/settings/integrations/page.tsx` | ❌ | ❌ | ❌ | All three child cards swallow load errors (`mcp-registry-card.tsx:46`, `handoff-card.tsx:26`) |
| `app/page.tsx` | ✅ `:268` | ❌ | ✅ `:277` | No zero-data state — a fresh install shows a dashboard of zeros |
| `app/projects/[id]/studio/page.tsx` | bare `<p>` `:24` | n/a | ❌ | |
| `components/verification-report.tsx` | bare `<p>` `:150` | n/a | ✅ `:148` | |

Recurring shape: a page destructures a hook and **drops the `loading`/`error` the hook already computed.** Five surfaces do it.

## 5. Information architecture

### What each screen reports vs what you need to decide there

| Screen | Reports | Missing |
|---|---|---|
| Board card (`task-card.tsx`) | kanban dot + verification pill `:149` | **Good — this one is right** |
| Project Overview (`projects/[id]/page.tsx`) | four kanban counts `:55-60`, criterion health `:98`, team, milestones | **Nothing that says what needs *you* now.** `needsYou` exists (`deck-cards.ts:388`) and renders on Home's cards (`page.tsx:766`) but not on the project's own overview. No runs summary, no cost |
| Runs (`app/runs/page.tsx`) | live sessions, history, `QuotaCard` governor window `:235` | Governor sessions-used is the only budget signal; **no per-run cost or token count anywhere** — a run that burned the window looks identical to one that didn't |
| Verify | journeys + pills, task rows + evidence, regression corpus | Stale (§1) and truncated (below) |
| Home | Attention Required `:518-530`, portfolio cards, composer | **A second attention queue** (below) |

### Two numbers for "what needs me"

`providers/deck-queue-provider.tsx:9-24` documents the point of the provider: the rail badge and the Deck header must be two views of one number. Home computes a **third**, independently: `app/page.tsx:161-166` builds `attentionItems` from `useDashboardData`'s `decisions` — decisions only, none of the other five Deck kinds — and labels it *"Attention Required"* with its own count badge `:526`. Home can say "2" while the rail says "7", about the same question, eight pixels apart.

### Verify silently drops a project's evidence past 50 workspace runs

`verify/page.tsx:29` calls `useVerificationRuns()` **with no `taskId`**, then filters by project client-side `:32`. `GET /api/verification-runs` defaults to `limit=50` and with no filter stops after the first 50 directories (`routes/verification-runs/route.ts:7,36`). `hooks/use-verification-runs.ts:8-12` documents this exact bug being fixed *for the taskId path*: *"the unfiltered list truncates at 50 runs, which silently hid a task's evidence once 50+ newer runs existed."* Verify is still on the unfiltered path — once 50 runs exist workspace-wide, an older project's Verify tab goes blank and claims nothing has been through the harness.

### Vocabulary leakage

| Leak | Evidence |
|---|---|
| **"Mission Control"** — the previous product name, still user-facing | `app/layout.tsx:12` browser tab title; `app/page.tsx:299` empty-state H1 *"Welcome to Mission Control"* — while the onboarding hint says *"Welcome to Ligma"* (`layout-shell.tsx:122`). Also `use-connection.ts:9`, `api-client.ts:2`, and `MC_API_TOKEN`/`NEXT_PUBLIC_MC_API_TOKEN` |
| Raw PIDs and task ids in prose | `app/runs/page.tsx:336` `Task: ${session.taskId}`, `:339` `Agent: … · PID: ${session.pid}`; `projects/[id]/runs/page.tsx:39` falls back to `run.taskId` as the row title |
| "kanban" in a Settings-rendered tool description | `settings/integrations/mcp-server-card.tsx:32` |
| Raw `vrun_…` as a heading | `verification-report.tsx:213` — defensible as a provenance code |

Otherwise the copy is genuinely good: one execution vocabulary in `status-pill.tsx`, `not-started → "Todo"` in `kanbanLabels`, and `run-status-badge.tsx:75` explicitly separating a harness malfunction from a product verdict.

## 6. Ranked findings

P0 = actively misleads or loses data · P1 = a workflow needs a page reload to complete · P2 = cost/consistency

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| F1 | P0 | Verify hides a project's evidence once 50 verification runs exist workspace-wide, and claims none exist | `verify/page.tsx:29,32`; `routes/verification-runs/route.ts:7,36`; documented-as-fixed at `use-verification-runs.ts:8-12` | Add `projectId` to the route's filter mirroring the `taskId` branch `route.ts:40`; pass it from the page. One param each side |
| F2 | P0 | Seven hooks turn a fetch failure into a confident empty state; two delete navigation tabs | `use-deck-sources.ts:34`, `use-project-pipeline.ts:26,35`, `use-verification-runs.ts:26`, `use-journeys.ts:66,93`, `record-pinner.tsx:71` | Return `null` (unknown) not `[]` (empty); render absence — the pattern `project-health-board.tsx:39-49` already uses |
| F3 | P0 | `projects/[id]/board` discards `loading` and `error` entirely — a failed fetch renders as an empty board | `projects/[id]/board/page.tsx:66` (grep for `loading\|error\|Skeleton` → zero hits) | Destructure them, mirror `app/board/page.tsx:85,94` |
| F4 | P0 | Undo after deleting an activity event 405s — the toast offers an action the server refuses | `use-data.ts:88,127,168` vs `routes/activity-log/route.ts` (no `PUT`); 405 at `routes/adapter.ts:66-69` | Export `PUT` from the activity-log route, or suppress the undo affordance for that collection |
| F5 | P1 | Answering in Deck **list mode** leaves the rail badge and the page's own "N waiting" stale — the seam the provider claims closed | `deck/page.tsx:115,211` vs `:265` and `layout-shell.tsx:103`; `deck-queue-provider.tsx:9-24` | Call `refetchAll()` (or a targeted card refetch) on the list-mode paths, as deck mode does at `:295` |
| F6 | P1 | Promoting from the Studio refreshes nothing — Health board still says "No criteria frozen yet" | `studio-surface.tsx:621`; `use-project-pipeline.ts:18`; `project-health-board.tsx:31` | Expose `refetch` on both; call from `onPromoted` |
| F7 | P1 | "Prove it" never updates its own row: `onRan` refetches journeys, not runs; `useVerificationRuns` exposes no refetch | `verify/page.tsx:29,59`; `use-verification-runs.ts:13-34` | Return `refetch`; `useSmartPoll` it (~5s) while any listed run is `running` |
| F8 | P1 | Fetch-once collections freeze session state; `useDeckCards` never polls so Home's "needs you" is frozen at load | `use-data.ts:224,229,254,259`; `use-deck-sources.ts:37`; `page.tsx:116,766` | Give `useDeckCards` the 10s `useSmartPoll` `useDecisions` has; give `useProjects` 30s |
| F9 | P1 | `useDesign`'s `EventSource` has no `error` handler — a closed stream stops the Wall silently | `use-design.ts:96-152` (cf. `terminal-panel.tsx:88-90`) | `source.onerror` → `disconnected` flag in the lane header + reopen on backoff |
| F10 | P1 | `TerminalPanel.submit()` has no `catch` — a failed send is an unhandled rejection, input just clears | `terminal-panel.tsx:108-119` | `catch (err) { setError(…) }` |
| F11 | P1 | `/api/runs` polled every 3s with **no visibility gating**, from a backgrounded tab, forever — and twice over on `/runs` | `use-active-runs.ts:8,61`; `app/runs/page.tsx:6,78`; `routes/runs/route.ts:23-53,55-80` | Migrate to `useSmartPoll`; have `/runs` use `useActiveRunsContext` |
| F12 | P1 | Web polls run output on a 2s timer while the SSE endpoint exists and the CLI already uses it | `use-run-output.ts:36` vs `routes/stream.ts:19`, `apps/cli/src/commands/tail.ts:22` | Wire `EventSource` to `/api/runs/:id/output/stream`, keep the poller as fallback |
| F13 | P1 | `.ligma/boot.json` unauthorable from the UI outside adoption — preflight detects, offers no fix | `env/preflight.ts:473-484`; fix kinds `env-preflight-card.tsx:14`; editor exists `adoption/[runId]/page.tsx:236-242` | Second entry point from Verify/Overview reusing the adoption textarea + `bootRecipeSchema` |
| F14 | P2 | Home renders a third, decisions-only "Attention Required" beside a rail badge counting six kinds | `page.tsx:161-166,518-530` vs `layout-shell.tsx:103` | Build it from `useDeckQueue().cards` |
| F15 | P2 | `hooks/use-dashboard.ts` (71 lines) has zero consumers — stale duplicate of `use-dashboard-data.ts` | grep `useDashboard()` → own definition only | Delete |
| F16 | P2 | Every `useDataResource` call site gets its own state and interval; `useAgents` mounted 4+ times per screen | `use-data.ts:11-44`; `task-form.tsx:58`, `task-detail-panel.tsx:241`, `create-project-dialog.tsx:32`, `projects/[id]/page.tsx:22`, `search-dialog.tsx:53-55` | Hoist tasks/projects/agents/goals into one provider beside `DeckQueueProvider` |
| F17 | P2 | `library/[id]` flashes "Not Found" on every cold load | `:18` (no `loading`), `:43`; correct pattern at `projects/[id]/layout.tsx:36-47` | Destructure `loading`, skeleton first |
| F18 | P2 | Four error idioms; four dead classifiers; three hardcoded `failureClass` literals | `classify.ts:51,100,105,110`; `env-preflight-card.tsx:117-124`, `studio-surface.tsx:367`, `promote-sheet.tsx:130` | Use `classifyPreflightCheck` and delete the bespoke div; delete or wire the dead three |
| F19 | P2 | `useVerdictOutcomes` fires one request per journey verdict because the list route omits the verdict | `use-journeys.ts:56-77`; `verification-runs/route.ts:38-41` | Add outcome to the listed manifest |
| F20 | P2 | Six sites still on raw `setInterval` although `useSmartPoll` exists and is better three ways | `use-data.ts:44`, `use-active-runs.ts:61`, `use-dashboard-data.ts:81`, `use-sidebar.ts:45`, `use-daemon-logs.ts:37`, `use-fast-task-poll.ts:18` | Mechanical migration |
| F21 | P2 | Previous product name is still the tab title and empty-state headline | `layout.tsx:12`, `page.tsx:299` vs `layout-shell.tsx:122` | Rename; env vars can follow |
| F22 | P2 | Raw PIDs and task ids in run-row prose | `runs/page.tsx:336,339`; `projects/[id]/runs/page.tsx:39` | Join task title; PID behind detail disclosure |
| F23 | P2 | `useConnection`'s `checkConnection` closes over `checking`, so the 30s interval tears down on every check and the guard reads a stale value | `use-connection.ts:21-22,52,65,74` | Move the guard to a `useRef`; drop `checking` from deps |
| F24 | P2 | Six comments assert their component/route isn't wired; all are | `agents-card.tsx:24-26`, `settings/integrations/page.tsx:10-11`, `terminal-api.ts:6-8`, `workspace-api.ts:7-10`, `library-meta.ts:6-9`, `brand-tokens.ts:18-20` | Delete the lines; replace hardcoded paths with `API_ROUTES` |

## 7. Ten highest-leverage improvements

1. **Filter `/api/verification-runs` by `projectId`** (F1). One query param each side removes silent evidence loss on the surface whose whole job is "is it actually proven?".
2. **One rule for a failed read: absent, never empty** (F2). Seven hooks, one line each. The rule is already written down in this repo twice — this is enforcement, not design.
3. **A cache/invalidation layer for the four always-on collections** (F16, F8, F20). Hoisting tasks/projects/agents/goals into one `useSmartPoll`-backed provider simultaneously kills the duplicate-mount request storm, un-freezes the fetch-once collections, and retires five raw `setInterval`s. Biggest single structural win.
4. **Make every mutation name what it invalidates** (F5, F6, F7). The pattern is already correct in deck mode (`deck/page.tsx:295`); it's the list-mode answer, the promote callback, and the "Prove it" callback that don't. Three call sites.
5. **Move `/api/runs` to `useSmartPoll` and dedupe the `/runs` mount** (F11). Removes the app's only background-tab poller and halves the busiest endpoint's traffic on its own page.
6. **Wire the run-output SSE the CLI already uses** (F12). Endpoint exists, is proven, and the EventSource pattern is in-repo — this is the biggest UX gain per line in the unconsumed list.
7. **Give the Studio SSE an error handler and a visible connection state** (F9). The Wall is the app's most "live" surface and the only stream that can die silently.
8. **Restore the `loading`/`error` legs the hooks already compute** (F3, F17, and the five surfaces in §4.3). Pure deletion of the destructuring that drops them — no new code.
9. **One attention number** (F14). Rebuild Home's "Attention Required" from `useDeckQueue().cards`. The provider was built for exactly this; Home is the one consumer that ignored it.
10. **Delete the dead weight**: `hooks/use-dashboard.ts` (F15), three unused classifiers (F18), six lying comments (F24), the redundant snapshots route. Cheap, and it stops the next reader trusting the wrong file.
