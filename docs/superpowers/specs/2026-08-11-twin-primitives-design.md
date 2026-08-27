# Twin Primitives: Project Knowledge + Journeys

**Status:** approved (Alex, 2026-08-11)
**Branch:** feat/acceptance-harness

## Problem

Verification today is per-task: acceptance criteria live on tasks, verdicts hang off tasks, and the env adapter is hardcoded to mission-control itself. That forecloses two product directions Alex has asked for:

1. **Product validation, not ticket validation** — "does the product work as a user experiences it," independent of any task.
2. **Brownfield adoption** — pointing mission-control at an existing repo it didn't build, having it learn the project and validate it.

## Design

Two new primitives. A **project** owns durable knowledge about a repo; **journeys** are named user flows validated by the persona panel, independent of tasks. Everything later (adoption pipeline, human-sim personas, health board, regression corpus, smoke reports) consumes this data model.

### 1. Project primitive

Existing `projects.json` entries gain one field: `repoPath` (absolute path to the adopted repo, nullable — not every project is a codebase). Mission-control itself is the first adopted project. No new registry.

### 2. In-repo knowledge — `.mission-control/` (committed into the target repo)

Human-editable, system-maintained. Travels with the code (Alex's explicit choice over central/hybrid storage).

- **`boot.json`** — the boot recipe: install command, dev command, port strategy, health-check marker, seed command. Inferred once at adoption, human-confirmed, then trusted. Generalizes the hardcoded `scripts/env/mission-control-adapter.ts` into "any repo with a valid boot.json gets an ephemeral env."
- **`journeys/*.json`** — journey definitions: id, title, goal-oriented steps (not click-scripts), tags, origin (`human` | `discovery`), optional smoke schedule.
- **`project.md`** — architecture notes, conventions, quirks. Appended to as runs teach the system things.

### 3. Central, verification-sensitive — stays in mission-control's `data/`

**§5 collision, resolved by a visibility split: what users do is public; what the judge expects is not.** The builder edits the target repo, so anything it could read to teach-to-the-test must stay outside its tree (enforced by the existing `--disallowedTools` machinery — nothing new to build):

- **Baselines** (`data/projects/<id>/baselines/`) — characterization records per journey: step outcomes, screenshots, UX metrics (time-on-task, misclicks). For brownfield repos with no written oracle, the first panel run records what the product currently does; future changes are judged comparatively (§5.8).
- **Regression probes** — replayable failures with expected outcomes.
- Signed verdicts + evidence — already live there; unchanged.

Journeys being in-repo is deliberate, not a leak: journeys are the visible slice.

### 4. Runtime — reuse, don't rebuild

A journey run is a verification run with a nullable `taskId`. Env lifecycle boots via `boot.json`; persona panel walks the journey goal; judge scores against baseline + criteria; verdict signed; evidence locker unchanged. New runtime code is limited to the boot-recipe adapter and "run a journey without a task."

### 5. First implementation — dogfood

Mission-control adopts itself: hand-written `boot.json`, three hand-authored journeys (capture→task, task→done-with-verification, decision-deck answer), one panel run each, baselines recorded centrally. UI slice: journeys list per project, a **Prove it** button wired to the existing live-output view, last-run status per journey.

### 6. Out of scope (later consumers, no migration required)

Adoption inference / discovery crawl, screen-only personas and behavior profiles, health board, re-verification lottery, judge calibration, PR checks, morning smoke reports.

## Error handling

Follows the existing D3 rule: a boot failure or judge crash is a harness `error`, never a journey `failed`. Absence of a verdict is not evidence of a defect.

## Testing

Integration tests seed a fake repo containing a `.mission-control/`, run a journey end-to-end with the LLM layer stubbed (same pattern as the autonomous-loop acceptance evidence), and assert the baseline lands centrally and **never** in-repo.

## Open naming

`.mission-control/` is the default dir name; rename is cheap until the first external repo is adopted.
