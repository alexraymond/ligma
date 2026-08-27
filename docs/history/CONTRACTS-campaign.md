# Acceptance Campaign Contracts — D1–D7, ligma inspects itself

The factory ships only when it passes its own inspection (brief §7). This contract pins how.

## The stack under test

A **built ligma in an ephemeral env**: worktree cut from this repo, booted via the dogfood
`.ligma/boot.json`, with its own throwaway `LIGMA_DATA_DIR` and its own governor. The panel
(personas, judge, signing) runs from the dev checkout against that booted instance. The booted
instance spawns its own builders (real `claude -p`) through ITS governor. Both governors draw
on the same subscription — double-gated; the reserve floor protects Alex's allocation at both
levels (principle 9, no exceptions).

## Journey decomposition (wall-time honesty)

A real product build takes tens of minutes; a persona session cannot idle through it. Each D
therefore runs as a CHAIN of recorded journey runs plus engine-recorded interludes, linked in
DONE.md — every link signed, no link asserted without its record:

- **D1 headless greenfield** — J1a `d1-compose-promote` (browser persona: composer →
  URL-shortener prompt → discovery confirms headless → NO Studio tab visible → promote from
  brief showing tasks/criteria/journeys/token estimate → confirm; zero CLI). Interlude: the
  booted instance's own build runs (governor-gated; its run records + verdicts are exported
  as evidence). J1b `d1-consume` (naive-developer in a clean env follows the product's
  README and exercises the API — this is the booted instance's OWN consumer-panel verdict,
  exported). J1c `d1-green-check` (browser persona: the task's green check renders WITH a
  verdict link and the link resolves to the evidence).
- **D2 UI greenfield** — J2a `d2-design-loop` (prototypes stream onto Wall; critique lane
  visible without touching settings; pin a comment; SEE the apply-preview; apply; approve;
  promote from design). Interlude: build. J2b `d2-verify-retry` (browser persona walks the
  built app; judge scores against the design baseline; on failure the builder gets the
  judge's reasoning and passes within the attempt cap — the retry chain is engine-recorded).
- **D3 brownfield** — J3 `d3-adopt` (adopt a real repo ligma did not build — use a real
  public small app cloned locally; boot inferred, confirmed once; exploratory persona
  proposes journeys; characterization baseline lands centrally, never in-repo; Verify and
  Knowledge arrive populated).
- **D4 daily loop** — J4 `d4-deck` (with decisions + a design approval + a stale-brief flag
  + a verdict spot-check queued: everything answered from Deck cards alone — inline
  evidence, no navigation, batch mode at ≥10, undo works).
- **D5 seam audit** — deterministic, no LLM: `scripts/audit/nav-crawl.ts` (zero orphans —
  the verification-run instance now exists, closing the Phase 2 data-gated cell) +
  `scripts/audit/seam-audit.ts` (NEW: one status-pill vocabulary — no rogue pill
  implementations; one shimmer primitive — single definition site; no green check without
  verdict link — component-level assertion; `error` styled distinctly from `failed`).
- **D6 completeness matrix** — every §6 surface × listed contents, each cell citing a
  journey run / e2e / audit record or an argued waiver. Assembled from evidence, not memory.
- **D7 parity matrix** — every row of `docs/parity/*-capabilities.md` (332 MC + 171 OD)
  mapped to its ligma equivalent with evidence or an explicit argued waiver (auto-waive only
  MULTI-USER rows; "later" rows get a roadmap home). Any row where ligma does less than the
  parent is FAILING unless Alex approved the reduction by decision card.

## Workstreams

| WS | Scope | Owns |
|---|---|---|
| C1 campaign machinery (opus) | ephemeral booted-ligma env harness (worktree + boot + throwaway data dir + teardown); the seven D-journey definitions in `.ligma/journeys/`; `scripts/audit/seam-audit.ts`; a campaign runner (`scripts/acceptance/`) that executes a chain (journey runs + interlude monitors + evidence export from the booted instance's data dir into the dev locker) and REFUSES to mark a chain green on any missing link; stub-mode rehearsal of all seven chains end to end | `scripts/acceptance/**`, `scripts/audit/seam-audit.ts`, `.ligma/journeys/d*.json`, campaign types if needed (additive) |
| C2 live execution | run the chains for real, one at a time, supervised by the conductor; fix-forward loops on failures (each fix goes to the owning surface, campaign re-runs the broken link only) | evidence in `data/projects/<ligma>/…` + `docs/evidence/campaign/**` |
| C3 matrices (sonnet ×2 after C2) | D6 and D7 documents assembled from the recorded evidence; every waiver argued in place | `docs/evidence/{completeness-matrix,parity-matrix}.md` |
| Conductor | DONE.md; final gate; decision cards to Alex for any parity reduction discovered | `docs/evidence/DONE.md` |

Rules unchanged (staging, trailers, floors). The campaign runner must never fabricate,
regenerate, or edit evidence files — it copies what the harness signed, or it fails the link.
