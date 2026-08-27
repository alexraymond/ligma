# docs/ index

50+ files, no single audience — this table is the map. "Status" says whether
a doc describes the product as it is today (**living**), is a dated snapshot
kept for its citations (**frozen**), or is a working artifact from a past
build wave (**archive**, under `docs/history/`).

Two things you actually want are answered elsewhere and just linked from
here: **what can Ligma do today** → [`parity/feature-track.md`](parity/feature-track.md)
(the living register — not the frozen matrices below); **how do I configure
it / use the CLI** → [`configuration.md`](configuration.md).

| Doc | Purpose | Audience | Status |
|---|---|---|---|
| [`architecture.md`](architecture.md) | Current-state component diagram, verification pipeline, project lifecycle | Newcomer, maintainer | living |
| [`configuration.md`](configuration.md) | Env vars, `daemon-config.json` reference, backend setup, CLI | Operator | living |
| [`ligma-build-brief.md`](ligma-build-brief.md) | The build constitution — principles the product is built to | Builder agents, maintainer | living |
| [`DECISIONS.md`](DECISIONS.md) | Append-only decision log | Maintainer | living |
| **parity/** | | | |
| [`parity/feature-track.md`](parity/feature-track.md) | **The living upstream capability register** — the current answer to "does it have X" | Next upstream review | living |
| [`parity/open-design-capabilities.md`](parity/open-design-capabilities.md) | Parent capability inventory (open-design) | Parity auditors | living, commit-pinned |
| [`parity/mission-control-capabilities.md`](parity/mission-control-capabilities.md) | Parent capability inventory (mission-control) | Parity auditors | living, commit-pinned |
| **evidence/** — frozen acceptance/parity record, citation-heavy | | | |
| [`evidence/DONE.md`](evidence/DONE.md) | Entry point to the closed-out acceptance campaign | Owner, future campaigns | frozen |
| [`evidence/DONE-UX.md`](evidence/DONE-UX.md) | Entry point to the closed-out UX rebuild | Owner | frozen |
| [`evidence/parity-matrix.md`](evidence/parity-matrix.md) | Row-by-row capability parity vs. open-design, at freeze | Owner, auditors | **frozen — see banner; current answer is `parity/feature-track.md`** |
| [`evidence/completeness-matrix.md`](evidence/completeness-matrix.md) | Seam/completeness matrix, at freeze | Owner, auditors | **frozen — see banner** |
| [`evidence/phase-1..4-*.md`](evidence/) | Per-phase build evidence | Owner | frozen |
| `evidence/phase-7-*.png` | Orphan screenshots from the later studio-parity push — no `phase-5`/`6`/`7` markdown doc owns them (the phase numbering here doesn't continue the phase-1..4 evidence docs above; it's a separate push's own internal numbering) | Owner | frozen, unowned |
| **reviews/** | | | |
| [`reviews/ui-ux-review.md`](reviews/ui-ux-review.md) | Adversarial UI/UX review | Maintainer | frozen — closed |
| [`reviews/execution-flow-review.md`](reviews/execution-flow-review.md) | Adversarial engine/dispatcher review | Maintainer | **frozen — see banner, most items landed since** |
| [`reviews/mechanics/findings.md`](reviews/mechanics/findings.md), [`reviews/walkthrough/findings.md`](reviews/walkthrough/findings.md) | Raw defect inventories feeding the review above | Maintainer | frozen — see closure banner |
| **design/** | | | |
| [`design/UX-REBUILD-BRIEF.md`](design/UX-REBUILD-BRIEF.md), [`design/UX-REDESIGN.md`](design/UX-REDESIGN.md) | UX redesign proposal | Maintainer | frozen (implemented) |
| [`design/ux-rounds/`](design/ux-rounds/) | Persona review rounds on the redesign | Maintainer | frozen |
| [`design/ligma-classic-studio-map.md`](design/ligma-classic-studio-map.md) | Studio-port survey from the legacy app | Maintainer | frozen |
| **superpowers/specs/** | | | |
| [`superpowers/specs/`](superpowers/specs/) | Canonical dated product/architecture/UX specs from the 2026-08-11 merger and 2026-08-26 studio-parity push | Maintainer, agents | frozen (design-time); see `architecture.md` for current state |
| **ligma-classic/** | | | |
| [`ligma-classic/LIGMA-ARCHITECTURE.md`](ligma-classic/LIGMA-ARCHITECTURE.md) | Architecture of the **legacy Electron app** only — no longer in this repo, it lives in `ligma-classic` | Desktop maintainers | frozen, scoped at top |
| **history/** | | | |
| [`history/README.md`](history/README.md) | Index of archived working artifacts (build contracts, mission-control-era design docs) | Nobody, by design | archive |
| **Vendored library docs** (outside `docs/`) | | | |
| [`../craft/README.md`](../craft/README.md), `../craft/anti-ai-slop.md` | How this repo's craft rules are consumed (manifest → studio critic) | Skill/design-system authors | living |
| [`../skills/README.md`](../skills/README.md), `../skills/AGENTS.md` | How the skill catalog is consumed (`/api/skill-catalog` → Library page) | Skill authors | living |
| [`../design-systems/README.md`](../design-systems/README.md) | The vendored design-system catalog + how it's consumed | Design-system authors | living |
| [`../design-templates/AGENTS.md`](../design-templates/AGENTS.md) | Template conventions + how exporters/slide-nav consume them | Template authors | living |

Not indexed above: `data/ai-context*.md` (generated agent-context snapshots,
regenerated by `apps/daemon/scripts/generate-context.ts` — not hand-edited,
and not banner-marked as generated in the file itself; a code fix, out of
this pass's reach) and `.ligma/project.md` (self-adoption ground truth for
this repo, read by the adoption pipeline).

**Scripts worth knowing about** (each is self-headered — read the top of the
file for what it does and how to run it; this is just the pointer a `docs/`
search wouldn't otherwise surface): `pnpm smoke` (`scripts/smoke-models.ts`,
model-availability smoke test), `scripts/acceptance/drill-d*.ts` (the
zero-token acceptance drills cited throughout `docs/evidence/`),
`scripts/audit/nav-crawl.ts` and `scripts/audit/seam-audit.ts` (the two
scripts behind the E-crawl/E-seam evidence keys in the parity/completeness
matrices).

**Investigated, deliberately not changed — root lint coverage (X12).** Root
`biome.json` ignores `apps/web/**`, `apps/daemon/**`, and `packages/api/**`
entirely, so `pnpm lint` (now also the CI "Lint & Typecheck" job) never
checks those trees. Tested removing the three ignores against a scratch copy
of the config: **1413 errors, 105 warnings across 613 files** surface
immediately — fixing that is a source-code cleanup spanning most of the
product, not a config edit, and well outside a docs-hygiene pass (and would
have broken the very CI gate this pass just added). Left as-is; a future
pass should either fix the trees incrementally or scope the ignore more
narrowly than "the whole app."

**Known but not fixed here (needs a code change, not a doc change):**
`data/ai-context.md` and `data/ai-context-readable.md` receive identical
generator output, but only `-readable` is git-tracked (`.gitignore` ignores
the other) — so the committed snapshot can silently contradict the live one.
Fixing this means either untracking `-readable` or changing what the
generator writes, both outside `docs/**`/`.gitignore`'s dogfood-block scope
this pass touched (see `docs/audits/docs-audit-2026-08-27.md` D23).

**Flagged, needs a maintainer call (D36).** The vendored rule bodies under
`craft/`, `design-systems/`, `skills/`, and `design-templates/` still speak
in the upstream product's own voice (first-person "we"/product-name framing
carried over from `nexu-io/open-design`). Rewording them to Ligma's voice
intersects the vendoring/attribution policy in `NOTICE.md` and the
`docs/audits/docs-audit-2026-08-27.md` D36 finding — whether to reword,
and how much of that is "vendored content" the attribution policy protects,
is a maintainer decision, not a docs-hygiene edit.

**Flagged, decision pending (X11).** The tracked `data/daemon-config.json`
ships with automation on by default (crons, 4 parallel agents) — a
README-following newcomer spawns scheduled model sessions on their own quota
against the committed dogfood data. See `docs/audits/codebase-audit-2026-08-27.md`
X11 — left as-is; not changed by this pass.
