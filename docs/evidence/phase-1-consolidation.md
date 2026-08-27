# Phase 1 — Consolidation: acceptance evidence

Date: 2026-08-11 · Monorepo: `~/ligma` · Tag: `phase-1-consolidate`

Phase 1's contract (build brief §6, merger spec "Acceptance for phase 1"): both imported
histories intact, mission-control's full verify suite green in the new home, ligma-classic's
package tests green, nothing else changed. Harness-format journey evidence begins in Phase 2,
when the harness itself runs inside the monorepo; this phase's own done-when is defined as
git ancestry + green suites, recorded below verbatim.

## 1. Histories intact

- `git log --follow -- packages/runtime/package.json` reaches ligma-classic's
  `cd06f98 initial commit` (pre-merge ancestor).
- `git log --follow -- apps/web/package.json` traverses mission-control's pre-merge commits
  (imported via `git filter-repo --path mission-control --path-rename mission-control/:apps/web/`).
- 129 commits total on `main`; merge commit `88c86d6` joins the two ancestries.

## 2. mission-control full verify suite — green in `apps/web`

| Step | Result |
|---|---|
| `pnpm check` (tsc --noEmit + lint) | pass (exit 0) |
| `pnpm test` (unit) | **504 passed (504)** — matches ancestor count |
| `pnpm test:integration` | **66 passed (66)** — matches ancestor count |
| `pnpm build` (next build) | pass (exit 0) |
| `pnpm test:e2e` (playwright) | **5 passed** (1.7s) |

Raw log: session scratchpad `phase1-tests.log` (counts quoted verbatim: `Tests  504 passed (504)`,
`Tests  66 passed (66)`).

## 3. ligma-classic package tests — green at monorepo root

`turbo run test --filter='./packages/*'`: **10/10 tasks successful**
(@ligma/artifacts, core, exporters, i18n, providers, runtime, session, shared, templates, ui).
Sample: @ligma/core 25 files / 318 tests-run pass; @ligma/runtime 2 files / 19 tests pass.

## 4. Vendored open-design (Apache-2.0, attributed)

- `craft/` (13 rule docs) + `design-systems/` (curated 18-system subset incl. `_schema`,
  `paper`, `shadcn`, `mission-control`, `claude`, aesthetic archetypes).
- Apache-2.0 license text copied to `craft/LICENSE` and `design-systems/LICENSE`;
  vendored-code section added to `NOTICE.md`.

## 5. Deliberate deviations (assumptions surfaced)

- `apps/web` (mission-control) stays a **standalone pnpm workspace** (own lockfile), excluded
  from root workspace globs until Phase 2 extracts the daemon — avoids nested-workspace
  breakage while "nothing else changed" holds.
- ligma-classic's `website/` (docs site) and root marketing screenshots were **not imported**
  (not factory capability; packages/apps/docs/examples/scripts + root config were).
  Its docs moved to `docs/ligma-classic/` to avoid colliding with mission-control's `docs/`.
- Root manifest edits limited to: workspace scope, husky/website script removal, description.
