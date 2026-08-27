# d5 attempt 1 — 2026-08-11, PASS was true against its own data state

This manifest and its `audits/` recorded `nav-crawl` and `seam-audit` both
green on 2026-08-11. That verdict was honest for the checkout it ran
against: at the time, `data/verification-runs/` was empty, so
`/verification/[id]` had no real instance to click through to and correctly
sat in the crawl's data-gate register as "argued, not orphaned"
(`conditionallyReached`).

The blind spot surfaced later, not because this result was wrong, but because
the checkout underneath it changed: the in-flight **d1**/**d2** campaigns
went on to record 7 real runs into `data/verification-runs/` (journeys
`vrun_1786554039301`, `vrun_1786581439197`, plus five more). A route that a
data gate excuses only while it has zero instances stops being excused the
moment instances exist — and nothing in the original `d5` run re-checked
that, because nothing re-ran it. `parity-matrix.md` §D7.4 records the
re-run that first caught this (`result: "FAIL"`, `/verification/[id]`
reported as an orphan) and traced it to a real traversal gap in
`scripts/audit/nav-crawl.ts`'s BFS: `proj_ligma` — the only project with real
journeys and therefore the only one whose Verify tab renders any
`/verification/*` link — never reliably got its own tabs expanded, because
the crawl depended on incidentally discovering `/projects/{id}` from the
`/projects` list page's client-fetched cards, and that fetch sometimes
resolved after the crawl had already moved on (reproduced directly: two
otherwise-identical crawls of the same page disagreed on which links were
present).

The fix (this same `d5` re-run, see `../d5/`) seeds every known project id
into the BFS queue directly from `data/projects.json` instead of waiting to
discover it from a page that may not have rendered yet, and gives every page
a second, shorter chance at `networkidle` before accepting a `load`-only
DOM. It also stopped treating a data gate whose route the crawl now reaches
*directly* as "broken" — reaching a route by real navigation is strictly
better proof than the gate's excuse ever was, so that state is reported as
`supersededGates`, not folded into `brokenGates`.

Preserved here verbatim, unmodified, as the record of what passed and why —
not superseded because it was wrong, but because the world it was evidence
about moved on.
