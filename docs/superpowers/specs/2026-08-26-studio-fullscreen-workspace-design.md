# Studio full-screen workspace

Approved 2026-08-26. The Studio stage leaves the narrow in-shell tab and
becomes a full-viewport design workspace on its existing route.

Scope note (added same day): Alex upgraded the goal to a full visual
workflow at feature parity with open-design's studio. This spec is Phase 1
of that effort — the workspace shell every later phase renders inside. The
phase roadmap lives in the companion doc
`2026-08-26-studio-od-parity-roadmap.md` (written after the delta
analysis against docs/parity/open-design-capabilities.md).

## Problem

`/projects/:id/studio` renders inside the full app shell — global rail,
project header, pipeline banner, stage bar — which consumes roughly a third of
the viewport before the canvas begins. A design canvas is the one surface
where chrome costs the most.

## Decision (of the three considered)

Dedicated workspace route — chosen over an ephemeral immersive toggle
(full-screen state should survive refresh and be deep-linkable) and over a
separate Electron window (bigger build; the route design doesn't preclude it
later).

## Design

### Structure

- The URL does not change. `/projects/:id/studio` is the workspace.
- **Shell escape hatch:** `LayoutShell` (global rail) and the project
  `layout.tsx` (header + pipeline strip + banners) each check the active
  route segment; when it is `studio`, they render children full-bleed and
  none of their own chrome. No new route tree, no duplicated providers.
- **Slim bar (~40px)** inside `StudioSurface`: back arrow, project name, the
  existing Wall|Focus toggle, device chrome, version-rail trigger, export,
  Promote. Re-arrangement of the surface's existing header controls, not new
  machinery.

### Workflow

- **Enter:** Studio in the stage bar (or any design-card link) navigates to
  the workspace. First entry lands on the Wall.
- **Work:** composer + talk pane docked left, collapsible to a sliver;
  collapse state remembered per project. Canvas ~92% of viewport. Focus mode,
  pins, tweaks, critique unchanged — the critique lane becomes a collapsible
  bottom strip.
- **Leave:** back arrow or ESC returns to the project's Build stage. ESC
  walks the existing chain outward: pin overlay → Focus → Wall → exit
  Studio. Promote keeps its current navigation into Build.

### Out of scope

Electron multi-window, any generation/critique mechanics, non-design
projects (no Studio stage → unaffected).

## Implementation checklist

1. `apps/web/src/components/layout-shell.tsx` — segment/pathname check
   (`/projects/*/studio`) suppresses the global rail.
2. `apps/web/src/app/projects/[id]/layout.tsx` — same check suppresses
   header/strip/banners; children full-bleed.
3. `apps/web/src/components/studio/studio-surface.tsx` — slim bar; composer
   collapse (persisted per project, localStorage in the existing pattern);
   critique lane collapse; ESC chain step "exit to Build".
4. Tests: extend `layout.test.ts` + `studio-surface.test.ts` for the segment
   checks and ESC chain; one Playwright click-through (enter Studio → shell
   gone, canvas full → ESC → Build) since click-wiring vs. runtime is exactly
   the bug class the board just had.
