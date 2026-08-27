# Phase 0 contract — fix-now list (UX-REBUILD-BRIEF §Phase 0)

One wave, two agents, zero shared files. Conductor commits.

## Agent A — daemon (F1, F2-daemon, F3)

Owns:
- apps/daemon/src/engine/dispatcher.ts
- apps/daemon/src/engine/dispatcher.test.ts (new)
- apps/daemon/src/store/data.ts
- apps/daemon/src/store/data.checkpoint.test.ts (new)
- apps/daemon/src/routes/checkpoints/load/route.ts
- apps/daemon/src/routes/mcp/handoff-prompt/_id/route.ts
- apps/daemon/src/routes/mcp/handoff-prompt/_id/route.test.ts

## Agent B — web (F2-web, F4, F5, F6, F7)

Owns:
- apps/web/src/app/settings/checkpoints/page.tsx
- apps/web/src/app/checkpoints/page.tsx (verify-only; edit only if it has its own dialog)
- apps/web/src/app/projects/[id]/board/page.tsx
- apps/web/src/components/board-view.tsx
- apps/web/src/components/use-everywhere/sections.ts (+ its test)
- apps/web/src/components/use-everywhere/UseEverywhereModal.tsx
- apps/web/src/components/studio/version-rail.tsx
- apps/web/src/components/studio/api.ts (+ api.test.ts)
- apps/web/src/components/governor-card.tsx
- apps/web/src/components/governor-card.test.ts (new)
- apps/web/src/app/projects/[id]/board/board-helpers.test.ts (new, if needed)

Handoffs: none expected. If either agent believes it must touch a file outside
its list, it STOPS and reports the need instead of editing.
