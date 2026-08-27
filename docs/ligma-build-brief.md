# Ligma Build Brief — v1

You are building **ligma**: an autonomous app factory for one person, merged from three source projects. This brief is self-contained; read it fully before touching anything. Product orientation governs every decision: **user experience and feature completeness are the two properties that outrank all others** — above elegance, above novelty, above speed of delivery.

---

## §1 Mission

Merge mission-control (autonomous execution engine + acceptance harness), ligma-classic (design studio interactions), and open-design (Apache-2.0, vendorable patterns) into one product with one seamless experience.

**The point of merging is inheritance, not inspiration.** These repos are being brought together to shortcut into a vast surface of fully built, working features. You are not here to study them and rewrite a tasteful 10% from scratch — you are here to port, vendor, and wire what already works, keeping its capability intact. When finished, **ligma does everything mission-control could do and everything open-design could do**, plus ligma-classic's studio. Reimplementation is the fallback for when a port is genuinely impossible, and it carries the burden of proof: a reimplementation that does less than the source it replaced is a regression, not a simplification.

The product thesis: **you direct; it builds; it proves.** The user describes a product; ligma designs it with them where a UI is called for, builds it without them, and proves the result works the way its real consumer would experience it — a human at a browser, a developer following the README, a client calling the API — with signed evidence, not claims.

Every screen answers exactly one of four questions: *What needs me?* (Deck) · *What's happening?* (Home/Runs) · *Is it actually done?* (Verify) · *What are we making?* (Studio/Board).

## §2 What you are starting from

- **`~/mission-control`** — main branch, everything landed. The engine is built and proven: daemon, dispatcher, multi-backend rotation, quota governor, ephemeral envs, acceptance harness (contracts, Ed25519 signing, ~70% holdout, persona panel, fail-default judge, signed verdicts, evidence locker), decision deck, live streaming, cross-process file locks. 504 unit + 66 integration tests green.
- **`~/ligma-classic`** — the studio interactions to port: `packages/runtime` (iframe overlay, click-to-pin comments with live rects, EDITMODE tweaks bridge), the Wall canvas, progressive throttled rendering, iframe pool, exporters. Its session package and new agent loop are tested but were never wired into its app — port designs, not wiring claims.
- **`~/open-design`** — vendor with Apache-2.0 attribution: `craft/` anti-slop rules, curated design-systems (manifest/DESIGN.md/tokens.css triad), critique-theater pattern, runtime-adapter-as-data, skill staging isolation, master–detail catalog UX, shimmer progress primitive, failure-class-aware error recovery, milestone-scoped one-shot onboarding.
- **Three canonical specs**, now in-repo at `docs/superpowers/specs/` (written pre-merge at `~/mission-control/docs/superpowers/specs/`) — read all before starting; they are the product's constitution:
  - `2026-08-11-ligma-merger-design.md` — architecture: new monorepo at `~/ligma`, daemon-centric (apps/daemon is the product; web/cli are faces over one HTTP+SSE API), JSON files stay source of truth.
  - `2026-08-11-twin-primitives-design.md` — project knowledge (`.ligma/` in-repo: boot.json, journeys, project.md) + journeys; verification-sensitive material (baselines, probes, holdout) stays central, tool-denied to builders.
  - `2026-08-11-ligma-product-ux-spec.md` — the UX contract: IA, flows F1–F6, screen inventory §6, status language §7, seam principles §8, project shapes (design stage is opt-in; headless projects never see a Studio).

Pinned product defaults (overridable only by Alex via decision card): kickoff composer is prompt-first with an "Adopt a repo" chip; editing a brief after contract compilation flags dependents stale (Deck card) rather than invalidating; verdict spot-checks sample 1 in 10 into the Deck.

## §3 The two governing properties

**Seamless UX.** The three sources fail at their seams, not their features: open-design ships a fully-built Automations page with no navigation entry point, hides its best feature behind a settings toggle, and severs global nav inside Studio. You are forbidden from reproducing this class of defect. Concretely testable rules (spec §8): every feature reachable from the rail or pipeline strip; nothing load-bearing hidden in settings; every object links *what made this* and *what this made*; Deck cards carry their evidence inline; one status vocabulary, one shimmer primitive, one failure-class error model everywhere; both budgets (attention, tokens) always visible; **a green checkmark never renders without a verdict link**.

**Feature completeness.** Two ratchets, both binding:
- *The new surface:* the screen inventory in UX spec §6 — Home, Deck, Inbox, Project Overview, Studio, Board, Runs, Verify, Knowledge, Library, Crew, Settings — with the listed contents. "Present but stubbed" is not complete. A surface is complete when the flows F1–F6 that cross it run end to end.
- *The inherited surface:* **capability parity with both parents.** Every user-facing capability of mission-control and of open-design either works in ligma or appears as an explicit, argued waiver (see D7). The only automatic waivers are multi-user/team/workspace features excluded by §8. Where the UX spec's §10 cut list conflicts with parity, the cut must be re-justified in the parity matrix — deferrals are marked "later" with a home in the roadmap, never silently dropped.

## §4 Non-negotiable principles

Engine principles (inherited, already enforced in code — carry them through the merge intact):
1. The builder never grades itself. 2. The oracle is frozen before code exists, enforced at the tool-permission/filesystem level, not by prompt politeness. 3. The tester never sees source. 4. ~70% of criteria held out from the builder. 5. The judge defaults to fail; parse failure is never a pass. 6. Done is backed by artifacts, not assertions. 7. Measure behavior, not opinion; personas run multiple times, variance matters. 8. Everything comparative against baseline. 9. Prefer Alex's Claude subscription (`claude -p`) but never lock him out of his own allocation — the governor gates every spawn, no exceptions.

Product principles (new, equally binding):
10. Design is a stage, not a gate — headless projects skip Studio entirely; absent stages don't render.
11. Approved-artifact-as-oracle: design baseline where one exists; criteria + journey baselines where none does.
12. Harness malfunction is never reported as product failure (`error` ≠ `failed`), in the UI as in the data.
13. The UI never asserts done-ness it cannot link to evidence.

## §5 Do not rebuild

**Prefer porting the source implementation over reimplementing it — always.** The merger exists to shortcut; every fully built feature you rewrite from scratch spends the shortcut and risks shrinking the capability. Port, extend, never rewrite without a written argument in a decision card: the runner (Windows `.cmd` shim included — don't break it, don't spend time on it), dispatcher and backend rotation, file locks, live streaming, the harness (personas/judge/signing/verdict), the governor, the decision deck, ligma-classic's `packages/runtime`. SDK migration for the runner is permitted only behind an A/B parity test proving the default path byte-identical. No SQLite — JSON files are deliberate; if you hit a genuine wall, argue in a memo, don't migrate.

## §6 Phases

Work in phases, in order. **Each phase ends with acceptance evidence in the harness's own format** — journey runs with verdicts and evidence, not test counts. A phase reported done without evidence reproduces the exact defect this product exists to kill.

**Phase 1 — Consolidate.** New monorepo at `~/ligma` (pnpm + turbo, layout per merger spec). Import mission-control and ligma-classic with git history (`git filter-repo`); vendor `craft/` + a curated design-system subset with LICENSE/NOTICE attribution. *Done when:* `git log --follow` reaches pre-merge commits from both ancestors; mission-control's full verify suite and ligma-classic's package tests run green inside the monorepo; nothing else changed.

**Phase 2 — Daemon + IA skeleton.** Extract the engine into `apps/daemon` (HTTP + SSE over the same JSON stores, route-by-route; per-file mutexes and cross-process locks move with it). Wrap the existing pages in the new IA: persistent global rail (Home, Deck, Inbox, Projects, Library, Crew, Settings + governor gauge), project space with pipeline strip as navigation. The `ligma` CLI speaks the same API. *Done when:* every pre-existing mission-control flow works through the new nav; a nav crawl proves zero orphaned surfaces; the CLI can list projects, tail a run, and answer a decision.

**Phase 3 — Studio, shapes, and design-as-oracle.** The product's heart. Studio (Wall canvas, progressive render, pinned comments with apply-preview, tweaks panel, critique lane visible by default, version rail over content-addressed snapshots); project shapes with adaptive pipeline; Promote-to-build sheet with both entrances (from design, from brief); twin primitives (`.ligma/`, journeys, central baselines); consumer personas (naive-developer/README, API and CLI journeys via HTTP/PTY bridge siblings); Verify surface with evidence pinning that compiles into builder instructions. *Done when:* the walkthroughs in §7 pass as recorded journey runs.

**Phase 4 — Library and polish.** Master–detail catalogs (design systems with live preview, skills, craft rules) reusing one picker component in all composers; failure-class recovery cards at every agent failure site; milestone-scoped one-shot onboarding; the morning smoke digest. *Done when:* the §7 completeness matrix has no open cells.

## §7 Definition of done — product-level, non-negotiable

Ligma is done when **ligma's own acceptance harness proves ligma works**. Define journeys for ligma's own flows, run the panel against a built ligma in an ephemeral env, and deliver the signed verdicts. The factory ships only when it passes its own inspection. Specifically, all of the following as recorded, passing journey runs with evidence:

- **D1 Headless greenfield.** From the Home composer: "Build a REST API that shortens URLs, with rate limiting." Discovery confirms the shape; no Studio tab ever appears; Promote opens directly from the brief with tasks, criteria, journeys, and a token estimate; the build runs gated by the governor; a consumer persona in a clean env follows the generated README and exercises the API; the verdict lands with evidence; the task's green check links to it. Zero CLI usage by the user.
- **D2 UI greenfield.** A multi-screen web app: prototypes stream onto the Wall; the critique lane is visible without touching settings; the user pins a comment, sees the apply-preview, applies it; promotes from the approved design; a browser persona walks the built app; the judge scores against the design baseline; a failure returns to the builder with the judge's reasoning and passes on a capped retry.
- **D3 Brownfield adoption.** Adopt a real existing repo the system did not build; boot recipe inferred and confirmed once; an exploratory persona proposes journeys; a characterization baseline is recorded centrally, never in-repo; the project arrives with Verify and Knowledge populated.
- **D4 The daily loop.** With decisions, a design approval, a stale-brief flag, and a verdict spot-check queued: everything is answerable from Deck cards alone — inline evidence, no navigation, batch mode at ≥10, working undo.
- **D5 Seam audit.** An automated crawl from the rail reaches every routable surface (zero orphans); a component audit finds one status-pill vocabulary, one shimmer primitive, no green check without a verdict link, and `error` visually distinct from `failed`.
- **D6 Feature-completeness matrix.** Every §6-inventory surface × its listed contents, each cell backed by a journey run or an explicit, argued waiver. Silent scope-shrink is a failure.
- **D7 Capability-parity matrix.** Build an inventory of every user-facing capability of mission-control and of open-design — from their route maps, feature docs, and source, not from memory. Every row maps to its working ligma equivalent with evidence, or to an explicit argued waiver (automatic only for §8's multi-user exclusions; "later" deferrals need a roadmap home). A row where ligma does less than the parent did is failing unless Alex approved the reduction by decision card. This matrix is how "we ended up with 10% of the capability" is made structurally impossible.

Evidence for D1–D7 lives in the evidence locker and is indexed in one human-readable `docs/evidence/DONE.md` with links. That file is the deliverable Alex reads first.

## §8 Constraints

Single user, localhost, no RBAC/auth/multi-tenancy. Never spawn unbounded parallel `claude -p`; every spawn passes the governor. pnpm, TypeScript strict, no `any`. JSON files are the source of truth. Apache-2.0 attribution preserved for vendored code. Never regex/keyword-match structured data out of free text — structured output or a fixed data model, always.

## §9 How to work

Branch; small conventional commits; run tests after changes. Pin shared types and file ownership in a contracts doc before any parallel fan-out; no two concurrent agents edit the same file; verification agents are separate from build agents. Surface assumptions explicitly. Product-direction, naming, scope, and irreversible choices go to Alex as decision cards — including anything this brief under-specifies. When blocked, post a partial report and mark the task honestly; never mark done on a failure. If you tell Alex a phase is done without evidence, you have reproduced the bug this product exists to fix.
