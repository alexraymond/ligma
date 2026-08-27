# Phase 1 contract — interrupt layer + the machine (UX-REBUILD-BRIEF §Phase 1)

One wave, four agents, zero shared files. Conductor owns scripts/ (nav-crawl
inventory, booted-ligma routes, drill-d4), evidence, and commits.

## Agent C — the tray (/needs-you)

Owns:
- apps/web/src/app/needs-you/** (new)
- apps/web/src/lib/needs-you.ts (+ needs-you.test.ts) (new)
- apps/web/src/app/deck/page.tsx (becomes redirect)
- apps/web/src/app/inbox/page.tsx (becomes redirect), apps/web/src/app/inbox/loading.tsx (delete)
- apps/web/src/components/app-sidebar.tsx (rail entry + badge + gauge unmount)
- apps/web/src/components/layout-shell.tsx (badge wiring)
- apps/web/src/app/runs/page.tsx + new apps/web/src/app/runs/runs-list.tsx (extraction)
- apps/web/src/app/activity/page.tsx + new apps/web/src/app/activity/activity-list.tsx (extraction)

## Agent D — the machine (heartbeat + overlay + stop everything)

Owns:
- apps/web/src/components/machine/** (new: heartbeat.tsx, machine-overlay.tsx, aftermath)
- apps/web/src/components/command-bar.tsx (mount heartbeat)
- apps/web/src/hooks/use-machine-logs.ts (new)
- Does NOT touch app-sidebar.tsx or governor-gauge.tsx (C unmounts the gauge;
  conductor deletes the file once unreferenced).

## Agent F — verbs and honest launch copy

Owns:
- apps/web/src/app/projects/[id]/page.tsx (Stop starting new work / Resume)
- apps/web/src/components/studio/promote-sheet.tsx (plain-language rewrite)
- apps/web/src/components/run-button.tsx (session estimate)
- apps/web/src/components/edit-project-dialog.tsx or wherever the project edit
  dialog's Paused option lives (locate first; report exact file)
- apps/web/src/app/settings/page.tsx (engine start affordance estimate) — only
  the start-affordance copy, nothing else on that page

## Agent E — daemon 24h ping

Owns:
- apps/daemon/src/engine/needs-you-ping.ts (+ test) (new)
- apps/daemon/src/engine/scheduler.ts / apps/daemon/src/engine/index.ts (wiring
  only — pick one call site)
- apps/daemon/src/notify.ts (export reuse only if needed)

Handoffs: none expected. Any agent needing a file outside its list STOPS and
reports instead of editing.
