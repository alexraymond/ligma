# Phase 2 contract — conversation + data model (UX-REBUILD-BRIEF §Phase 2)

One wave, four agents, zero shared files. Conductor owns scripts/ (fake-claude,
drills), evidence, commits. The cross-agent API shapes below are FIXED — build
to them, do not renegotiate.

## Fixed shapes (all agents build against these)

- `ActivityEvent` gains `projectId?: string | null`; `EventType` gains
  `"run" | "verdict" | "promote" | "design_turn"`.
- `DecisionItem` gains `consequenceTaskIds?: string[]` (ids of tasks
  created/changed by applying the answer — written where the answer is applied,
  never parsed from text).
- Run rows (active-runs.json) gain `commitSha?: string | null` (rev-parse at
  spawn in the builder cwd; null for repo-less), `promptFile?: string`,
  `changesFile?: string`.
- `VerificationVerdict` gains `commitSha?: string | null` (rev-parse in the
  product repo at verdict time).
- `LedgerEntry` gains `durationMs?: number`, `tokensIn?: number | null`,
  `tokensOut?: number | null` (null when the backend envelope has no usage).
- `GovernorRole` gains `"human"`: gated by kill switch and the absolute window
  ceiling ONLY — never by the reserve floor (the reserve IS the human's).
- New daemon routes: `GET /api/runs/:id/prompt` → `{prompt}` | 404;
  `GET /api/runs/:id/changes` → `{commitSha, capturedAt, stat, diff}` with
  nulls for anything not captured (absent ≠ empty).
- Talk store: `data/projects/<id>/talk.json` →
  `{messages: [{id, author: "you"|"system"|AgentRole, body, chips?:
  [{kind:"task"|"run"|"verdict"|"design", id, label?}], createdAt}]}`.
  Routes: `GET/POST /api/projects/:id/talk`;
  `POST /api/projects/:id/talk/remember {messageId}` → appendQuirk.
  Talk spawns use role string `"talk"` (tool allowlist) and
  `claimSpawn("human", ...)` (governor).
- Amend path: `POST /api/projects/:id/brief/amend {formId, questionId, answer}`
  → re-applies one answered question; when the brief is locked, sets
  `staleFlaggedAt`; appends an answered DecisionItem
  (`question: "Brief answer changed — <q>"`, `consequenceTaskIds` = tasks
  actually modified, `[]` today) and returns `{ok, decisionId}`. The existing
  "form is no longer open" throw stays for the stale-client case only.
- Brief drift: stale-brief deck card ALSO fires when `brief.updatedAt` is 90+
  days old AND ≥25 of the project's tasks have `completedAt > brief.updatedAt`;
  options become `["Re-run discovery", "Still true (snooze 90 days)"]`; snooze
  writes `staleSnoozedUntil` on the brief and suppresses the card until then.

## Agent G — the data layer (daemon + shared types)

Owns: packages/api/src/types.ts, packages/api/src/harness.ts,
apps/daemon/src/store/validations.ts, apps/daemon/src/env/mission-control-adapter.ts,
apps/daemon/src/engine/run-task.ts, apps/daemon/src/engine/runner.ts,
apps/daemon/src/engine/quota-governor.ts, apps/daemon/src/harness/verdict.ts,
apps/daemon/src/harness/run-verification.ts, apps/daemon/src/harness/judge.ts,
apps/daemon/src/routes/runs/** (new prompt/changes routes),
apps/daemon/src/routes/tasks/route.ts, apps/daemon/src/routes/decisions/route.ts,
apps/daemon/src/routes/decisions/bulk/route.ts, apps/daemon/src/studio/promote.ts,
apps/daemon/src/studio/designs.ts (design_turn hook only),
apps/web/src/app/activity/activity-list.tsx (render new kinds only),
plus new test files beside each.

## Agent H — Proof binds to facts (web)

Owns: apps/web/src/app/projects/[id]/verify/page.tsx, apps/web/src/lib/staleness.ts
(+ test), apps/web/src/components/task-detail-panel.tsx (+ any new co-located
tab components/tests), apps/web/src/hooks/use-run-artifacts.ts (new).

## Agent I — Talk (daemon engine + web drawer)

Owns: packages/api/src/talk.ts (new), apps/daemon/src/routes/talk/** (new),
apps/daemon/src/engine/run-talk-respond.ts (new),
apps/daemon/src/engine/config.ts (toolsForRole "talk" entry only),
apps/daemon/src/engine/prompt-builder.ts (quirks injection only),
apps/web/src/components/talk/** (new), apps/web/src/app/projects/[id]/layout.tsx
(mount drawer + ⌘J), plus tests.

## Agent J — discovery-in-thread + drift (daemon brief + web brief page)

Owns: apps/daemon/src/engine/discovery.ts,
apps/daemon/src/routes/projects/_id/brief/** (incl. new amend route),
apps/daemon/src/routes/deck/deck-cards.ts, apps/daemon/src/routes/deck/route.ts,
packages/api/src/briefs.ts, packages/api/src/deck.ts,
apps/web/src/app/projects/[id]/brief/page.tsx, apps/web/src/components/question-form.tsx,
apps/web/src/lib/deck-actions.ts, plus tests.

Handoffs: none expected. Any agent needing a file outside its list STOPS and
reports instead of editing. Conductor wires drills + fake-claude after the wave.
