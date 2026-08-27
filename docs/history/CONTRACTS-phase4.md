# Phase 4 Contracts — Library, polish, onboarding, smoke digest

Binding for Phase 4 agents. Prior contracts stay in force. Goal (brief §6 Phase 4): master–
detail catalogs reusing ONE picker in all composers; failure-class recovery cards at every
agent failure site; milestone-scoped one-shot onboarding; morning smoke digest. Done when the
completeness matrix has no open cells for these surfaces.

## Workstreams

| WS | Scope | Owns |
|---|---|---|
| P4-A Library + catalogs (opus) | `/library` becomes master–detail catalogs: design systems (live preview pane over the vendored triads), skills (existing), craft rules (vendored craft/ rendered); `GET /api/design-systems` + `GET /api/craft-rules` daemon routes (new files) reading the vendored dirs; ONE picker popover component shared by every composer (kickoff, studio session start) — replace P3-D's static CATALOG in the studio picker with the endpoint | `apps/web/src/app/library/**`, `apps/web/src/components/{library,pickers}/**`, `apps/web/src/components/studio/design-system-picker.tsx` (swap), `apps/daemon/src/routes/{design-systems,craft-rules}.ts` (new), `packages/api/src/catalogs.ts` (reserved), additive routes.ts/server.ts lines |
| P4-B polish + onboarding (sonnet) | failure-class recovery cards (auth / rate-limit-deferred with resume estimate / parse-retry / switch-backend — one right button per class) at EVERY agent failure site (runs, studio turns, discovery, adoption, journey runs — audit them); milestone-scoped one-shot onboarding hints (first project, first design, first promote, first verdict — each shows once, never nags returning users); "＋ Design" affordance on Overview (adds design stage to a mixed/ui project later); `stale` verification-status producer in the UI wherever staleness is derivable (brief-edit flags exist) | `apps/web/src/components/{failure,onboarding}/**`, small surgical edits at the failure sites and Overview, e2e additions |
| P4-C daemon polish + smoke digest (opus, AFTER P3-F lands) | journeys with `smokeSchedule` run via the existing scheduler; morning smoke digest composed into Inbox (one digest entry: per-journey status, error≠failed, links to verdicts); SSE end-frame duplicate fix (empty payload on `end`); project hard-delete cleans central `data/projects/<id>/`; verification-status staleness decay data (last-verified timestamps exposed where the health board needs them) | `apps/daemon/src/engine/{scheduler,smoke}*`, `routes/stream.ts`, delete path in projects route/store, tests |

Rules unchanged: explicit-path staging, `git diff --cached --name-only` before commits, bare
conventional messages, no AI trailers, suites green (floors: daemon 688+107, web 82 unit +
21 e2e, cli 7 — grow, never shrink), no new runtime npm dependencies without conductor
approval, seam rules from UX spec §8 binding on every new surface.
