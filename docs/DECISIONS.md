# Decision log — cards for Alex

Running log of product-affecting calls made during the merge build. Format: what was decided,
why, and whether it needs your sign-off (⚠) or is informational parity/hygiene (ℹ). Anything ⚠
is reversible on your word — say so and it flips.

## Phase 1

- ℹ **Design-system subset vendored (18 of 153).** `_schema` + aesthetic archetypes
  (default, minimal, clean, paper, bento, mono, dashboard, application, editorial,
  warm-editorial, brutalism, neobrutalism, glassmorphism) + exemplars (claude, shadcn,
  linear-app, mission-control). Criteria: cockpit + studio moods (UX spec §9) and archetype
  breadth over brand mimicry. ⚠ if you want specific brands added/removed — one `cp` each.
- ℹ **ligma-classic `website/` not imported** (docs site for the old product, not factory
  capability); packages, desktop app, docs, examples, scripts, root config all imported with
  history. Recoverable from `~/ligma-classic` any time.
- ℹ **`apps/web` stayed a standalone workspace during Phase 1** ("nothing else changed"),
  unified into the root workspace at the start of Phase 2 with suites re-verified green.

## Phase 2

- ℹ **Daemon = Express 5 on 127.0.0.1:4477** (open-design's proven daemon shape), engine +
  HTTP in one process; JSON stores moved to repo-root `data/`; all 35 API routes ported with
  byte-identical shapes; SSE added only as a *sibling* endpoint (`/api/runs/:id/output/stream`).
- ℹ **Stop-semantics parity restored.** One-process design initially made "stop daemon" kill
  the API that serves the UI — the parent never behaved that way. Now `{action:"stop"}` stops
  the engine loop only; the API keeps serving; CLI `daemon:stop` remains the ops-level
  process kill. (Parity ratchet, not a new behavior.)
- ℹ **Biome scoped to the ligma-classic packages.** The ported mission-control trees keep
  their own gates (tsc strict + eslint); reformatting 12k ported lines would have destroyed
  the port's byte-equivalence. ⚠ only if you want one style enforced repo-wide later — that
  is a one-shot `biome check --write` + config change.
- ⚠ **`packages/api` carries ~120 lines of runtime logic** (route-path interpolator, quadrant
  helpers, deck ordering) because daemon and web must agree on "actionable" — the alternative
  was duplication. Flag if you want a stricter types-only split.

## Standing (from your pinned defaults, not re-decided)

Kickoff composer prompt-first with "Adopt a repo" chip · brief edits after contract
compilation flag dependents stale (Deck card), never invalidate · verdict spot-checks sample
1-in-10 into the Deck · `.ligma/` is the in-repo knowledge dir name.

## Tech notes (non-blocking, tracked)

- ✅ SSE `end` frame on `/api/runs/:id/output/stream` no longer repeats the final chunk's
  lines (P4-C): same `RunOutputChunk` shape, `lines: []`. The CLI printed only `output`
  events, so nothing changed for it.
- ℹ `@ligma/api` is not plain-Node-ESM loadable (extensionless relative imports, no
  `"type": "module"`); fine under tsx/Next (all current consumers). Revisit if a compiled
  consumer appears.

## Phase 3

- ℹ **Ratified: `AcceptanceContract.designBaseline` (optional) added to the signed contract
  payload.** An oracle whose reference artifact can change after signing is not frozen; the
  design baseline must live inside the signature. Optional field — pre-existing contracts
  verify unchanged.
- ℹ **Daemon dropped `@ligma/providers`** (pre-existing strict-mode error in its validate.ts
  under daemon tsconfig); the studio provider resolves the `claude` binary directly and the
  agent loop speaks to it via an in-process MCP bridge. `packages/providers` remains intact
  for the desktop app; unify later if worth it.
- ⚠ **Highest-risk untested surface: the live Claude generation path** (MCP bridge, SDK
  stream mapping, binary resolution) — every studio test stubs the provider. First real
  exercise happens in the D2 acceptance run; expect fixes there.
- ℹ **P3-E argued waivers (accepted):** evidence pins use positioned 0..1 coords over the
  verdict screenshot rather than @ligma/runtime's live-DOM overlay (a PNG has no DOM — the
  overlay's value proposition is absent; upgrade path documented in-file). Bulk Deck actions
  stay decision-only (bulk-approving designs is answering without looking); design approval
  has no undo (it freezes a signed oracle). No design-system chip on the composer (belongs
  to Studio/Library).
- ℹ Defects found+fixed by P3-E: stale-cache "Project not found" on fresh projects;
  unnamed radiogroups in discovery forms (a11y).
- ℹ Tracked for Phase 4: "＋ Design" affordance on Overview (project grows a face later);
  project hard-delete leaves central data/projects/<id>/ dir behind.
- ℹ **Phase 3 gate sequencing:** the §6 phase gate ("walkthroughs pass as recorded journey
  runs") runs ONCE, inside the acceptance campaign (D1–D7), not twice — live LLM walkthroughs
  are the single most quota-expensive operation in the build and the governor budget is
  Alex's own allocation (principle 9). Structural evidence tagged `phase-3-structural`;
  task #3 stays open until the campaign's signed runs land.

## D7 parity pass (2026-08-12)

The capability-parity matrix's 33 REDUCED rows were worked: 19 fixed in code with tests, 14
waived with an argument and a roadmap home, none left failing. Full disposition in
`docs/evidence/parity-matrix.md` §D7.1. One card needs you:

- ⚠ **BYOK: accept CLI-only, or schedule a provider path on the daemon?** (matrix W-43 —
  OD-063, OD-162 … OD-165.) Open-design let a user with no local CLI run everything against an
  API key. Ligma's backends are CLI-subscription by design — principle 9 prefers your own
  `claude -p`, the governor meters a subscription window rather than a dollar balance, and the
  daemon dropped `@ligma/providers` deliberately (Phase 3 above). BYOK is a second execution
  path, not a missing screen: key storage, SSRF guard, model catalog, its own failure taxonomy.
  **Done meanwhile:** the provider configuration ligma *does* have — per-backend binary path and
  model — moved out of hand-edited `daemon-config.json` onto the Settings card, because brief §3
  forbids load-bearing configuration the product never shows. Say the word and W-43 flips either
  way; until then it is the only ⚠ waiver in the matrix.
- ℹ **Two reductions were already yours and are now cited rather than re-asked:** single-critic
  critique (merger spec contribution map, "critique theater (single-critic first)" — matrix W-40)
  and three CLI backends (merger spec *Out of scope*, "adapter breadth beyond claude/codex/gemini"
  — W-41). No action needed; they were failing the matrix only because the approval had never
  been written into the row.
- ℹ **Skill staging isolation (OD-080) is waived on a structural finding, not a deferral:** ligma
  never hands a spawn a skill *directory* — skill bodies are inlined into the prompt from
  `skills-library.json` — so there is nothing to stage. The residual risk (a builder editing the
  source bundle) has a roadmap home as a deny rule beside the existing oracle deny rules.
- ℹ **Campaign hygiene rule:** live personas may adopt any local path (the product working
  as designed on a single-user machine). Two real checkouts got written during d3 attempts
  (this repo's own `.ligma/` was "re-adopted" by a persona; ligma-classic received its
  adoption `.ligma/`). Both reverted after the run; the conductor now cleans adopted-repo
  litter between attempts. Booted instances already pin data, products and ports into
  throwaway dirs.

## 2026-08-12 — ⚠ Campaign blocked: subscription usage credits exhausted

d2 attempt 3: every persona spawn returned 429 `seven_day_overage_included`.
The sequence is stopped (evidence in d2-attempt-3); nothing can run until the
weekly window resets or credits are added. **Needs Alex.**

Defect found in the same attempt, queued for fix before the next run: a
persona panel invalidated by 429s produced a `failed` verdict. Principle 12
says env causes are `error`, never `failed` — the panel runner sees
`api_error_status: 429` and should short-circuit the run to `error` with
causeKind `rate-limit` + resumesAt instead of letting the fail-default judge
rule on an empty transcript.

## 2026-08-13 — ✅ Alex: no more expensive live tests; finish by porting

Directive (via /goal): continue building per DONE.md's deliverables, do NOT
run expensive tests inside the app, and get all the features built by
copying them from the reference repos. Effect: the live D-chain campaign is
stood down (d1/d4/d2 were queued behind the governor gate); verification
shifts to the zero-token tiers (unit/integration, drill mode, audits);
DONE.md will state per D exactly which evidence is live-signed (d3, d5) and
which is drill/wiring-verified with live proof deferred by owner decision.
The BYOK card (W-43) remains open but is mooted while live runs are paused.

## 2026-08-13 — ⚠ Four gated port families need Alex (from the D7 waiver re-triage)

1. **BYOK wiring** (OD-063, OD-162–165): the UI code is already vendored in
   the legacy desktop app (now in the `ligma-classic` repo); wiring it into the
   daemon is M effort but changes the product's
   execution model (CLI-subscription vs dual path). Extends the open W-43 card.
2. **Composio connectors / Orbit digest** (OD-102, OD-108): needs a third-party
   account + API key.
3. **Media-generation artifact kinds** (OD-026, OD-043–045, OD-093): a second
   product line requiring paid external generation APIs.
4. **Desktop pet** (OD-018, OD-129–132): portable, near-zero product value —
   build only if wanted.
Also on record: five spec-approved reductions (single critic, 3 backends,
design-system chip, onboarding modal) stay closed unless Alex reopens them.

## 2026-08-13 — ℹ Lineage-string rule: evidence-transcript exemption

The `rg -i 'open.codesign' == LICENSE-only` check now also hits one d3
persona transcript (naive-user-2, attempt 1): the persona was exploring the
ADOPTED repo, whose own docs mention open-codesign, and the transcript is a
verbatim evidence record. Scrubbing signed-run evidence would trade a
lineage nicety for evidence integrity, so the check's exemption set is:
LICENSE + files under docs/evidence/campaign/*/journeys/*/personas/. No
ligma-authored content references open-codesign anywhere.

## 2026-08-13 — ✅ Data root moves outside the checkout (owner directive: no artifact pollution)

Write-path audit confirmed mission-control's old disease is structurally
present: DATA_DIR defaults to <repo>/data and ENVS_DIR is hardcoded to
<repo>/.envs, so product evidence, central per-project stores, contracts,
pty sessions and FULL WORKTREES of other repos land inside ligma's folder.
Decisions, all downstream of Alex's directive:
1. DATA_DIR default → ~/.ligma/data (LIGMA_DATA_DIR stays the override; the
   dogfood instance pins it back to <repo>/data explicitly).
2. ENVS_DIR → ~/.ligma/envs by default with its own LIGMA_ENVS_DIR override;
   never inside any checkout.
3. Contracts are store data, never git-tracked: contract-store's "tracked in
   git" docstring claim is retired (tonight's .gitignore change had already
   de facto reversed it); the committed dogfood/test fixtures move under
   apps/daemon/__tests__/fixtures as regression fixtures.
4. Wizard-authored design systems write to DATA_DIR/design-systems (served
   as an overlay by the catalog route); the vendored tracked catalog stays.
5. Twin-primitives untouched: baselines/probes stay central and
   builder-denied — only where "central" physically resolves changes.

## 2026-08-14 — ✅ D1/D2/D4 acceptance closed on drill evidence (owner decision)

Asked directly how to close tasks #3 (Phase 3) and #5 (D1–D7 acceptance),
Alex chose "close on drill evidence" over running the one live campaign
that would mint signed verdicts. Effect:
1. D1, D2, D4 are CLOSED at drill tier: real boot/daemon/dispatch proven
   (drill-d1 7/7, drill-d2 12/12, drill-d4 5/5), live-signed verdicts
   permanently waived by owner. The tier vocabulary is unchanged — drill
   still never upgrades to acceptance; the owner waived acceptance itself.
2. D6's 34 pending-live citation rows and D7's 4 pending-live rows close
   as owner-waived, matching the 83 argued/automatic waivers already in
   the parity matrix.
3. The waiver is reversible: every red attempt, drill, and preflight gate
   is preserved, so a future live campaign can mint the verdicts and
   upgrade these rows without rework.

## 2026-08-27 — ℹ Docs-audit corrections (numbers this log cited have drifted)

Informational only — no reversal, just pointing at what changed since the
entries above were written. Historical entries are left as written (they
were true when logged); don't treat them as current:

1. **"35 API routes" (Phase 2 entry)** — the registry has grown; current
   count is whatever `grep -c ': "/api/' packages/api/src/routes.ts` returns.
   Don't restate a fixed number in a doc again — point at that file.
2. **"18 of 153" design systems (Phase 1 entry)** — the vendored catalog is
   152 packages today (`ls design-systems | grep -v _schema | grep -v README
   | grep -v LICENSE | wc -l`); `NOTICE.md` already says 152 correctly,
   `design-systems/README.md` said 151 (fixed alongside this entry).
3. See `docs/evidence/parity-matrix.md` and `docs/evidence/completeness-matrix.md`
   for their own freeze banners — the same "don't trust an old headline
   number" caveat applies there.

## (undated, Phase 2) — ℹ History-linkage incident — recovered from an orphaned file

Migrated 2026-08-27 from `apps/web/docs/DECISIONS.md` (a stray duplicate decision
log left behind by the Phase 2 IA re-home, unreferenced from anywhere —
docs-audit X16). Original entry, verbatim:

- ℹ **History-linkage incident (phase 2).** Two conductor doc commits, made while agents had
  renames staged, swept those staged adds in — so the IA re-home's renames landed with adds
  and deletes in separate commits, breaking `git log --follow` at the move boundary for the
  re-homed pages (content intact; pre-move history still present under the old paths).
  Rule adopted: nobody commits with a non-empty foreign staging area — `git diff --cached
  --name-only` is checked before every conductor commit.
