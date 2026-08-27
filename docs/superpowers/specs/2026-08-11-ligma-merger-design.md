# Ligma: The Merged Autonomous App Factory

**Status:** approved in discussion (Alex, 2026-08-11); repo strategy locked: new monorepo
**Sources:** mission-control (this repo), ~/ligma (Alex's, MIT), ~/open-design (nexu-io, Apache-2.0, vendored with attribution)

## Thesis: design-as-oracle

The three projects are one pipeline cut at different points. ligma/open-design own idea → prototype; mission-control owns build → verify → learn. The merge point is the differentiator: **the approved prototype becomes the frozen acceptance contract.** Design in the studio, approve a prototype, and that artifact — layout, flows, tokens — is the baseline the harness verifies the real app against. Design isn't documentation; it's the test.

**The design stage is optional, not a gate** (Alex, 2026-08-11): many projects built with ligma have no UI — APIs, CLIs, libraries, daemons. For those, the same rule holds with different artifacts: the contract compiles from acceptance criteria + journey baselines alone, and verification runs through consumer personas (naive-developer following the README in a clean env, API/CLI journeys, saboteur) over HTTP/PTY siblings of the browser bridge. The general principle is approved-artifact-as-oracle; the design baseline is its richest instance, not its definition. UX details in the product spec §3.

Full loop: Idea → Brief (discovery) → Prototype (studio + critique) → Contract (signed, frozen, holdout) → Build (tasks, daemon, governor) → Verify (personas + judge + evidence) → Ship (exports, PR checks) → Learn (journeys, baselines, regression corpus, project knowledge).

## Architecture: one daemon, many faces

```
ligma/                       pnpm + turbo monorepo
├── apps/
│   ├── daemon/              THE PRODUCT: dispatcher, governor, harness,
│   │                        ephemeral envs, sessions, contracts, journeys.
│   │                        HTTP + SSE API (open-design's proven shape).
│   ├── web/                 mission-control's Next.js UI + design studio
│   ├── desktop/             thin Electron shell over web (phase 4)
│   └── cli/                 `ligma` command; same daemon API as the UI
├── packages/
│   ├── runtime/             ligma's iframe overlay, comment round-trip, tweaks
│   ├── providers/           backends-as-data adapters; SDK path behind parity flag
│   ├── harness/             personas, judge, signing, verdicts (ported as-is)
│   ├── session/             JSONL + content-addressed evidence blobs
│   └── ui/                  tokens.css + Tailwind v4 preset
├── craft/                   vendored (Apache-2.0, attributed)
├── design-systems/          curated subset, manifest/DESIGN.md/tokens triad
└── skills/                  SKILL.md convention, staged copies per run
```

### Governing principles

1. **The daemon is the product; UIs are faces.** Web, desktop, CLI all speak the same HTTP/SSE API. Next.js API routes migrate into the daemon route by route; per-file mutexes and cross-process locks move with them.
2. **JSON files stay the source of truth.** Agents read state off disk; the daemon serves the API over the same files. No SQLite without a written argument (open-design's scheduler is the only component that genuinely wants one, and it is out of scope).
3. **§4 discipline, merged-wide.** Load-bearing pieces (runner, dispatcher, harness, locks, streaming) port, never rewrite. SDK migration runs behind an A/B parity test (ligma's own pattern).
4. **§5 principles carry over unchanged**, including the visibility split: journeys and prototypes are the visible slice; judge expectations, baselines, and holdout stay outside the builder's tree, tool-enforced.

### Contribution map

| Stage | Source | Ports |
|---|---|---|
| Discovery/brief | open-design | discovery prompts, question-form detection |
| Design studio | ligma | preview runtime, comment overlay, tweaks bridge, exporters |
| Design quality | open-design | craft/ rules, critique theater (single-critic first), design-system triad |
| Contract | mission-control | compile-contract, Ed25519 signing, holdout + prototype-as-baseline ingestion |
| Build | mission-control | daemon, dispatcher, governor, envs — untouched core |
| Verify | mission-control | personas, judge, evidence locker + ligma overlay for human feedback on evidence |
| Learn | twin-primitives spec | `.ligma/` knowledge dir, journeys, baselines, regression corpus |

Licensing: Apache-2.0 vendored files keep headers + NOTICE inside the MIT project. Standard, unrestricted combination.

## Migration phases (each leaves a working system)

1. **Consolidate.** New monorepo; mission-control and ligma imported with git history (git filter-repo). craft/ + selected design systems vendored. Nothing rewritten; existing test suites run green in the new home before anything else moves.
2. **Extract the daemon.** Engine code out of Next.js API routes into apps/daemon over the same JSON stores; web switches route by route; CLI appears for free.
3. **Studio + design-as-oracle.** Ligma's preview becomes the design surface; approved prototypes compile into contracts; twin-primitives spec (2026-08-11) lands here — knowledge dir renamed `.ligma/`.
4. **Distribution.** Skills/plugins filesystem, desktop shell, marketplace when there is something to distribute.

## Open items for Alex

- **The unreviewed branch.** feat/acceptance-harness (~80 commits) is the real current state but unreviewed. Recommendation: review/land it on mission-control main *before* the history import, so the merged repo is born from a state you have signed off.
- **Directory collision.** `~/ligma` is the existing Electron app. Recommendation: rename it `~/ligma-classic` (read-only ancestor) and give the merged monorepo `~/ligma`.
- **Name.** "ligma" confirmed by Alex. Meme-name caveat was raised and is now closed.

## Out of scope

Multi-tenancy/RBAC/auth beyond localhost (single user stands), SQLite, HyperFrames/video, adapter breadth beyond claude/codex/gemini, marketplace backend.

## Acceptance for phase 1 (consolidation)

Both imported histories intact (`git log --follow` reaches pre-merge commits); mission-control's full verify suite (typecheck, lint, build, 504 unit + 66 integration) green inside the monorepo; ligma's package tests green; one commit, tagged, nothing else changed.
