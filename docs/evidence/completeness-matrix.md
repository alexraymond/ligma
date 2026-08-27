# D6 — Feature-Completeness Matrix

> **FROZEN — 2026-08-12/14, superseded by `docs/parity/feature-track.md` for
> "is this built today".** Two things in this file that look contradictory are
> both true at once: the *rows* marked `complete-pending-live` are closed via
> owner-waiver (top closure note) — Alex chose not to run the live campaign
> chains that would have upgraded them to plain `complete`. The *overall D6
> acceptance criterion* (line ~351, "D6 is not yet closed") is a separate,
> stricter statement: it means those rows still lack the journey-run evidence
> the build brief's own D6 rule asks for, waiver notwithstanding — the waiver
> closes the row for practical purposes, not the underlying evidence gap. Both
> statements were true on 2026-08-14 and neither has been reconciled since;
> see docs/audits/docs-audit-2026-08-27.md finding D20. Row-level content
> below is unedited (see `docs/evidence/parity-matrix.md`'s banner for why);
> superseded narrative specifics (E-seam FAIL now PASS, stale chain-state
> language, a dead `campaign/d4/manifest.json` path) are addressed in the
> addendum at the end of this file.

Date: 2026-08-12 · Branch: `main` · Owner: C3-D6

**Closure note (2026-08-14):** every `complete-pending-live` row below is closed as
**owner-waived** — Alex chose to close D1–D7 acceptance on drill evidence rather than run
the live campaign (DECISIONS.md 2026-08-14). The rows keep their original markers and named
chains on purpose: the waiver is reversible, and a future campaign upgrades them in place.

**Revision 2** — the seventeen `MISSING` cells the first pass found have been built. Every
row below now cites the source *and* the assertion that holds it up; the rows whose remaining
proof is a flow (not code) carry `complete-pending-live` and name their chain, exactly as the
rest of the matrix does. Nothing was closed by argument alone: no cell moved to `waived` in
this pass.

Build brief §7 D6, verbatim: *"Every §6-inventory surface × its listed contents, each cell backed
by a journey run or an explicit, argued waiver. Silent scope-shrink is a failure."*

Row source: UX spec §6's screen inventory, its Contents column parsed into discrete items — one
row per item, in the spec's own order, with nothing merged away. Twelve surfaces, **74 rows**.
Every row's presence was checked by opening the source; every cited test, e2e spec and audit was
opened and read before it was cited. Nothing here is cited by filename.

## Status vocabulary

| Status | Meaning |
|---|---|
| `complete` | Present in source **and** exercised by a cited test, e2e spec, audit rule or campaign journey. The citation names the file **and** the assertion, not just the file. |
| `complete-pending-live` | Present and unit/e2e-covered, but the §7 walkthrough that proves the *flow* is a campaign chain that has not landed green. The chain is named in the row. |
| `waived` | Present in the product but not at the §6-listed address, or deliberately absent. The argument is in the row; deferrals name a roadmap home. |
| `MISSING` | Listed in §6 and absent or stubbed. A failing cell. "Present but stubbed is not complete" — a read-only badge for something the spec lists as an action counts as stubbed. |

## Shared evidence keys

| Key | What it is |
|---|---|
| **E-seam** | `docs/evidence/campaign/d5/audits/d5-seam-audit.json` — chain **d5** re-run 2026-08-13, `"result": "FAIL"`, 224 files scanned (up from 168 at the 2026-08-11 attempt in `campaign/d5-attempt-1/`): `one-status-pill-vocabulary` now **fails** — `components/run-row.tsx:171` speaks the pill vocabulary and paints it itself, a real regression introduced since attempt-1, unrelated to the nav-crawl fix in this re-run. The other three rules still `pass`. |
| **E-crawl** | `docs/evidence/campaign/d5/audits/d5-nav-crawl.json` — chain **d5** re-run 2026-08-13, green: every route surface reached from the rail, `orphans: []`, 8/8 retired-URL redirects, against a freshly built `apps/web` (the 2026-08-11 attempt's traversal bug — `proj_ligma`'s own Verify tab, the only one with real verification-run links, was never reliably visited — is fixed; see `campaign/d5-attempt-1/NOTE.md` and `parity-matrix.md` §D7.4). `/verification/[id]` now reaches by real navigation (`supersededGates`), not by an unexercised data-gate argument. |
| **E-p2** | `docs/evidence/phase-2-daemon-ia.md` — 35 daemon routes ported, CLI transcripts, redirect sweep. |
| **E-p3** | `docs/evidence/phase-3-studio-oracle.md` — Studio, shapes, twin primitives, consumer personas at phase close. |
| **E-p4** | `docs/evidence/phase-4-library-polish.md` — Library, failure cards, onboarding, smoke digest; suites 787/118/126/31. |
| **E-parity** | `docs/evidence/parity-matrix.md` — D7, cited where a capability's parent-parity disposition is already argued there. |

## Campaign chain state at the time of writing

| Chain | State | Bearing on this matrix |
|---|---|---|
| **d1** headless greenfield | not yet recorded | Home composer → discovery → promote-from-brief → consumer verdict → green check. |
| **d2** UI greenfield | not yet recorded | Studio design loop, apply-preview, approve, promote-from-design, capped retry. |
| **d3** brownfield adoption | last recorded attempt **red** (`campaign/d3-attempt-1/manifest.json`, `d3-attempt-2/manifest.json`, both `"result": "red"`); re-run in flight | Adoption card, Knowledge, journeys, baselines. |
| **d4** daily loop | last recorded attempt **red** (`campaign/d4/manifest.json`, `"result": "red"`); re-run in flight | Every Deck row. |
| **d5** seam audit | **red** (`campaign/d5/manifest.json`, `"result": "red"`) — nav-crawl half **green** (traversal bug fixed), seam-audit half **red** on one real, unrelated regression (`run-row.tsx:171`) | E-seam and E-crawl, and the §7 cross-check below. |

No row in this matrix is marked `complete` on the strength of a chain that has not landed. Rows
whose only flow-level proof is d1–d4 carry `complete-pending-live` and name the chain.

---

## 1. Home

> §6: *portfolio cards (health, running, needs-you), kickoff composer with chips, activity ticker*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Home | Portfolio card — **health** (verified %, decaying with staleness, per §5 F3) | yes | Served, not guessed: the join is daemon-side (`apps/daemon/src/harness/health-board.ts:111` (`projectHealthFor`) — the denominator is tasks *carrying acceptance criteria*, so a project with nothing verifiable does not read as 0%), served at `apps/daemon/src/routes/dashboard/route.ts:95`. Rendered through the one pill vocabulary: `apps/web/src/lib/health.ts:28` (`healthPill`), mounted `components/project-card-large.tsx:38`, rendered `:137-149`. Deliberately never green — a percentage is an aggregate with no single verdict to link (§8.8) — and amber via the existing `isStale`. Daemon unit: `apps/daemon/__tests__/health-board.test.ts:114` ("counts only tasks that could ever be verified"), `:134` ("carries the newest verdict behind the passing tasks, so the client can decay it"), `:145` ("has no verified-at when nothing has passed — never an invented timestamp"); route `__tests__/task-verdict-join.test.ts:103`. Web unit: `apps/web/__tests__/d6-surfaces.test.ts:43` ("goes amber and stale once the newest verdict predates recent work"), `:50` ("is never green — a percentage has no single verdict to link (§8.8)"), `:57`. | `complete` |
| Home | Portfolio card — **running** | yes | Green ring + header wash on `isRunning` `project-card-large.tsx:63`, `:65`; inline `RunButton` `:76`; fed by `useActiveRuns` at `apps/web/src/app/page.tsx:97` and passed at `:760`. Reachability E-crawl; page load asserted by e2e `apps/web/e2e/smoke.spec.ts:49` ("homepage loads and shows mission control heading"). | `complete` |
| Home | Portfolio card — **needs-you count** | yes | A grouping of the one queue, never a second count: every `DeckCard` now carries its `projectId` (`apps/web/src/lib/deck-cards.ts:81`, set per kind at `:236`, `:259`, `:276`, `:302`, `:327`), and `needsYouByProject` `:388` groups them; cards belonging to no project fall in `GENERAL_BUCKET` `:386` rather than off the floor. Owned by the same provider the rail badge reads (`apps/web/src/providers/deck-queue-provider.tsx:63`), passed at `app/page.tsx:766`, rendered `components/project-card-large.tsx:140-145`. Unit: `apps/web/__tests__/d6-surfaces.test.ts:245` ("files a decision under the project of the task it is blocking"), `:252` ("puts a card that belongs to no project in the general bucket, never on the floor" — and asserts the buckets sum to the whole queue), `:261`. | `complete` |
| Home | Kickoff composer with chips | yes | `apps/web/src/components/kickoff-composer.tsx:105` (Adopt-a-repo chip), `:114` (project-kind chips), `:129` (the gate that names the missing field *before* submit). Unit: `apps/web/__tests__/product-flows.test.ts:24` ("names the prompt when there is nothing to build from"), `:34` ("names the repo path in adopt mode, and rejects a relative one"), `:48` ("routes each mode to its own entrance"). E2e: `apps/web/e2e/product-flows.spec.ts:50`, `:63`. Flow proof (composer → discovery → brief) is chain **d1**. | `complete-pending-live` (d1) |
| Home | Kickoff composer — design-system chip (§5 F1) | **no, deliberately** | Argued in place at `kickoff-composer.tsx:28-30` and `components/pickers/design-system-picker.tsx:22-23`: the project's shape is unknown at kickoff, so the choice belongs at Studio session start; a disabled chip would be a promise Home cannot keep. Accepted decision: `docs/DECISIONS.md` Phase 3 P3-E ("No design-system chip on the composer (belongs to Studio/Library)"); E-parity **W-12**. §6 lists only "chips", which are present. | `waived` |
| Home | Activity ticker | yes | Recent-activity card `apps/web/src/app/page.tsx:655` (empty state `:664`), linking `/activity`; the full log surface is reached from the rail per E-crawl. | `complete` |

## 2. Deck

> §6: *unified attention queue: decisions, design approvals, contract promotions, verdict spot-checks, criterion challenges; inline evidence; batch + undo*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Deck | Decisions | yes | `apps/web/src/lib/deck-cards.ts:230`; answer path `components/decision-deck.tsx:149` (`patchDecision` + server-granted undo window). Unit: `apps/web/__tests__/product-flows.test.ts:130` ("carries every kind, decisions first and spot-checks last"), `:222` ("leaves an answered decision out of the queue"). | `complete-pending-live` (d4) |
| Deck | Design approvals | yes | Card `deck-cards.ts:246` (thumbnail, version count, critique score, open pins); action `apps/web/src/lib/deck-actions.ts:52` → `POST /api/projects/:id/designs/:id/approve`, no undo by design (approval freezes a signed oracle). Unit: `apps/web/__tests__/deck-interaction.test.ts:245` ("approves a design against the project's own endpoint"), `:256`; `product-flows.test.ts:192` ("only offers a design for approval once it has been critiqued"), `:307`. | `complete-pending-live` (d4) |
| Deck | **Contract promotions** | yes | A preview leaves a record behind and the queue picks it up. Daemon: `apps/daemon/src/studio/pending-promotion.ts:70` (`recordPendingPromotion` — a summary, not the preview, so a Deck card can never offer a confirm on stale bytes), written by `routes/projects/_id/promote/preview/route.ts:36-47` and cleared on confirm (`promote/route.ts:27`) or cancel (`preview/route.ts:53` DELETE). Card: `apps/web/src/lib/deck-cards.ts:26` (sixth kind), built `:266-297` carrying task count, criteria count **with the holdout note** and the spawn estimate inline; ordered `:218` — above a stale brief, below a decision. Fed by `hooks/use-deck-sources.ts` and rendered by the one provider both surfaces read, so the rail badge counts it too. Its single option navigates, and only its: `lib/deck-actions.ts:113` (`navigationFor`), wired `components/decision-deck.tsx:192-196` and `app/deck/page.tsx:143-147` — confirming a promotion *is* the sheet, which is the same argument that keeps designs out of bulk-approve. Daemon unit/route: `__tests__/pending-promotion.test.ts:74`, `:85` ("records nothing for a preview that failed, or proposed no work"), `:92` ("keeps one record per entrance, and keeps how long it has been waiting"), `:105`, `:131`. Web unit: `__tests__/d6-surfaces.test.ts:198` ("carries the counts, the holdout note and the token estimate inline"), `:208`, `:220` ("is the one card whose answer navigates, because confirming IS the sheet"), `:232`. | `complete-pending-live` (d4) |
| Deck | Verdict spot-checks | yes | Card `deck-cards.ts:347`; deterministic 1-in-10 sampling `:104` (`isSpotChecked`, FNV-1a, not random). Unit: `product-flows.test.ts:97` ("is deterministic — the same run is always sampled or never"), `:104` ("lands near one in ten over a realistic run history"), `:200`; `deck-interaction.test.ts:172` ("names what was judged, not its id"), `:178`, `:186`. | `complete-pending-live` (d4) |
| Deck | Criterion challenges | yes | The challenge is the spot-check's second answer, and it lands in the same queue as real work: `deck-actions.ts:76-95` posts a `system` decision whose options are `["Re-run verification", "The criterion is wrong — rewrite it", "Leave it, I was wrong"]`, carrying both the criterion and the ruling as context. Unit: `deck-interaction.test.ts:277` ("files a challenged verdict as real work, carrying the criterion with it"). Note: there is no separate "criterion challenge" card *kind* — the challenge is derived from a spot-check rather than proposed independently. | `complete-pending-live` (d4) |
| Deck | Inline evidence (the card is the context) | yes | Evidence model `deck-cards.ts:41-58` (image, criterion, ruling, facts); rendered on the head card at `components/decision-deck.tsx:386` (criterion), `:396` ("The judge said" — ruling), `:403` (screenshot), `:409` (facts). Two kinds are honestly marked `opensSheet` (adoption review, brief edit) at `deck-cards.ts:292`, `:333`. Unit: `product-flows.test.ts:160` ("gives every card its evidence inline and a link back to what made it"), `:227` ("marks the adoption review as the one card that needs its own sheet"), `:322`. | `complete-pending-live` (d4) |
| Deck | Batch mode at ≥10 | yes | `BATCH_THRESHOLD = 10` in `packages/api/src/deck.ts:22`, consumed by both surfaces: banner `components/decision-deck.tsx:292`, list mode `apps/web/src/app/deck/page.tsx:281` (`data-testid="batch-banner-list"`), select-all `:337`. Unit: `product-flows.test.ts:299` ("produces every kind D4 queues, and enough of them for batch mode"). Bulk actions stay decision-only by argued decision (`docs/DECISIONS.md` Phase 3 P3-E: bulk-approving designs is answering without looking). | `complete-pending-live` (d4) |
| Deck | 10-second undo | yes | `UNDO_WINDOW_MS = 10_000` `packages/api/src/deck.ts:16`; the countdown reads the deadline the **server** granted rather than a local clock (`apps/web/src/lib/undo.ts`, wired `decision-deck.tsx:149`, `:482` `UndoToast`); a card with no server window offers no undo (`:152`). Unit: `deck-interaction.test.ts:73` ("reads the deadline the server returned"), `:78`, `:88` ("counts whole seconds down to the deadline and stops there"), `:97`, `:113`, `:127`, `:136` ("clicking undo twice is not an error"), `:143`. | `complete-pending-live` (d4) |

## 3. Inbox

> §6: *reports, updates, morning smoke digest; mark-reviewed*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Inbox | Reports | yes | Typed message kind with its own styling `apps/web/src/app/inbox/page.tsx:48`; threading + filters `:317`, `:328`. Parent-parity rows MC-088…MC-095 all `works` in E-parity §"Pages · Inbox". E2e reachability `apps/web/e2e/smoke.spec.ts:108` ("navigates to inbox"); E-crawl. | `complete` |
| Inbox | Updates | yes | `inbox/page.tsx:50` (styling), compose type `:581`, compose/reply/forward `:236`, `:196`, `:205`. Same parity rows as above. | `complete` |
| Inbox | Morning smoke digest | yes | `apps/daemon/src/engine/smoke.ts:189` (`composeDigest`), `:206` (`digestBody`, generated *from* the structured digest, never re-parsed from prose), `:253` (one inbox message per window under the file lock), window bounded by the previous digest `:237`. Silence is honest: no runs ⇒ no message `:190`. Structural evidence E-p4 §"Smoke digest (P4-C)". A digest built from *live* journey runs is produced by the smoke schedule during the campaign. | `complete-pending-live` (d1/d3 — first real journey runs in a window) |
| Inbox | Mark-reviewed | yes | Expanding a thread marks its unread messages read `inbox/page.tsx:185`, invoked at `:360`; archive single/all `:190`, `:519`; unread tally `:183`. Parity MC-091, MC-092 `works` (E-parity). The task-side acknowledgement is separate and also present (`components/task-detail-panel.tsx:436` "Mark Reviewed", handler `:323`). | `complete` |

## 4. Project Overview

> §6: *pipeline strip, stage summaries, health board (criteria with staleness decay), quick actions (Prove it, New design, New task)*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Project Overview | Pipeline strip (status **and** navigation) | yes | `apps/web/src/components/pipeline-strip.tsx:44` (`projectStages` — only the stages the project uses are pushed: brief `:55`/`:71`, design `:84`, build `:105`, runs `:117`, verify `:131`), rendered `:148` and mounted for every project surface at `apps/web/src/app/projects/[id]/layout.tsx:54`, `:97`. Unit: `apps/web/__tests__/product-flows.test.ts:336` ("renders no Brief stage for a project that has none"), `:340`, `:351` ("never renders a Design stage for a headless project — even with designs"), `:364` ("says 'adopted' where an adopted project has not used a stage yet"), `:370`. E2e: `apps/web/e2e/smoke.spec.ts:78` ("a project space keeps the rail and offers its four tabs"). | `complete` |
| Project Overview | Stage summaries | yes | `apps/web/src/app/projects/[id]/page.tsx:55` (not-started / in-progress / awaiting-verification / done), rendered `:83`, every number a link to the surface that explains it — no dead ends (§8.3). | `complete` |
| Project Overview | **Health board (criteria with staleness decay)** | yes | The criterion-level view that existed nowhere. Join: `apps/daemon/src/harness/health-board.ts:194` (`criteriaHealthFor` — task contracts *and* journey contracts, at their latest version), served by the additive `GET /api/projects/:id/health` (`routes/projects/_id/health/route.ts:18`). UI: `apps/web/src/components/project-health-board.tsx:28` (table), mounted `app/projects/[id]/page.tsx:98`; the pill and the decay are the existing ones (`RowPill` `:112-131` — an aged `met` reads `stale` with the real timestamp, an unruled criterion reads `unverified`). Held-out criteria are shown and labelled `:76-84`: the holdout is hidden from the *builder*, not the human. Daemon unit: `__tests__/health-board.test.ts:162` ("renders every criterion of the project's contracts, holdout included"), `:170` ("says unverified — never a silent pass — when no verdict has ruled"), `:178`, `:201` ("leaves a criterion unverified when the harness errored — an error is not a defect"), `:218`, `:227`. Route: `__tests__/d6-project-routes.test.ts:99`. | `complete-pending-live` (d1/d3 — needs real verdicts to colour a row) |
| Project Overview | Quick action — **Prove it** | yes | Picks a journey and starts a real panel walk: `apps/web/src/components/project-quick-actions.tsx:41` (`proveIt`) → `lib/journeys.ts:14` (`startJourneyRun`), rendered `:73-91`, mounted `app/projects/[id]/page.tsx:79`. One function, two callers — the journeys panel was refactored onto it (`components/journeys-panel.tsx:12`, `:51`) so the two entrances cannot drift. A project with no journeys says why instead of showing a dead button (`project-quick-actions.tsx:93-96`). Live exercise is a chain, as it is for the Verify row. | `complete-pending-live` (d1/d3) |
| Project Overview | Quick action — **New design** | yes | `components/project-quick-actions.tsx:101` — opens Studio, which is where a design is made and is not a blank page (chat pane `components/studio/studio-surface.tsx:343`). Gated on the shape (`:37` `hasStudio`), so a headless project never renders it — principle 10, absent stages don't render. Distinct from and beside the existing "＋ Design" shape affordance (`app/projects/[id]/page.tsx:66-76`), which is the §4 control for *growing* the stage. | `complete-pending-live` (d2 — first live generation from this entrance) |
| Project Overview | Quick action — **New task** | yes | The same `CreateTaskDialog` Home and Board mount, with the project already chosen: `components/project-quick-actions.tsx:114-121` (`defaultValues={{ projectId: project.id }}`), submitting through the same POST `/api/tasks` shape `:53`. No second create path was written. | `complete` |

## 5. Studio *(UI shapes only — tab absent on headless projects)*

> §6: *chat pane + Wall/focus canvas, progressive render, pins, tweaks panel, critique lane (visible by default), version rail, design-system picker, Promote to build*
> (brief §6 Phase 3 names "pinned comments **with apply-preview**", so the apply-preview is its own row rather than folded into "pins")

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Studio | Chat pane | yes | `apps/web/src/components/studio/studio-surface.tsx:343` (prompt textarea + send). E2e: `apps/web/e2e/studio.spec.ts:38` asserts `getByLabel("Prompt")` visible **and** that the global rail survives inside Studio — the open-design seam this IA exists to close. | `complete-pending-live` (d2 — first live generation) |
| Studio | Wall canvas (default) | yes | `studio-surface.tsx:401` (Wall/Focus toggle), `:477` (`Wall` inside `CanvasViewport` `:475`); component `components/studio/wall.tsx`. Gesture machine ported with its tests: `components/studio/gesture.test.ts:93` ("tap (no movement) → click"), `:98` ("drag right by 100px → pan"), `:127` ("moves the dragged path into the drop target's slot"). E2e: `studio.spec.ts:38` asserts the "Wall" button. | `complete-pending-live` (d2) |
| Studio | Focus canvas with device frames | yes | Viewport table `studio-surface.tsx:57` (desktop/tablet/mobile), `:117` state, `FocusPreview` `:494`. E2e: `studio.spec.ts:38` asserts the "Focus" button. | `complete-pending-live` (d2) |
| Studio | Progressive render | yes | `components/studio/use-design.ts:92` drives `createKeyedThrottle` (`components/studio/throttle.ts:36`); per-card "writing…" pulse `components/studio/wall.tsx:231`, `:237`, fed by `writingPath` `:347`. Unit: `throttle.test.ts:17` ("flushes the first value immediately"), `:23` ("coalesces a burst into one trailing flush carrying the last value"), `:36` ("keys slots independently so parallel files do not strobe together"). | `complete-pending-live` (d2) |
| Studio | Pins (click-to-pin, three-state, live rects) | yes | `components/studio/pin-overlay.tsx:64` (ported from ligma-classic per `:6`), mounted with live rects at `components/studio/focus-preview.tsx:217`; staged chips `components/studio/pin-chips.tsx:41`. Unit: `components/studio/api.test.ts:55` ("stages only pending pins — applied ones are history"), `:66`/`:69` ("each applied pin links to the turn that applied it"), `:73`, `:77`. | `complete-pending-live` (d2) |
| Studio | Apply-preview before send | yes | `pin-chips.tsx:37` (`onRequestPreview`), `:42` (preview state), documented at `:13-19` as byte-for-byte the wire payload (`buildInstructionPreview` / `compilePinInstruction`), not a resemblance; apply path `studio-surface.tsx:187`, wired `:366`. This is the ligma-classic defect the merger exists to fix ("an invisible batch re-generation with no preview"). | `complete-pending-live` (d2 — J2a explicitly requires *seeing* the preview) |
| Studio | Tweaks panel | yes | `studio-surface.tsx:539` (`TweaksPanel`, applied `:197`/`:543`); component `components/studio/tweaks-panel.tsx`. Unit: `api.test.ts:111` ("the tweak schema is advisory"), `:112` ("uses the agent's declaration when there is one"), `:117` ("infers a control from the value shape for an undeclared token"). | `complete-pending-live` (d2) |
| Studio | Critique lane — **visible by default** | yes | Rendered unconditionally at `studio-surface.tsx:549`; no setting gates it. E2e proves the open-design defect is not reproduced: `apps/web/e2e/studio.spec.ts:54` ("the critique lane is visible by default, not behind a setting") asserts the `Critique` region visible **and** `aria-expanded="true"` on arrival. | `complete` |
| Studio | Version rail | yes | `studio-surface.tsx:525`; component `components/studio/version-rail.tsx`. Unit: `api.test.ts:82` ("collects up to two versions"), `:92` ("drops the oldest half on a third pick"), `:100` ("orders before/after by version number, whichever order was clicked"), `:126` ("classifies added, removed, changed and unchanged by fingerprint"), `:145`. Content-addressed snapshots per E-p3 §"Studio backend (C)". | `complete-pending-live` (d2) |
| Studio | Design-system picker | yes | `studio-surface.tsx:380`; the Studio file is a re-export seam (`components/studio/design-system-picker.tsx:16`) onto the one shared component `components/pickers/design-system-picker.tsx:1`, which reads `GET /api/design-systems` rather than a build-time constant. Unit: `components/library/catalog.test.ts:143` ("unwraps the design-system list envelope"), `:149`, `:155`. | `complete` |
| Studio | Promote to build | yes | `studio-surface.tsx:584` (`PromoteSheet`); the same sheet serves both entrances (`components/studio/promote-sheet.tsx:15` documents the brief entrance, mounted `app/projects/[id]/brief/page.tsx:250`). Holdout made legible before it freezes: `apps/daemon/src/studio/promote.ts:74` (`holdoutNote`), split computed once at `:218-244`, governor estimate `:262`. E2e: `studio.spec.ts:67` ("promote is offered, and refuses to run before the design is approved") asserts the button visible **and disabled** pre-approval. Flow proof: promote-from-brief is d1, promote-from-design is d2. | `complete-pending-live` (d1, d2) |

## 6. Board

> §6: *kanban + Eisenhower views; task cards carry design thumbnail + verification pill + run badge; task drawer shows criteria (visible slice), linked design, runs, evidence*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Board | Kanban view | yes | `apps/web/src/app/board/page.tsx:71` (four columns `:32`), project-scoped twin `app/projects/[id]/board/page.tsx`. Parity MC-024 `works`. E2e: `apps/web/e2e/smoke.spec.ts:69` ("section tabs reach the surfaces hung off the rail") and `:78`. | `complete` |
| Board | Eisenhower view | yes | `app/board/matrix/page.tsx:77` (dnd-kit quadrants), project twin `app/projects/[id]/board/page.tsx:79`, `:165`. Parity MC-017…MC-023 `works`. E2e: `smoke.spec.ts:103` ("navigates to priority matrix"). §10 keeps this deliberately. | `complete` |
| Board | Task card — **design thumbnail** | yes | Promote now carries the link onto the task it lands (`apps/daemon/src/studio/promote.ts:303` — `designId` + `designFilePaths`, typed additively at `packages/api/src/types.ts`), and the card consumes it: `apps/web/src/components/design-thumbnail.tsx:59`, mounted `components/task-card.tsx:113`. A **static scaled image** off the same data-URI path the Deck's approval card uses, deliberately not an iframe from the Studio pool — the Wall needs live iframes because it is a canvas you interact with; a board needs a picture (argued in-file `:10-22`). One in-memory promise per (project, design) so a column of cards from one design costs one fetch `:25`, `:53`. A design with no renderable file shows nothing rather than a broken image `:49`. | `complete-pending-live` (d2 — needs a promoted design to render) |
| Board | Task card — **verification pill** | yes | The same `VerificationPill`, on the board: `components/task-card.tsx:74` (`taskVerificationPill`), rendered `:149`. The earlier P3-E N+1 objection is answered server-side rather than argued around — `GET /api/tasks` joins each task to its newest run in one walk of the locker (`apps/daemon/src/routes/tasks/route.ts:217` → `harness/health-board.ts:92` `latestRunByTask`), so fifty cards cost zero extra fetches. Both honesty rules hold: an aged `passed` reads `stale` with the real timestamp, and a `passed` with no run to link stays unlinked and is downgraded by the pill itself (`apps/web/src/lib/health.ts:68-79`). Daemon: `__tests__/task-verdict-join.test.ts:82` ("names the run and when it finished, so a card can link its verdict"), `:89`, `:95` ("is null for a task nothing has verified — never a link to nowhere"). Web: `__tests__/d6-surfaces.test.ts:85` ("links the verdict the tasks list already joined — no second fetch per card"), `:93` ("downgrades an aged pass to stale, carrying the timestamp"), `:102`, `:81`. | `complete` |
| Board | Task card — run badge | yes | `RunButton` in the card header `components/task-card.tsx:98` (blocked-gated `:101`), plus the running ring/wash `:84`, `:89` and the shared pulse on subtask progress `:133-137` (explicitly the one working signal, §7). Parity MC-023 `works`. | `complete` |
| Board | Task drawer — **criteria (visible slice)** | yes | The split lives in the signed contract, so that is what the drawer reads: `apps/web/src/lib/criteria.ts:31` (`criteriaSlice`) over the latest compiled version (`:63` `latestContract`), rendered `components/task-detail-panel.tsx:91`, mounted `:552` — visible criteria listed `:130-135`, holdout counted in the header badge `:123-127` and stated in words `:137` ("N more held out from the builder — the panel tests all M"). The uncompiled case is *said* rather than hidden: a task with no contract is told plainly that nothing is held out `criteria.ts:44`, and a task with no criteria that it will read `waived`. Unit: `apps/web/__tests__/d6-surfaces.test.ts:126` ("shows only what the builder was shown, and states how many it was not"), `:134` ("is honest that an uncompiled list is not a slice at all"), `:142`, `:146`, `:153`. | `complete` |
| Board | Task drawer — **linked design** | yes | `components/task-detail-panel.tsx:150` (`LinksSection`), mounted `:550`: the design the task was built from (`/projects/:id/studio?design=:designId`, from the `designId` Promote now carries) and its runs. The other direction was already live — the verdict link on the header pill `:328` and in the verification section `:73` — so both halves of §8.3 now hold for a promoted task. A task with neither renders nothing rather than a disabled link `:153`. | `complete-pending-live` (d2 — needs a design-promoted task to link) |
| Board | Task drawer — runs | yes | Live run section `task-detail-panel.tsx:662` (`RunOutputSection` `:675`, running pulse `:671`), task runs collected `:253`. Parity MC rows for the detail panel `works` (E-parity). | `complete` |
| Board | Task drawer — evidence | yes | `VerificationSection` `:684`, whose latest-run block links out at `:74` ("Open the full verdict, timeline and evidence"); the header pill carries the verdict href `:423` and downgrades an unbacked `passed` (E-seam rule `green-check-needs-verdict-link`, `pass`). | `complete` |

## 7. Runs

> §6: *daemon status, live streams, preflight, flight recorder, failure-class recovery, interrupt/defer*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Runs | Daemon status | yes | `apps/web/src/app/runs/page.tsx:140` (execution pill / stopped badge), PID `:145`, stats cards `:175-232`, quota `:235`, active sessions `:316`, history `:351`, daemon logs `:269`. Parity: the Launch→Runs re-home, E-p2 §2 redirect 6/8 (`/launch` → `/runs`, pass). | `complete` |
| Runs | Live streams | yes | `components/run-row.tsx:75` ("One run, expandable into its live stream, stoppable on its own"), auto-scroll `:37`, stderr styling `:62`; mounted `app/runs/page.tsx:256`. Daemon side: SSE sibling endpoint `/api/runs/:id/output/stream` (`docs/DECISIONS.md` Phase 2; CLI tail transcript E-p2 §3). | `complete` |
| Runs | Preflight | yes | `EnvPreflightCard` mounted `app/runs/page.tsx:238`; component `components/env-preflight-card.tsx`; blocking-vs-warning classification unit-tested `components/failure/classify.test.ts:82` ("only a blocking fail is a boot failure"), `:86` ("a non-blocking fail is not a card — it does not stop anything"). | `complete` |
| Runs | Flight recorder | yes, **elsewhere** | The flight-recorder timeline exists and works — `components/verification-timeline.tsx:13` ("Flight recorder for a verification run: every persona's steps.jsonl merged"), rendered at `components/verification-report.tsx:346`, i.e. on `/verification/[id]`. Unit: `apps/web/__tests__/verification-ui.test.ts:25` ("turns a >=60s hole in a persona's step stream into an explicit gap row"), `:41`, `:50`. It is **not** on the Runs surface. Argument for waiving the address rather than the capability: a flight recorder is per *verification run* and is only legible beside that run's evidence and verdict; duplicating it on Runs would fork the timeline into two places to keep honest. The Runs↔verdict link is live (`journeys-panel.tsx:158`, `verify/page.tsx:97`), so §8.3 holds. **Roadmap home:** *a build-run flight recorder on Runs* — post-campaign roadmap; today build runs have a stream, not a timeline. | `waived` |
| Runs | Failure-class recovery | yes | One family, one right action per class: `components/failure/failure-card.tsx`, classifier `components/failure/classify.ts`, mounted inline on run history `app/runs/page.tsx:389` with the class derived from **structured status** only (`:51`, and the file's own note at `:45-48`). Unit: `classify.test.ts:15` ("maps deferred to the calm class"), `:19` ("maps failed and timeout to harness — a run malfunction, never a product defect"), `:31` ("only 'error' is a harness class — 'failed' is a real verdict, not a card"). E2e: `apps/web/e2e/failure-onboarding.spec.ts:47` ("an adoption run's structured 'error' status renders the harness failure card") — and the fixture at `:57` states the message is carried as detail, never parsed. E-p4 §"Failure-class recovery (P4-B)". | `complete` |
| Runs | **Interrupt / defer** | yes | Per run, both. Daemon: `POST /api/runs/:id/interrupt` and `/defer` (`apps/daemon/src/routes/runs/_id/interrupt/route.ts:13`, `defer/route.ts:24`) over one `stopRun` (`routes/runs/_lib.ts:60`) that handles both kinds of row the surface lists — `active-runs.json` entries and the engine's own live sessions. The session path is `stopEngine`'s recipe exposed for one session rather than reimplemented: `apps/daemon/src/engine/lifecycle.ts:106` (`interruptSession` — kill the tree, return the task, close the session). Defer writes `resumesAt` on the run and a task-level `deferredUntil` the dispatcher honours (`engine/dispatcher.ts:53` (`isDeferred`), consumed in the dispatchable filter `:582`), capped at the engine's own 60-minute retry ceiling. UI: `components/run-row.tsx:145-168` (the two buttons, and "stopped by you" beside them), `:180-193` (`ConfirmDialog` for both); deferral is drawn in the calm violet vocabulary and reuses `resumeLabel`. A run a human stopped renders **no** failure card, decided from the daemon's structured `interruptedAt` and never from the error message: `components/failure/classify.ts:39` (`classifyRun`), applied `run-row.tsx:134`. Daemon: `__tests__/runs-interrupt-defer.test.ts:100` ("stops the run and says a human did it, rather than leaving it to look like a crash"), `:115`, `:122` ("never re-queues a build that already finished"), `:129`, `:139` ("is the calm state: the run reads deferred and carries a real resume time"), `:157`, `:176`; dispatcher rule `__tests__/task-verdict-join.test.ts:151`, `:155`, `:159`. Web: `__tests__/d6-surfaces.test.ts:275` ("draws no failure card at all — it is not a malfunction of any class"), `:279`, `:283`. | `complete` |

## 8. Verify

> §6: *journeys — browser or API/CLI per shape (Prove it, schedule, last verdict), evidence locker with screenshot pinning (transcript/output pinning for headless), health board, regression corpus*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Verify | Journeys, browser **or** API/CLI per shape | yes | Panel `components/journeys-panel.tsx:95` listing repo journeys with origin (`:107` crawl-proposed vs human); shape-aware panel selection and the HTTP/PTY bridge siblings are engine-side, E-p3 §"Consumer personas (B)" — key test there: headless journey 9/9 with real bridges, real Ed25519 signing and central-only baselines (`apps/daemon/__tests__/integration/headless-journey.test.ts`). E2e: `apps/web/e2e/product-flows.spec.ts:150` asserts the Journeys heading against the dogfood project. | `complete-pending-live` (d1 consumer panel, d3 browser panel) |
| Verify | Prove it | yes | `components/journeys-panel.tsx:153` (one button per journey row, disabled while a run is in flight `:150`). E2e: `product-flows.spec.ts:150` asserts `Prove it` visible on the dogfood project's journeys and states plainly that clicking it is deliberately not done in e2e (it would spawn a real run). Live exercise is a chain. | `complete-pending-live` (d1/d3) |
| Verify | **Schedule** | yes | The badge became the control: `components/journeys-panel.tsx:108-129` (preset `<select>` with **Off** as a real option, not an absence) → `lib/journeys.ts:41` (`setJourneySchedule`) → the PATCH that already existed (`apps/daemon/src/routes/projects/_id/journeys/_jid/route.ts:22`). A cron a human wrote by hand that matches no preset stays selectable rather than being silently rewritten to Off (`journeys-panel.tsx:123-127`). Unit: `apps/web/__tests__/d6-surfaces.test.ts:289` ("offers off as a real option, not an absence"), `:293`. | `complete` |
| Verify | Last verdict | yes | Per journey: execution pill + verification pill with the verdict href `journeys-panel.tsx:134-148`, last-run line and evidence link `:159-162`; a harness `error` reads `unverified` rather than as a defect, and an aged `passed` reads `stale` (`:140-142`, `:98`). Per task: `app/projects/[id]/verify/page.tsx:91` with the same downgrade rule. Backed by E-seam rule `green-check-needs-verdict-link` (`pass`, note: "VerificationPill downgrades an unbacked `passed` and gates its link"). | `complete-pending-live` (d1/d3 — first real verdicts) |
| Verify | Evidence locker with **screenshot** pinning | yes | `components/evidence-pinner.tsx:29`, mounted on the screenshot lightbox `components/verification-report.tsx:442`; the pin compiles into a structured instruction and the user picks its disposition — feedback on the fix task or a new task (now `components/pin-composer.tsx:69`, `:80-92`, `:107-114`), with honest wording for a journey run that has no task (`pin-composer.tsx:109`). Coordinate model (0..1 over a PNG rather than @ligma/runtime's live-DOM overlay) is an accepted argued waiver: `docs/DECISIONS.md` Phase 3 P3-E, restated in-file at `evidence-pinner.tsx:14-26`. | `complete-pending-live` (d1/d2 — F6 pin-to-instruction round trip) |
| Verify | **Transcript / output pinning for headless** | yes | The pin became a union rather than a second feature: `packages/api/src/evidence-pins.ts` grows `ImageEvidencePin` and `RecordEvidencePin` (a line or a JSON field, no coordinates — a JSONL line has none), with `pinLocation` writing the provenance line for both and `normalizeEvidencePin` reading pre-union pins as images. Store and route follow (`apps/daemon/src/engine/evidence-pins.ts:36`, `routes/projects/_id/evidence-pins/route.ts:20-42` — an image pin still *needs* its coordinates, enforced by a refine). UI: `components/record-pinner.tsx:29` (numbered lines, click a line number to pin it), mounted over each persona's transcript at `components/verification-report.tsx:423`, replacing the bare anchors. The compiled-instruction preview — the ligma-classic defect this merger exists to fix — is now one implementation shared by both pinners (`components/pin-composer.tsx:52-66` — the same `compilePinInstructions` the daemon hands the prompt builder, `:69` the save), so "pin it" cannot come to mean two things. Proof it reaches the builder: `apps/daemon/__tests__/product-repo.test.ts:223` pins a **record** on a headless run's `records/GET-health.json` and asserts the block lands in the fix task's prompt. | `complete-pending-live` (d1 — F6 round trip on the shape D1 walks) |
| Verify | Health board | yes | The task half of the Verify surface is it: `app/projects/[id]/verify/page.tsx:75-108` lists every task that has been through the harness with its pill, attempt count, staleness decay (`:81`, tip carrying the real timestamp `:94`) and evidence link. Staleness unit-tested: `apps/web/src/lib/staleness.test.ts:7` ("is false with no timestamp — never invent staleness"), `:16`, `:21`, `:28` ("carries the actual timestamp, not just the word 'stale'"). Note the shortfall recorded on the Project Overview row: this is a *task*-level board, not the criterion-level one §6 asks Overview for. | `complete-pending-live` (d1/d3 — needs real verdicts to populate) |
| Verify | **Regression corpus** | yes | Writer, reader, route and UI, into the slot `baselines.ts:35` reserved. **Writer:** `apps/daemon/src/harness/probes.ts:55` (`recordProbes`) files one probe per criterion a `failed` verdict ruled against — journey/task, criterion text from the contract, the failing step's own cited record, and the origin verdict — under the same cross-process lock discipline as its neighbours `:86-91`. Called where verdicts land: `harness/run-journey.ts:425` and `run-verification.ts:362`. A `passed` files nothing, and so does an `error`: a harness malfunction proved nothing about the product and must never enter a corpus of product defects (principle 12). **Reader:** `harness/probes.ts:29` + `GET /api/projects/:id/probes` (`routes/projects/_id/probes/route.ts:14`). **UI:** `apps/web/src/components/regression-corpus.tsx:27`, mounted `app/projects/[id]/verify/page.tsx:116`, each row linking the verdict that caught it. **Replay is "Prove it" on the probe's journey** (`regression-corpus.tsx:55-68`) — no bespoke engine, so the second answer is comparable to the first through the panel and the baseline comparison that already exist; a probe from a task verdict says so instead of offering a button that would do nothing `:118-121`. Unit: `apps/daemon/__tests__/probes.test.ts:89`, `:96` ("carries the failing step's own record, the criterion's wording and the origin verdict"), `:106` ("files nothing for a passed verdict, and nothing for a harness error"), `:115` ("is idempotent: re-processing one verdict does not double the corpus"), `:122`, `:128`; route `:147`, `:161`. | `complete-pending-live` (d1/d2 — the corpus fills from real failed verdicts) |

## 9. Knowledge

> §6: *`.ligma/` rendered: boot recipe status, project.md, quirks, baselines browser*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Knowledge | Boot recipe status | yes | `apps/web/src/app/projects/[id]/knowledge/page.tsx:110` heading, path `:112`, status badge `:115`/`:330`, structured failure card on a bad recipe `:119` (class from `classifyBootStatus`, unit-tested `components/failure/classify.test.ts:98`), recipe facts `:128-133`. E2e: `apps/web/e2e/product-flows.spec.ts:150` asserts the "Boot recipe" heading renders for the dogfood project. | `complete-pending-live` (d3 — an *inferred* recipe for a repo ligma did not build) |
| Knowledge | project.md | yes | `knowledge/page.tsx:167` heading, empty-state and body `:168-176`. E2e: `product-flows.spec.ts:150` asserts the "project.md" heading. | `complete` |
| Knowledge | **Quirks** | yes | `.ligma/project.md` gains one conventional section and the product maintains it. **Structural, not prose-guessing:** the daemon writes the heading, so slicing the document at it is addressing a container we own — `apps/daemon/src/store/ligma-dir.ts:240` (`QUIRKS_HEADING`), `:260` (`readQuirks`, heading-scoped, stopping at the next heading), `:272` (`appendQuirk`, into the section, creating it once). Everything inside is rendered verbatim; nothing is parsed out of it. Payload: `ProjectKnowledge.quirks` (`packages/api/src/knowledge.ts`), filled `ligma-dir.ts:319`. Append route targets it: `routes/projects/_id/knowledge/append/route.ts:19` (`section: "quirks"`). **Adoption's confusion log lands there** rather than in a dated section of its own (`apps/daemon/src/engine/adopt-repo.ts:506-519`), so the first UX audit and every later quirk accumulate in one place. UI: `app/projects/[id]/knowledge/page.tsx:184` (own card) with an append affordance `:191-219` → `addQuirk` `:80`. Unit: `apps/daemon/__tests__/ligma-dir.test.ts:231` ("is empty for a repo that has recorded none"), `:236`, `:244` ("stamps who learned it, so a quirk is never anonymous"), `:249` ("adds later quirks to the section instead of a second one"), `:258` ("stops at the next heading — a later dated note is not a quirk"), `:266`, `:276`. Route: `__tests__/d6-project-routes.test.ts:132`, `:144`, `:152`. | `complete-pending-live` (d3 — a real crawl's confusion log filling it) |
| Knowledge | Baselines browser | yes | `knowledge/page.tsx:278` heading, `:37` (`useBaselines`), empty state that says what would fill it `:285`, rows `:289`. Central-only storage is enforced and tested engine-side (E-p3 §A key test: a recursive repo walk finding **zero** baseline files in-repo). E2e: `product-flows.spec.ts:150` asserts the "Baselines" heading. | `complete-pending-live` (d3 — first characterization baseline) |

## 10. Library

> §6: *master–detail catalogs: design systems (live preview pane), skills, craft rules; same picker popover reused in all composers*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Library | Design systems with live preview pane | yes | `apps/web/src/app/library/page.tsx:35-83`; detail pane `components/library/design-system-detail.tsx`. E2e proves the whole cell: `apps/web/e2e/library.spec.ts:30` ("design systems: master list, live preview, DESIGN.md and swatches") asserts >10 options served by the daemon (not a build-time constant), a **sandboxed** iframe (`sandbox=""`) carrying the package's own `components.html`, the token swatch `--accent #c96442` read from `tokens.css`, and DESIGN.md rendered as markdown; `:81` covers the specimen fallback for a package with no `components.html`. | `complete` |
| Library | Skills | yes | `app/library/page.tsx:145` (`SkillsCatalog`, `useSkills` `:146`). E2e: `library.spec.ts:122` ("skills: the existing catalog is re-homed into the same shell") and `:114` ("an agent's assigned skill links into the library entry"). Retired `/skills` URLs still redirect — E-p2 §2 redirects 4/8 and 7/8, 8/8 pass. | `complete` |
| Library | Craft rules | yes | `app/library/page.tsx:28` (`fetchCraftRules`), served read-only with path safety by `apps/daemon/src/routes/craft-rules/route.ts:9`. E2e: `library.spec.ts:98` ("craft rules: the vendored rulebooks render as markdown"). Unit: `components/library/catalog.test.ts:165` ("unwraps the craft-rule list envelope"). | `complete` |
| Library | Master–detail shell (one, shared) | yes | `components/library/master-detail.tsx`, used by all three catalogs (`app/library/page.tsx:70` and siblings). E2e: `library.spec.ts:23` ("renders all three catalogs as tabs"), `:55` (filter narrows and keeps a valid selection), `:68` (arrow keys move the selection). Unit: `catalog.test.ts:34`, `:58` ("clamps at both ends rather than wrapping"), `:79` ("keeps a selection that survives the filter"), `:83`. | `complete` |
| Library | One picker popover reused in all composers | yes | One component: `components/pickers/design-system-picker.tsx:1`; the Studio path is a re-export seam, not a copy (`components/studio/design-system-picker.tsx:16`, with `:11-13` recording that the old build-time `CATALOG` was deleted rather than left to drift). "All composers" is exactly one composer today — Studio session start (`studio-surface.tsx:380`) — because the Home composer's chip is the argued waiver on the Home row (W-12). No second implementation exists anywhere. | `complete` |

## 11. Crew

> §6: *agent registry, instructions, skill links*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Crew | Agent registry | yes | `apps/web/src/app/crew/page.tsx:119` (list + status filter `:126`, per-agent active-task counts `:130`), cards `:45-110`, create at `/crew/new` reached by a real anchor (the Phase 2 orphan finding, fixed in `adda77f`; E-p2 addendum, and E-crawl now `orphans: []`). | `complete` |
| Crew | Instructions | yes | `app/team/[role]/page.tsx:222` ("Instructions (System Prompt)" `:225`), edit `:231`/`:237-241`, save `:118-122`. | `complete` |
| Crew | Skill links | yes | Linked skills resolved `app/team/[role]/page.tsx:98`, add/remove `:148`, `:153`; count on the crew card `app/crew/page.tsx:107`. E2e: `apps/web/e2e/library.spec.ts:114` ("an agent's assigned skill links into the library entry") — the link is followed and the Library entry asserted, so this is a live cross-surface link, not a rendered id. | `complete` |

## 12. Settings

> §6: *governor config, backends, daemon schedule, appearance*

| Surface | Content item | Present? | Evidence | Status |
|---|---|---|---|---|
| Settings | **Governor config** | yes | `apps/web/src/components/governor-card.tsx:36`, mounted `app/settings/page.tsx:384`: window hours, window ceiling, reserve percent and the kill switch, all editable. The derived **reserve floor** is computed with the daemon's own formula (`governor-card.tsx:26` `reserveFloorOf`, mirroring `apps/daemon/src/engine/quota-governor.ts:123`) so the card cannot show a number the engine disagrees with. Saved through the existing PUT, which already validated the block (`store/validations.ts:356-368`) and merges `execution` field-by-field; the form spreads `config.execution` first `:63-66`, so it cannot drop fields it has never heard of. **It takes effect without a restart, and that is asserted rather than assumed:** `cachedConfig()` keys its memo on the config file's mtime+size (`engine/config-cache.ts:21-36`) and the governor reads through it (`quota-governor.ts:253`) — `apps/daemon/__tests__/governor-config-route.test.ts:97` ("takes effect without a restart — the governor reads config live") makes the PUT and then reads the governor's own view with **no** cache invalidation. Also `:86`, `:105`, `:111`, `:116` ("refuses numbers outside the bounds the daemon itself enforces"). The file kill switch survives and is explained on the card `:184-187`: a stop that must outlive a compromised browser tab is not a button — `quota-card.tsx:10-11`'s argument, kept. Web unit: `__tests__/d6-surfaces.test.ts:301`, `:306` ("always leaves the daemon one spawn, unless the reserve is an explicit 100%"), `:311`. | `complete` |
| Settings | Backends | yes | Backend mode `app/settings/page.tsx:116`, `:140`, `:162`; failover backend `:119`, `:165`; per-backend binary path and model `:124-127` (moved out of hand-edited JSON in the D7 pass — E-parity W-42/W-43 and `docs/DECISIONS.md` D7 parity pass). | `complete` |
| Settings | Daemon schedule | yes | Schedule card `app/settings/page.tsx:250`; toggle `:180`, edit `:186`/`:200`, add `:207`, remove `:214`. E-parity W-5 leans on exactly these lines as the reachable equivalent of open-design's orphaned Automations page. | `complete` |
| Settings | Appearance | yes, **elsewhere** | The theme control is the rail footer's `ThemeToggle` (`components/theme-toggle.tsx:14`, mounted `components/app-sidebar.tsx:99`) — dark/light/system, cross-tab-synced by `next-themes` (`components/theme-provider.tsx`). Parity MC-155 and OD-095 are both `works` in E-parity on these exact lines. Waived as an *address* difference, not a capability gap: appearance is one control, it is reachable from every surface (§8.1 holds), and moving it into Settings would make it *less* reachable. **Roadmap home:** if appearance ever grows past one toggle (density, studio paper on/off), it gets a Settings card then. | `waived` |

---

## §7 status & progress language — cross-check

§7 is not a screen, so it gets its own section rather than rows in the tables above. Every claim
here is backed by chain **d5**. As of the 2026-08-13 re-run, d5's nav-crawl half is green and its
seam-audit half is red on one regression (`components/run-row.tsx:171`, `one-status-pill-vocabulary`)
— noted on the two rows below whose citation is that rule; the other seam-audit rules, and the
zero-orphan row, are unaffected.

| §7 claim | Evidence | Status |
|---|---|---|
| **One verification pill vocabulary**: `unverified · in-review · passed · failed · waived · stale` | Single implementation `apps/web/src/components/status-pill.tsx:32-74` (all six states, `:38`, `:44`, `:50`, `:56`, `:62`, `:68`). E-seam rule `one-status-pill-vocabulary` passed at 168 files (2026-08-11); the 2026-08-13 re-run (224 files) now fails it — **not on these states**: the violation is `components/run-row.tsx:171` speaking the *execution* words "running, deferred" and painting them itself. E-p4 records five rogue pill sites routed through the canonical one before the rule first went green. | `complete` |
| **One execution vocabulary**: `queued · running · deferred · done · error` | `status-pill.tsx:162` (type) and `:164-171` (the one table). Reused in the compact variant rather than re-coloured: `StatusChip` `:204-215` draws from the same two tables ("a variant is not a second vocabulary"). Same rule as above — **now failing**: `components/run-row.tsx:171` paints "running, deferred" itself instead of going through `status-pill.tsx` (regression since the 2026-08-11 attempt, `docs/evidence/campaign/d5/audits/d5-seam-audit.json`). Flagged here, not re-adjudicated: this pass owns the D5/nav-crawl citations, not the D6 status column. | `complete` |
| **`deferred` is calm, not alarming** | Violet, `Timer` icon, no destructive styling `status-pill.tsx:168`; deferred runs sink below actionable ones `components/run-row.tsx:198-202`; classified as its own calm class `components/failure/classify.ts` + unit `classify.test.ts:15` ("maps deferred to the calm class"); `resumesAt` carried as structured data (E-p4 §P4-C). | `complete` |
| **`error` (harness) visually distinct from `failed` (product)** | E-seam rule `error-distinct-from-failed`: **pass**, with the two class strings recorded verbatim in the artifact — failed `"border-destructive/60 text-destructive"` vs error `"border-amber-600/60 text-amber-700 dark:text-amber-500"`. Unit: `classify.test.ts:19`, `:31` ("only 'error' is a harness class — 'failed' is a real verdict, not a card"). Carried through the data model too (FIX-PLAN D3; `VerificationVerdict.outcome: "error"`), and rendered honestly on the journey row (`journeys-panel.tsx:105-107`: an `error` reads `unverified`, never as a defect). | `complete` |
| **A green check never renders without a verdict link** | E-seam rule `green-check-needs-verdict-link`: **pass**, note "VerificationPill downgrades an unbacked `passed` and gates its link". Implementation `status-pill.tsx:96-102` — an unbacked `passed` becomes an amber "passed (no verdict)" with the tooltip "treat as unproven". Per-criterion results obey the same downgrade `:139-146`. Applied at every call site: verify tasks `verify/page.tsx:91`, journey rows `journeys-panel.tsx:136`, task drawer `task-detail-panel.tsx:421`. | `complete` |
| **One shimmer / progress primitive** | E-seam rule `one-shimmer-primitive`: **pass**, note "1 definition site(s) found". | `complete` |
| **Working-status everywhere the work is represented — same pulse** | Wall card `components/studio/wall.tsx:237` (`animate-pulse` dot beside "writing…"); task card `components/task-card.tsx:133-137` (explicitly "the same pulse the running pill and the skeletons use — no bespoke sweep"); running pill `status-pill.tsx:189` (pulsing dot in place of an icon); journey row inherits it through `ExecutionPill state="running"` at `journeys-panel.tsx:134`. Covered by the shimmer rule above; the *journey-row* pulse has no direct assertion of its own — it is structural reuse, not an independent implementation. | `complete` |
| **One error model — failure-class cards with a single primary action, everywhere an agent can fail** | `components/failure/failure-card.tsx` + `classify.ts`, exempted by name in the E-seam pill rule as "failure-class vocabulary (UX spec §7), one error model". Eight classifiers, each unit-tested (`classify.test.ts:14`, `:30`, `:38`, `:46`, `:55`, `:65`, `:74`, `:81`, `:97`); every classifier reads a **structured status**, never prose — `auth` is deliberately left unwired until a structured signal exists (E-p4 §P4-B: "regex over CLI output refused"). E2e: `failure-onboarding.spec.ts:47`. | `complete` |
| **Zero orphan surfaces (§8.1, the rule §7's vocabulary rides on)** | E-crawl: every route surface reached from the rail, `orphans: []`, 8/8 redirects. The two Phase 2 anchor orphans (`/crew/new`, `/library/new`) were fixed in `adda77f`; the data-gated `/verification/[id]` family closed once real verification runs existed (E-p2 addendum → E-crawl). | `complete` |

---

## The seventeen — closed

All seventeen are built. The diagnosis each one started from is kept beside what landed, because
the point of this matrix is that a cell cannot quietly stop being a gap.

| # | Surface | Cell | Was | Is now |
|---|---|---|---|---|
| M-1 | Home | Portfolio card health (verified %, staleness decay) | The card read tasks and goals only; the staleness primitive it needed existed and was never called from Home. | A daemon-side join serves verified-over-verifiable per project; the card renders it in the one pill vocabulary, amber when stale, never green. |
| M-2 | Home | Portfolio card needs-you count | Attention was computed workspace-wide (then `app/page.tsx:155`, now `:161`), never per project, never on the card. | Every Deck card carries its `projectId`; `needsYouByProject` groups the one queue, so the card and the rail badge cannot disagree. |
| M-3 | Deck | **Contract promotions** | Not one of the five `DeckCardKind`s; a contract awaiting confirmation was invisible to the attention queue. | A sixth kind, fed by a pending-promotion record the preview leaves behind and the confirm clears. Its one option navigates, because confirming *is* the sheet. |
| M-4 | Project Overview | Health board (criteria with staleness decay) | No criterion-level view existed anywhere in the product; staleness was applied per task/journey only. | `criteriaHealthFor` joins the project's contracts to their latest ruling; the Overview renders a row per criterion with the pill, the decay and the holdout marked. |
| M-5 | Project Overview | Quick action "Prove it" | Only inside the Verify tab's journeys panel. | A journey picker and a real panel walk on Overview, through the same `startJourneyRun` the Verify panel now calls. |
| M-6 | Project Overview | Quick action "New design" | "＋ Design" added the *stage*; creating a design still meant navigating into Studio. | A quick action into Studio — where a design is made — rendered only where the shape has one. The shape affordance stays, beside it. |
| M-7 | Project Overview | Quick action "New task" | No create-task control on Overview. | The same `CreateTaskDialog` Home and Board mount, with the project already chosen. |
| M-8 | Board | Task card design thumbnail | `designFilePaths` survived promotion into the task but no board component consumed it. | Promote carries `designId`/`designFilePaths` onto the task; the card renders a static scaled preview — not an iframe from the Studio pool. |
| M-9 | Board | Task card verification pill | The board — where a human scans for done-ness — was the one surface without the product's soul-vocabulary. | The pill is on the card, fed by a `lastVerdict` join the tasks route does in one walk of the locker. The N+1 objection is answered, not argued around. |
| M-10 | Board | Task drawer criteria (visible slice) | Criteria rendered as a count and an undifferentiated blob; the visible/holdout split lived only on the Promote sheet. | The drawer reads the signed contract: visible criteria listed, held-out counted and stated, uncompiled said out loud. |
| M-11 | Board | Task drawer linked design | No design link on a task that came from an approved design — a §3 "no dead ends" violation. | A links row: the design it was built from, and its runs. The verdict half was already live. |
| M-12 | Runs | Interrupt / defer | No route or control stopped, interrupted or deferred a single run; only the daemon-wide switch and the kill-switch file existed. | Two routes over one `stopRun`, reusing `stopEngine`'s per-session recipe; buttons behind a confirm, deferral calm and honoured by the dispatcher, and a stopped run draws no failure card. |
| M-13 | Verify | Journey schedule | Read-only badge. The daemon could persist a schedule; no UI ever called the PATCH. | A preset dropdown with Off as a real option, calling the PATCH that already existed. A hand-written cron stays selectable. |
| M-14 | Verify | Transcript / output pinning for headless | `EvidencePinner` was image-only; on a headless project — the shape D1 exercises — F6 had no surface at all. | The pin is a union: a record pin points at a line, not a coordinate. Both pinners share one compiled-instruction preview. |
| M-15 | Verify | Regression corpus | A path helper and a "later" comment. No writer, no reader, no route, no UI, no argued waiver. | A failed verdict files probes into the reserved slot; a route and a Verify section read them back. Replay is "Prove it" on the journey — no bespoke engine. |
| M-16 | Knowledge | Quirks | The word appeared nowhere in the codebase; `ProjectKnowledge` had no such field. | A conventional `## Quirks` section the payload returns structurally, the append route targets, adoption writes into, and Knowledge renders with an append affordance. |
| M-17 | Settings | Governor config | The numbers that ration Alex's own allocation were editable only by hand-editing JSON; brief §3 forbids exactly this. | A Settings card for window, ceiling, reserve and kill switch, computing the floor with the daemon's own formula — and a test proving a save is live without a restart. |

## Waiver list

Four waivers, each argued in its row, each with the capability actually present somewhere in the
product. None is a deferral of absent work except where a roadmap home is named. Three occupy a
row of their own; the fourth (W6-4) is an implementation-detail waiver recorded inside the Verify
evidence-pinning row, which is why the row-count says 3 `waived` and this list has 4 entries.

| # | Surface | Cell | Argument in one line | Roadmap home |
|---|---|---|---|---|
| W6-1 | Home | Design-system chip on the composer | Shape is unknown at kickoff; the picker belongs at Studio session start. Pre-existing accepted decision (`DECISIONS.md` Phase 3 P3-E; E-parity W-12). | none needed — deliberate, not deferred |
| W6-2 | Runs | Flight recorder | Built and tested, but per *verification run* and only legible beside that run's evidence (`verification-timeline.tsx:13` → `/verification/[id]`); duplicating it on Runs forks one timeline into two truths. | *build-run flight recorder on Runs* — post-campaign roadmap |
| W6-3 | Settings | Appearance | One control, present in the rail footer where it is reachable from every surface (MC-155 / OD-095 both `works`); moving it into Settings reduces reachability. | *a Settings appearance card if it ever grows past one toggle* |
| W6-4 | Verify | Evidence pin coordinate model (0..1 over a PNG, not the live-DOM overlay) | A verdict screenshot has no DOM, so `@ligma/runtime`'s overlay has no value proposition here. Pre-existing accepted decision (`DECISIONS.md` Phase 3 P3-E), upgrade path documented in-file. | *live-DOM evidence snapshots*, if evidence ever stops being a PNG |

## Pending-live list — rows whose flow proof is a campaign chain

| Chain | Rows waiting on it |
|---|---|
| **d1** headless greenfield | Home kickoff composer · Studio Promote to build (brief entrance) · Verify journeys (consumer panel) · Verify Prove it · Verify last verdict · Verify evidence screenshot pinning · **Verify transcript pinning** · **Verify regression corpus** · Verify health board · **Overview health board** · **Overview Prove it** · Inbox morning smoke digest |
| **d2** UI greenfield | Studio chat pane · Wall canvas · focus canvas · progressive render · pins · apply-preview · tweaks panel · version rail · Promote to build (design entrance) · Verify evidence screenshot pinning · **Verify regression corpus** · **Board task-card design thumbnail** · **Board task-drawer linked design** · **Overview New design** |
| **d3** brownfield adoption | Verify journeys (browser panel) · Verify Prove it · Verify last verdict · Verify health board · **Overview health board** · **Overview Prove it** · Knowledge boot recipe status · Knowledge baselines browser · **Knowledge quirks** · Inbox morning smoke digest |
| **d4** daily loop | All nine Deck rows: decisions · design approvals · **contract promotions** · verdict spot-checks · criterion challenges · inline evidence · batch at ≥10 · 10-second undo |
| **d5** seam audit — nav-crawl **green**, seam-audit **red** (one regression, `run-row.tsx:171`) | Every §7 cross-check row above; the zero-orphan guarantee under all twelve surfaces |

d3 and d4 have each recorded a red attempt already (`campaign/d3-attempt-1`, `d3-attempt-2`,
`campaign/d4`); their re-runs are in flight. **Thirty-four** distinct rows carry
`complete-pending-live` — nine more than in revision 1, because nine of the cells built in this
pass are code that is unit-covered and route-covered but whose *flow* is a chain, and marking them
`complete` on that basis would be the exact substitution this matrix exists to catch. The chains,
not this document, are what turn them green.

## Statistics

Counted off the twelve surface tables above, not asserted.

| Status | Rows | Share | Revision 1 |
|---|---|---|---|
| `complete` | 37 | 50.0% | 29 |
| `complete-pending-live` | 34 | 45.9% | 25 |
| `waived` (argued in place) | 3 | 4.1% | 3 |
| **`MISSING`** | **0** | **0.0%** | **17** |
| **Total rows** | **74** | 100% | 74 |

| Surface | Rows | complete | pending-live | waived | MISSING |
|---|---|---|---|---|---|
| Home | 6 | 4 | 1 | 1 | 0 |
| Deck | 8 | 0 | 8 | 0 | 0 |
| Inbox | 4 | 3 | 1 | 0 | 0 |
| Project Overview | 6 | 3 | 3 | 0 | 0 |
| Studio | 11 | 2 | 9 | 0 | 0 |
| Board | 9 | 7 | 2 | 0 | 0 |
| Runs | 6 | 5 | 0 | 1 | 0 |
| Verify | 8 | 1 | 7 | 0 | 0 |
| Knowledge | 4 | 1 | 3 | 0 | 0 |
| Library | 5 | 5 | 0 | 0 | 0 |
| Crew | 3 | 3 | 0 | 0 | 0 |
| Settings | 4 | 3 | 0 | 1 | 0 |
| **Total** | **74** | **37** | **34** | **3** | **0** |

Deck is 8 rows again rather than 7+1: the contract-promotions row is a real row now, not a
counted absence. No surface has a failing cell.

§7 status-language cross-check: **9 of 9 claims backed**, all by chain d5 plus unit tests — d5's
nav-crawl half is green; its seam-audit half re-ran red on one regression (`run-row.tsx:171`,
noted on the two affected rows above), the other three seam-audit rules and the zero-orphan
guarantee unaffected.

## Assessment

**No §6 cell is absent or stubbed.** The seventeen code gaps revision 1 found are built, each with
unit or route coverage cited by assertion above, and the four that touched non-negotiable rules
rather than merely listed contents are the four to look at hardest:

- **M-9** — the one status vocabulary now renders on the board, and the N+1 that kept it off was
  answered with a server-side join rather than an argument for leaving it off.
- **M-11** — a promoted task links the design that made it, closing the §8.3 dead end in the
  direction that was missing.
- **M-15** — "evidence over claims" gained the corpus it was missing, and gained it *without* a
  second execution path: a probe is re-asked by the same panel and the same baseline comparison
  that produced it, or the second answer would not be comparable to the first.
- **M-17** — the numbers that ration Alex's own allocation are on screen, and the claim that a
  change is live is asserted rather than assumed (`governor-config-route.test.ts:97` reads the
  governor's own view after a PUT with no cache invalidation).

D6 is **not yet closed**, and the reason is now an evidence gap rather than a code gap. Thirty-four
rows carry `complete-pending-live`: they are built and covered, but the flow that crosses them is a
campaign chain (d1–d4) and three of those four have not landed green. Marking them `complete` on
unit coverage alone would be exactly the substitution — test counts standing in for journey runs —
that the build brief §6 forbids and that this product exists to make impossible.

What changed structurally: the Deck's queue is the only place attention is counted, and it is now
counted per project from the same array; verification state is joined once, server-side, so any
surface that needs it can render the same pill without inventing a second source; and the two
things a headless project had no surface for — pinning its evidence and keeping its failures — have
one each.

---

## Superseded narrative (addendum, added 2026-08-27 — not a row edit)

The prose in this file's E-seam/chain-state sections describes a state that
DONE.md later corrected:

- **E-seam FAIL → PASS.** Line 53 and the "d5 seam audit red" language (lines
  67-68) record the 2026-08-13 re-run's `run-row.tsx:171` regression as a
  live `FAIL`. `docs/evidence/DONE.md` (D5 row) records the actual resolution:
  **seam-audit PASS 4/4** after the finding was argued as an exemption
  (logic words + an action button, not a second status pill), zero new
  exemptions beyond that one. Read DONE.md's D5 row as current; this file's
  E-seam narrative as the mid-campaign state it was written at.
- **Chain-state language ("d1 not yet recorded", "d4 red", "d5 red")** is
  superseded wholesale by `docs/evidence/DONE.md`, which records the closed
  state of every chain (D1-D7) as of 2026-08-14.
- **Dead path:** `campaign/d4/manifest.json` (line 67) does not exist in this
  checkout's evidence tree; see `docs/evidence/DONE.md`'s own D4 citation for
  the live evidence path.
