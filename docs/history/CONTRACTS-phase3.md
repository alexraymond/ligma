# Phase 3 contract — the shell (UX-REBUILD-BRIEF §Phase 3)

One wave, four agents, zero shared files. Conductor owns scripts/ (nav-crawl,
booted-ligma, drills, gate re-pins), evidence, commits.

## Fixed shapes (all agents build against these)

- **Stages**: Brief · Studio · Build · Proof. Brief ↔ `/projects/:id/brief`,
  Studio ↔ `/projects/:id/studio` (only when `studioVisible(shape)`),
  Build ↔ `/projects/:id/board`, Proof ↔ `/projects/:id/verify`.
  Default stage for a project: Studio when design-shaped and no tasks yet;
  Build when it has tasks; Brief otherwise.
- **Panel deep links**: `?panel=<name>` on a stage route opens that drawer.
  Names: `references` (Brief), `design-files` (Studio), `notes` (Build),
  `terminal` (Build), `runs` (Build), `knowledge` (Proof).
- **Absorbed-tab redirects** (each becomes the repo's exact redirect-shell
  pattern): `/projects/:id` → default stage (client-side, it needs shape);
  `/projects/:id/references` → `/projects/:id/brief?panel=references`;
  `/projects/:id/design-files` → `/projects/:id/studio?panel=design-files`;
  `/projects/:id/notes` → `/projects/:id/board?panel=notes`;
  `/projects/:id/terminal` → `/projects/:id/board?panel=terminal`;
  `/projects/:id/runs` → `/projects/:id/board?panel=runs`;
  `/projects/:id/knowledge` → `/projects/:id/verify?panel=knowledge`.
- **Global retirements**: `/objectives` → `/projects?view=goals`;
  `/board` → `/projects?view=tasks`; `/board/matrix` → `/projects?view=tasks`.
  Portfolio grid views: `?view=projects|goals|tasks` (default projects).
  `recordHref("task", id)` becomes `/projects?view=tasks&task=<id>` and the
  portfolio Tasks view opens the task panel for `?task=`. The daemon's deck
  card hrefs follow the same target.
- **Rail storage**: `apps/web/src/lib/rail.ts` (Agent K) exports
  `readRecentProjects(storage)`, `recordProjectVisit(storage, id)` (MRU,
  cap 8, key `ligma-recent-projects`), `readLastProject(storage)` /
  same-write via visit (key `ligma-last-project`). Agent L1 calls
  `recordProjectVisit` from the project layout.
- **Project.pinned?: boolean** (types.ts, Agent K) — pin toggle lives in the
  portfolio grid's card dropdown (Agent M) via the existing project update
  path; the rail lists pinned first, then recents.
- `RAIL_BOTTOM` global entries stay: Needs you (badge), Library, Crew,
  Settings — as compact icons below the project avatars. Home = the mark.

## Agent K — rail + shell + keyboard + home (opus)

Owns: apps/web/src/components/app-sidebar.tsx, layout-shell.tsx,
keyboard-shortcuts.tsx, search-dialog.tsx, kickoff-composer.tsx,
apps/web/src/app/page.tsx, apps/web/src/lib/nav.ts, apps/web/__tests__/nav.test.ts,
apps/web/src/lib/rail.ts (+test, new), packages/api/src/types.ts (Project.pinned
ONLY), plus new co-located tests.

## Agent L1 — stage bar + absorption (sonnet)

Owns: apps/web/src/app/projects/[id]/layout.tsx, apps/web/src/components/pipeline-strip.tsx
(+ its test if any), apps/web/src/app/projects/[id]/page.tsx (→ default-stage
redirect; its content moves per L2), the six absorbed tab directories'
page.tsx files (references, design-files, notes, terminal, runs, knowledge —
each becomes a redirect shell; their panel content must first be reachable as
drawers, see L2 handshake below), plus a new shared drawer host component
apps/web/src/components/stage-panels.tsx that maps `?panel=` to the existing
panel components (ReferencesPanel, DesignFilesPanel, NotesPanel, TerminalPanel,
project runs list, knowledge content — import what the old pages imported).

## Agent L2 — stage content + honest copy (opus)

Owns: apps/web/src/app/projects/[id]/board/page.tsx (Build: Flow | Plan toggle —
Plan groups by goal→milestone via deriveGoalStatus; matrix becomes a Flow lens
toggle; mounts stage-panels drawers for notes/terminal/runs),
apps/web/src/app/projects/[id]/verify/page.tsx (Proof: ProjectHealthBoard
summary moves to the top, ship panel with export/open-in-editor/handoff links +
"still unproven" list, knowledge drawer via stage-panels),
apps/web/src/components/studio/studio-surface.tsx (tweaks panel open by default
for design-shaped, "Share design" naming on export, "Review canvas" mode copy +
"Two things this does not do" box),
apps/web/src/app/projects/[id]/brief/page.tsx (references drawer via
stage-panels), and the "we don't estimate dates" line where a PM looks (Build
Plan view header). Plus tests.

## Agent M — portfolio grid + global retirements (sonnet)

Owns: apps/web/src/app/projects/page.tsx (views projects|goals|tasks; sortable
columns; cross-project task table with the existing bulk bar; project-less
goals; ?task= opens TaskDetailPanel; ?new=1 keeps working),
apps/web/src/app/objectives/page.tsx + app/board/page.tsx + app/board/matrix/page.tsx
(→ redirect shells), apps/web/src/components/project-card-large.tsx (pin
toggle), apps/daemon/src/routes/deck/deck-cards.ts (task hrefs retarget),
apps/web/src/lib/deck-cards.ts (same), plus tests.

Handshake: L1's stage-panels.tsx is created FIRST in L1's plan; L2 imports it.
If L2 reaches it before it exists, L2 stubs its usage behind a local fallback
and reports. Any agent needing another file STOPS and reports.
