# Mission Control — Capability Inventory (D7 Parity Audit)

Source repo: `/Users/alexraymond/mission-control` (app: `/Users/alexraymond/mission-control/mission-control`, Next.js 15, `src/` layout, `scripts/` daemon).
Compiled from source (pages, API routes, daemon/engine/harness scripts) — not from memory. Every row was verified against a specific file.

**Commit pin:** no commit was recorded at compile time (added retroactively,
2026-08-27 — see `docs/audits/docs-audit-2026-08-27.md` D22). The local
checkout's current HEAD is `79abfce` (2026-08-11) — this inventory is legacy
source material (mission-control is the pre-merger product this repo grew
out of, not a project still tracked for parity drift), so re-pinning to a
newer commit is unlikely to be worth doing again.

Legend: **Pages** = UI surfaces, **API** = `src/app/api/**/route.ts`, **Daemon/CLI** = `scripts/daemon/**` + `scripts/*` + start/stop scripts, **Engine** = dispatcher/multi-backend rotation/quota governor/ephemeral envs, **Harness** = acceptance-testing subsystem (`scripts/harness/**`, `scripts/env/**`).

---

## Pages

### Dashboard — `/`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-001 | Create task (dialog) | `src/app/page.tsx`, `src/components/create-task-dialog.tsx` | |
| MC-002 | Create project/mission (dialog) | `src/app/page.tsx`, `src/components/create-project-dialog.tsx` | |
| MC-003 | Create goal (dialog) | `src/app/page.tsx`, `src/components/create-goal-dialog.tsx` | |
| MC-004 | Load demo data | `src/app/page.tsx`, `src/app/api/seed-demo/route.ts` | Shown on empty-workspace welcome screen |
| MC-005 | Start/stop Autopilot daemon from dashboard card | `src/app/page.tsx`, `src/hooks/use-daemon.ts` | |
| MC-006 | View stats bar (tasks/goals/projects/brain-dump counts) | `src/app/page.tsx` | |
| MC-007 | View "Attention Required" list with deep links | `src/app/page.tsx` | Pending decisions, unread reports, DO-quadrant tasks, unreviewed completions |
| MC-008 | View Inbox widget preview | `src/app/page.tsx` | Links to `/inbox` |
| MC-009 | View Decisions widget preview | `src/app/page.tsx` | Links to `/decisions` |
| MC-010 | View Recent Activity feed preview | `src/app/page.tsx` | Links to `/activity` |
| MC-011 | View Crew Status workload panel (idle/on-track/blocked/overloaded per agent) | `src/app/page.tsx` | Links to `/team/[id]` |
| MC-012 | View Missions grid (active projects) | `src/app/page.tsx`, `src/components/project-card-large.tsx` | |
| MC-013 | View Long-Term Objectives grid | `src/app/page.tsx`, `src/components/goal-card.tsx` | |
| MC-014 | View Eisenhower summary widget | `src/app/page.tsx`, `src/components/eisenhower-summary.tsx` | |
| MC-015 | View Recent Brain Dump preview | `src/app/page.tsx` | |
| MC-016 | Empty-state onboarding cards (create mission/task/deploy agents) | `src/app/page.tsx` | |

### Priority Matrix — `/priority-matrix`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-017 | Drag task between Eisenhower quadrants (Do/Schedule/Delegate/Eliminate) | `src/app/priority-matrix/page.tsx`, `src/components/board-view.tsx` (dnd-kit) | |
| MC-018 | Filter tasks by project | `src/app/priority-matrix/page.tsx` | |
| MC-019 | Filter tasks by assignee | `src/app/priority-matrix/page.tsx` | |
| MC-020 | Create task from matrix | `src/app/priority-matrix/page.tsx` | |
| MC-021 | Multi-select tasks + bulk mark done / bulk delete | `src/app/priority-matrix/page.tsx`, `src/components/bulk-action-bar.tsx` | |
| MC-022 | Click task card to open detail panel | `src/app/priority-matrix/page.tsx` | |
| MC-023 | Run task inline from card | `src/app/priority-matrix/page.tsx`, `src/components/run-button.tsx` | Disabled while blocked by unfinished dependency |

### Status Board — `/status-board`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-024 | Drag task between kanban columns (Not Started/In Progress/Awaiting Verification/Done) | `src/app/status-board/page.tsx`, `src/components/board-view.tsx` | |
| MC-025 | Filter tasks by project | `src/app/status-board/page.tsx` | |
| MC-026 | Create task from status board | `src/app/status-board/page.tsx` | |
| MC-027 | Multi-select + bulk mark done / bulk delete | `src/app/status-board/page.tsx`, `src/components/bulk-action-bar.tsx` | |
| MC-028 | Run task inline from kanban card | `src/app/status-board/page.tsx`, `src/components/run-button.tsx` | |

### Projects / Missions — `/projects`, `/projects/[id]`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-029 | Create mission | `src/app/projects/page.tsx`, `src/components/create-project-dialog.tsx` | Name/description/color/tags/team-member multiselect |
| MC-030 | Edit mission | `src/app/projects/page.tsx`, `src/components/edit-project-dialog.tsx` | + status (active/paused/completed/archived) |
| MC-031 | Archive / unarchive mission | `src/components/project-card-large.tsx` | Dropdown menu item |
| MC-032 | Delete mission (confirm dialog) | `src/app/projects/page.tsx`, `src/components/confirm-dialog.tsx` | Unlinks tasks |
| MC-033 | Show/hide archived missions toggle | `src/app/projects/page.tsx` | With count badge |
| MC-034 | Launch all eligible tasks in a mission (list view) | `src/components/project-card-large.tsx`, `src/components/run-button.tsx` | Only shown if project has non-done, non-"me"-assigned tasks |
| MC-035 | Mission detail: run all project tasks (header button) | `src/app/projects/[id]/page.tsx`, `src/components/run-button.tsx` | |
| MC-036 | Mission detail: add task to mission | `src/app/projects/[id]/page.tsx`, `src/components/create-task-dialog.tsx` | Pre-fills `projectId` |
| MC-037 | Mission detail: add/remove team members | `src/app/projects/[id]/page.tsx` | Inline chip add/remove |
| MC-038 | Mission detail: Priority Matrix tab (drag between quadrants scoped to project) | `src/app/projects/[id]/page.tsx` | |
| MC-039 | Mission detail: Status Board tab (drag between kanban scoped to project) | `src/app/projects/[id]/page.tsx` | |
| MC-040 | Mission detail: Milestones tab (linked goals, read-only progress) | `src/app/projects/[id]/page.tsx`, `src/components/goal-card.tsx` | |

### Task Detail Panel & Task Form (shared across Projects/Team/Priority Matrix/Status Board)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-041 | Edit all task fields (title/description/importance/urgency/status/assignee/project/milestone) | `src/components/task-detail-panel.tsx`, `src/components/task-form.tsx` | |
| MC-042 | Deploy/reassign task to agent from panel | `src/components/task-detail-panel.tsx` | Auto-flips not-started → in-progress |
| MC-043 | Delete task from panel | `src/components/task-detail-panel.tsx`, `src/components/confirm-dialog.tsx` | |
| MC-044 | Mark task reviewed | `src/components/task-detail-panel.tsx` | Clears from "Attention Required" |
| MC-045 | Add comment to task (Cmd/Ctrl+Enter submits) | `src/components/task-detail-panel.tsx` | |
| MC-046 | View comments thread (collapsible) | `src/components/task-detail-panel.tsx` | |
| MC-047 | View activity timeline for task (merges events + inbox messages) | `src/components/task-detail-panel.tsx` | |
| MC-048 | View live/completed run output inline (streamed) | `src/components/task-detail-panel.tsx`, `src/hooks/use-run-output.ts` | |
| MC-049 | View inline verification report (compact mode) | `src/components/task-detail-panel.tsx`, `src/components/verification-report.tsx` | Fetched by taskId |
| MC-050 | Close panel via Escape/X/backdrop, focus restore | `src/components/task-detail-panel.tsx` | Accessibility: restores prior focus |
| MC-051 | Add/remove/toggle subtasks | `src/components/task-form.tsx` | Enter key adds |
| MC-052 | Add/remove collaborators | `src/components/task-form.tsx` | Excludes assignee/"me" |
| MC-053 | Add/remove task dependencies (blocked-by) with search | `src/components/task-form.tsx` | Collapsible searchable picker |
| MC-054 | Set due date / estimated minutes | `src/components/task-form.tsx` | |
| MC-055 | Edit acceptance criteria (one per line, char-limited) | `src/components/task-form.tsx` | Feeds the acceptance harness contract compiler |
| MC-056 | Live character-count validation on title/description/notes/criteria | `src/components/task-form.tsx` | |

### Objectives — `/objectives`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-057 | Create objective / milestone | `src/app/objectives/page.tsx`, `src/components/create-goal-dialog.tsx` | Type toggle shows/hides parent-objective picker |
| MC-058 | Edit objective / milestone | `src/app/objectives/page.tsx`, `src/components/edit-goal-dialog.tsx` | + status field |
| MC-059 | Delete objective (confirm dialog) | `src/app/objectives/page.tsx`, `src/components/confirm-dialog.tsx` | Cascades milestones; tasks unaffected |
| MC-060 | View milestone progress with linked task checklist | `src/app/objectives/page.tsx` | Read-only |

### Crew — `/crew`, `/crew/new`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-061 | Create custom AI agent | `src/app/crew/new/page.tsx` | Name→auto-slug id, icon picker, instructions, capability tags, active/inactive switch, live preview |
| MC-062 | Filter agents (all/active/inactive) | `src/app/crew/page.tsx` | |
| MC-063 | Agent card click-through to team profile | `src/app/crew/page.tsx` | Links to `/team/[id]` |

### Skills Library — `/skills`, `/skills/[id]`, `/skills/new`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-064 | Create skill | `src/app/skills/new/page.tsx` | Name/description/markdown content/tags/assign-to-agents |
| MC-065 | Edit skill | `src/app/skills/[id]/page.tsx` | Dirty-state tracking, "unsaved changes" indicator |
| MC-066 | Delete skill | `src/app/skills/[id]/page.tsx` | Uses native `confirm()`, inconsistent with app's `ConfirmDialog` elsewhere |
| MC-067 | Assign/unassign skill to agents (toggle grid) | `src/app/skills/[id]/page.tsx`, `src/app/skills/new/page.tsx` | |
| MC-068 | Copy AI slash-command reference to clipboard | `src/app/skills/page.tsx` | Static command reference list |

### Decisions — `/decisions` (Deck + List modes)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-069 | Toggle Deck / List view mode | `src/app/decisions/page.tsx` | Local state only |
| MC-070 | Swipe decision card left → Dismiss | `src/components/decision-deck.tsx`, `src/hooks/use-swipe.ts` | |
| MC-071 | Swipe decision card up → Flag urgent | `src/components/decision-deck.tsx` | |
| MC-072 | Swipe decision card down → Defer 7 days | `src/components/decision-deck.tsx` | |
| MC-073 | Tap option button to answer (deck mode) | `src/components/decision-deck.tsx` | |
| MC-074 | Keyboard shortcuts in deck (←dismiss/↑urgent/↓defer, Tab+Enter answers) | `src/components/decision-deck.tsx` | `e.repeat` guarded |
| MC-075 | On-screen action buttons as swipe alternative | `src/components/decision-deck.tsx` | |
| MC-076 | Undo last deck action (countdown-ring toast) | `src/components/decision-deck.tsx`, `src/components/undo-toast.tsx` | Time-boxed `UNDO_WINDOW_MS` |
| MC-077 | Batch review banner → switch to list mode | `src/components/decision-deck.tsx` | Appears past `BATCH_THRESHOLD` |
| MC-078 | Expand/collapse long context text | `src/components/decision-deck.tsx` | |
| MC-079 | Deep link from decision card to related task | `src/components/decision-deck.tsx` | |
| MC-080 | List mode: select individual / select-all pending | `src/app/decisions/page.tsx` | |
| MC-081 | List mode: bulk answer (one custom answer) | `src/app/decisions/page.tsx` | Sequential API calls, reports partial failures |
| MC-082 | List mode: bulk dismiss / bulk defer 7d / clear selection | `src/app/decisions/page.tsx` | |
| MC-083 | List mode: answer via preset option button or custom text | `src/app/decisions/page.tsx` | |
| MC-084 | View answered decisions (read-only history) | `src/app/decisions/page.tsx` | |
| MC-085 | View deferred decisions (`<details>` disclosure) | `src/app/decisions/page.tsx` | Shows "Resurfaces {date}" |
| MC-086 | Resurface a deferred decision now | `src/app/decisions/page.tsx` | Clears `deferUntil` |
| MC-087 | Answer via modal dialog (pre-run blocking-decision prompt) | `src/components/decision-dialog.tsx`, `src/providers/active-runs-provider.tsx` | Second, separate answer surface — triggered when launching a task hits an unanswered blocking decision |

### Inbox — `/inbox`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-088 | Compose new message | `src/app/inbox/page.tsx` | Auto-triggers agent auto-respond if recipient ≠ me |
| MC-089 | Reply to thread | `src/app/inbox/page.tsx` | Pre-fills recipient/subject |
| MC-090 | Forward message | `src/app/inbox/page.tsx` | Defaults to developer, quotes original |
| MC-091 | Archive thread (single or all messages) | `src/app/inbox/page.tsx` | |
| MC-092 | Expand/collapse thread (marks unread as read) | `src/app/inbox/page.tsx` | |
| MC-093 | Filter by agent / by status (all/unread/read/archived) | `src/app/inbox/page.tsx` | |
| MC-094 | Copy message body to clipboard | `src/app/inbox/page.tsx` | |
| MC-095 | Trigger agent auto-respond | `src/app/inbox/page.tsx`, `src/app/api/inbox/respond/route.ts` | Spawns detached `run-inbox-respond.ts` |

### Brain Dump — `/brain-dump`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-096 | Quick capture entry (Enter saves, Shift+Enter newline) | `src/app/brain-dump/page.tsx` | |
| MC-097 | Edit entry inline (Enter saves, Escape cancels) | `src/app/brain-dump/page.tsx` | |
| MC-098 | Convert entry to task | `src/app/brain-dump/page.tsx`, `src/components/create-task-dialog.tsx` | Pre-fills title/tags |
| MC-099 | Archive entry | `src/app/brain-dump/page.tsx` | |
| MC-100 | Delete entry (confirm dialog) | `src/app/brain-dump/page.tsx`, `src/components/confirm-dialog.tsx` | |
| MC-101 | Auto-process single entry (AI triage) | `src/app/brain-dump/page.tsx`, `src/app/api/brain-dump/automate/route.ts` | Spawns detached `run-brain-dump-triage.ts` |
| MC-102 | Auto-process all unprocessed entries (batch AI triage) | `src/app/brain-dump/page.tsx`, `src/app/api/brain-dump/automate/route.ts` | Polls every 5s while processing + tab visible |
| MC-103 | View archived/processed entries with conversion target | `src/app/brain-dump/page.tsx` | Read-only, still deletable |

### Launch (Autopilot daemon) — `/launch`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-104 | Start/stop daemon | `src/app/launch/page.tsx`, `src/hooks/use-daemon.ts` | "Launch Autopilot" / "Disengage Autopilot" |
| MC-105 | Live daemon status polling | `src/hooks/use-daemon.ts` | 5s smart-poll |
| MC-106 | Stats cards (uptime, completion rate, active sessions, failures) | `src/app/launch/page.tsx` | |
| MC-107 | Quota governor card (usage bar, reserve-floor marker, per-backend cooling badges) | `src/components/quota-card.tsx` | Read-only — kill switch is file-based by design, no UI toggle |
| MC-108 | Environment preflight scan + one-click fixes | `src/components/env-preflight-card.tsx`, `src/app/api/env-preflight/**` | Refresh + per-check fix buttons |
| MC-109 | Task Runs list — expand/collapse to view live output | `src/app/launch/page.tsx`, `src/hooks/use-run-output.ts` | |
| MC-110 | Run status badges with stalled/silent detection | `src/components/run-status-badge.tsx` | Tooltip explains quiet-duration heuristic |
| MC-111 | Daemon logs viewer (collapsible, polling, color-coded) | `src/app/launch/page.tsx`, `src/hooks/use-daemon-logs.ts` | Auto-scroll |
| MC-112 | Active sessions list | `src/app/launch/page.tsx` | |
| MC-113 | Schedule: add new scheduled skill | `src/app/launch/page.tsx` | |
| MC-114 | Schedule: edit cron/command per entry | `src/app/launch/page.tsx` | Preset frequency + available-commands dropdown |
| MC-115 | Schedule: enable/disable toggle badge | `src/app/launch/page.tsx` | |
| MC-116 | Schedule: remove entry | `src/app/launch/page.tsx` | |
| MC-117 | Edit daemon configuration (concurrency, max turns, timeout, retries, polling interval, backend mode, auto-failover) | `src/app/launch/page.tsx` | |
| MC-118 | View recent session history (last 20) | `src/app/launch/page.tsx` | |
| MC-119 | Read-only warnings: skipPermissions banner + allowedTools tooltip | `src/app/launch/page.tsx` | Not editable from UI — must edit `data/daemon-config.json` directly |

### Activity — `/activity`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-120 | Filter by actor | `src/app/activity/page.tsx` | |
| MC-121 | Filter by event type | `src/app/activity/page.tsx` | |
| MC-122 | Grouped-by-date timeline view (Today/Yesterday/date) | `src/app/activity/page.tsx` | Read-only feed |

### Checkpoints — `/checkpoints`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-123 | Save current workspace as checkpoint | `src/app/checkpoints/page.tsx`, `src/app/api/checkpoints/route.ts` (POST) | Name + optional description |
| MC-124 | Load checkpoint (replaces all data) | `src/app/checkpoints/page.tsx`, `src/app/api/checkpoints/load/route.ts` | Confirm dialog, redirects to dashboard |
| MC-125 | Delete checkpoint (confirm dialog) | `src/app/checkpoints/page.tsx`, `src/app/api/checkpoints/route.ts` (DELETE) | |
| MC-126 | Export checkpoint to JSON file download | `src/app/checkpoints/page.tsx`, `src/app/api/checkpoints/export/route.ts` | Client-side anchor-download |
| MC-127 | Import checkpoint from JSON file | `src/app/checkpoints/page.tsx`, `src/app/api/checkpoints/import/route.ts` | Hidden file input |
| MC-128 | Create fresh/empty workspace | `src/app/checkpoints/page.tsx`, `src/app/api/checkpoints/new/route.ts` | Confirm dialog, clears all data |
| MC-129 | View checkpoint stat badges (tasks/projects/goals/agents/ideas) | `src/app/checkpoints/page.tsx` | |

### Verification Run — `/verification/[id]` (acceptance harness UI)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-130 | Tabbed report (verdict/timeline/screenshots/transcripts) via URL state | `src/app/verification/[id]/page.tsx`, `src/components/verification-report.tsx` | Tabs are real `<Link>`s (shareable) |
| MC-131 | Per-criterion verdict display (met/not-met/unknown) with reasoning + evidence links | `src/components/verification-report.tsx` | Holdout badge on held-out criteria |
| MC-132 | Persona attempts table (charter/goal achieved/steps/wrong turns/elapsed/valid) | `src/components/verification-report.tsx` | Persona seed via truncated label + tooltip |
| MC-133 | Flight-recorder timeline merging all personas' steps chronologically | `src/components/verification-timeline.tsx` | Explicit "went dark" gap rows (≥60s silence), lane-colored per persona |
| MC-134 | Click timeline step to open screenshot lightbox | `src/components/verification-timeline.tsx` | |
| MC-135 | Screenshot grid grouped by persona, click to open lightbox | `src/components/verification-report.tsx` | Distinguishes cited-as-evidence vs all captured |
| MC-136 | Human-decision-needed callouts | `src/components/verification-report.tsx` | Judge-flagged items needing human judgment |
| MC-137 | Raw transcript links (collapsible, opens `.jsonl` in new tab) | `src/components/verification-report.tsx` | |
| MC-138 | Compact inline mode (embedded in Task Detail Panel) | `src/components/verification-report.tsx`, `src/components/task-detail-panel.tsx` | Same component, no tabs |

### Team — `/team/[role]`

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-139 | Edit agent description inline (click-to-edit) | `src/app/team/[role]/page.tsx` | |
| MC-140 | Edit agent instructions/system-prompt (char count) | `src/app/team/[role]/page.tsx` | |
| MC-141 | Add/remove capability tags | `src/app/team/[role]/page.tsx` | |
| MC-142 | Assign/unassign skills (toggle chips) | `src/app/team/[role]/page.tsx` | |
| MC-143 | View task stats (total/in-progress/completed) | `src/app/team/[role]/page.tsx` | |
| MC-144 | View & click into assigned tasks by status group, run task inline | `src/app/team/[role]/page.tsx`, `src/components/task-card.tsx` | |
| MC-145 | View recent messages / recent activity for this agent | `src/app/team/[role]/page.tsx` | |
| MC-146 | Agent-not-found fallback with link back to Crew | `src/app/team/[role]/not-found.tsx` | |

### Cross-cutting / Global UI

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-147 | Global sidebar navigation (collapsible desktop / drawer mobile) | `src/components/app-sidebar.tsx`, `src/components/layout-shell.tsx` | Sections with unread/pending badges |
| MC-148 | Command bar quick-capture (brain dump) | `src/components/command-bar.tsx` | "/" globally focuses input |
| MC-149 | Command bar slash-command autocomplete | `src/components/command-bar.tsx` | Notifies "open Claude Code" (CLI-only commands) |
| MC-150 | Command bar inline task search ("?" prefix or 3+ chars) | `src/components/command-bar.tsx` | |
| MC-151 | Sidebar collapse/expand toggle | `src/components/app-sidebar.tsx` | |
| MC-152 | Global search / command palette (Cmd/Ctrl+K) | `src/components/search-dialog.tsx` | Searches tasks/missions/objectives/brain-dump |
| MC-153 | Keyboard shortcuts help dialog ("?") | `src/components/keyboard-shortcuts.tsx` | |
| MC-154 | "G" + letter navigation shortcuts (GH/GE/GK/GO/GB/GP/GI/GD/GC/GS/GL) | `src/components/keyboard-shortcuts.tsx` | GL confirms `/launch` reachable w/o sidebar link |
| MC-155 | Theme toggle (dark/light/system) | `src/components/theme-toggle.tsx` | |
| MC-156 | First-visit onboarding walkthrough (3-step) | `src/components/onboarding-dialog.tsx` | Persists via localStorage `mc-onboarded` |
| MC-157 | Offline/connection-lost banner | `src/components/layout-shell.tsx`, `src/hooks/use-connection.ts` | |
| MC-158 | Skip-to-content accessibility link | `src/components/layout-shell.tsx` | |
| MC-159 | Per-page error boundary with auto-retry (3s countdown) + expandable stack trace | `src/app/error.tsx` | |
| MC-160 | Global (app-crash) error boundary with auto-reload (5s countdown) | `src/app/global-error.tsx` | |
| MC-161 | Custom 404 page | `src/app/not-found.tsx` | |
| MC-162 | Route-level loading skeletons | `src/app/loading.tsx`, `src/app/inbox/loading.tsx`, `src/app/crew/loading.tsx`, `src/app/brain-dump/loading.tsx`, `src/app/status-board/loading.tsx`, `src/app/priority-matrix/loading.tsx` | |
| MC-163 | Toast notifications (success/error) | `src/lib/toast.ts`, `sonner` in `src/app/layout.tsx` | |

---

## API

### Auth

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-164 | Bearer-token gate on all `/api/*` when `MC_API_TOKEN` set | `src/middleware.ts` | Constant-time compare; open access if unset (local-dev default). No CSRF/origin check, no rate limiting. |

### activity-log

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-165 | `GET /api/activity-log` — list/filter (actor)/paginate events | `src/app/api/activity-log/route.ts` | Wired (activity feed, task panel) |
| MC-166 | `POST /api/activity-log` — append event | `src/app/api/activity-log/route.ts` | **Unreachable from UI** — agent/backend self-report only |
| MC-167 | `DELETE /api/activity-log` — delete event | `src/app/api/activity-log/route.ts` | **Unreachable from UI** |

### agents

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-168 | `GET /api/agents` — list/filter (id/status) | `src/app/api/agents/route.ts` | |
| MC-169 | `POST /api/agents` — create custom agent | `src/app/api/agents/route.ts` | Regenerates `.claude/commands/` file; 409 on duplicate id |
| MC-170 | `PUT /api/agents` — update agent | `src/app/api/agents/route.ts` | Regenerates command file |
| MC-171 | `DELETE /api/agents` — delete/deactivate agent | `src/app/api/agents/route.ts` | Built-ins soft-delete only; custom hard-delete cascades. **Unreachable from UI** |

### brain-dump

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-172 | `GET/POST/PUT/DELETE /api/brain-dump` — full CRUD on entries | `src/app/api/brain-dump/route.ts` | Wired |
| MC-173 | `POST /api/brain-dump/automate` — AI auto-triage (single or `all:true`) | `src/app/api/brain-dump/automate/route.ts` | Spawns detached `run-brain-dump-triage.ts` |

### checkpoints

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-174 | `GET/POST/DELETE /api/checkpoints` — list/save/delete snapshots | `src/app/api/checkpoints/route.ts` | Delete id validated against `snap_(\d+\|demo)` |
| MC-175 | `GET /api/checkpoints/export` — download checkpoint as JSON | `src/app/api/checkpoints/export/route.ts` | |
| MC-176 | `POST /api/checkpoints/import` — import checkpoint JSON | `src/app/api/checkpoints/import/route.ts` | Validates shape, assigns fresh id, does not auto-load |
| MC-177 | `POST /api/checkpoints/load` — load checkpoint, replace all data | `src/app/api/checkpoints/load/route.ts` | Fire-and-forget `pnpm gen:context` afterward |
| MC-178 | `POST /api/checkpoints/new` — wipe workspace to fresh empty state | `src/app/api/checkpoints/new/route.ts` | Resets to 5 default built-in agents |

### contracts (acceptance harness)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-179 | `GET /api/contracts/[scope]` — view acceptance-contract versions for a task | `src/app/api/contracts/[scope]/route.ts` | `?version=N`; path-traversal guarded |

### daemon

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-180 | `GET /api/daemon` — status (self-heals stale "running" via PID liveness check) | `src/app/api/daemon/route.ts` | |
| MC-181 | `POST /api/daemon` (start) — spawn detached daemon process | `src/app/api/daemon/route.ts` | |
| MC-182 | `POST /api/daemon` (stop) — SIGTERM daemon PID | `src/app/api/daemon/route.ts` | |
| MC-183 | `PUT /api/daemon` — update config (polling/concurrency/schedule/execution) | `src/app/api/daemon/route.ts` | Blocks remote `skipPermissions=true` escalation (403) — can only be hand-set in config file |

### dashboard

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-184 | `GET /api/dashboard` — aggregate stats/quadrants/attention/recent-activity in one batched call | `src/app/api/dashboard/route.ts` | Powers `/` in a single fetch |

### decisions

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-185 | `GET /api/decisions` — list pending/answered, paginated | `src/app/api/decisions/route.ts` | |
| MC-186 | `POST /api/decisions` — create decision request | `src/app/api/decisions/route.ts` | **Unreachable from UI** — agent-created |
| MC-187 | `PUT /api/decisions` — update/answer directly | `src/app/api/decisions/route.ts` | Used by `decision-dialog.tsx` |
| MC-188 | `PATCH /api/decisions` — deck actions: answer/dismiss/urgent/defer/undo | `src/app/api/decisions/route.ts`, `src/app/api/decisions/deck.ts` | Server-side 10s undo journal (in-memory Map); stale-card guard |
| MC-189 | `DELETE /api/decisions` — delete decision | `src/app/api/decisions/route.ts` | **Unreachable from UI** |

### env-preflight

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-190 | `GET /api/env-preflight` — readiness scan (30s cache, `?refresh=1` bypass) | `src/app/api/env-preflight/route.ts`, `_lib.ts` | Wraps `scripts/env/preflight.ts` |
| MC-191 | `POST /api/env-preflight/fix` — apply one whitelisted remediation | `src/app/api/env-preflight/fix/route.ts` | Closed enum (`FIX_KINDS`) — no arbitrary shell execution |

### goals

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-192 | `GET/POST/PUT /api/goals` — list (filter id/status/type/projectId)/create/update | `src/app/api/goals/route.ts` | |
| MC-193 | `DELETE /api/goals` — soft delete (`?hard=true` for permanent + clears `milestoneId` refs) | `src/app/api/goals/route.ts` | |

### inbox

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-194 | `GET/POST/PUT /api/inbox` — list (filter agent/status)/send/update (mark read/archived) | `src/app/api/inbox/route.ts` | |
| MC-195 | `DELETE /api/inbox` — delete message | `src/app/api/inbox/route.ts` | **Unreachable from UI** — inbox UI archives, never deletes |
| MC-196 | `POST /api/inbox/respond` — trigger AI agent auto-response to a message | `src/app/api/inbox/respond/route.ts` | Spawns detached `run-inbox-respond.ts` |

### logs

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-197 | `GET /api/logs` — tail `data/daemon.log` (`?lines=N`, capped 500) | `src/app/api/logs/route.ts` | Polled by `use-daemon-logs.ts` |

### projects

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-198 | `GET/POST/PUT /api/projects` — list (filter id/status)/create/update | `src/app/api/projects/route.ts` | Backfills `teamMembers` on old records |
| MC-199 | `DELETE /api/projects` — soft delete (`?hard=true` nulls `projectId` refs on tasks/goals) | `src/app/api/projects/route.ts` | |
| MC-200 | `POST /api/projects/[id]/run` — bulk-launch all eligible project tasks respecting concurrency | `src/app/api/projects/[id]/run/route.ts` | Reports launched/skipped/queued; spawns N detached `run-task.ts` processes |

### runs

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-201 | `GET /api/runs` — list active/recent runs, self-heals dead-PID entries, merges daemon in-flight sessions | `src/app/api/runs/route.ts` | Powers "what's running now" |
| MC-202 | `GET /api/runs/[id]/output` — incremental byte-offset stream of run stdout/stderr | `src/app/api/runs/[id]/output/route.ts` | Capped 500KB/request, returns `nextOffset` + `done` flag |

### seed-demo

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-203 | `POST /api/seed-demo` — wipe + load canned demo dataset | `src/app/api/seed-demo/route.ts` | 3 projects, 4 goals, 7 tasks, 4 brain-dump entries, 4 inbox msgs, 7 activity events, 1 decision |

### sidebar

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-204 | `GET /api/sidebar` — lightweight nav-badge polling (unread inbox, pending decisions, agent list) | `src/app/api/sidebar/route.ts` | Polled by `use-sidebar.ts` |

### skills

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-205 | `GET /api/skills` — list (filter id/agentId) | `src/app/api/skills/route.ts` | |
| MC-206 | `POST /api/skills` — create skill | `src/app/api/skills/route.ts` | Writes markdown file + regenerates linked-agents' command files; 409 on duplicate id |
| MC-207 | `PUT /api/skills` — update skill | `src/app/api/skills/route.ts` | Re-syncs command files for agents linked before OR after edit |
| MC-208 | `DELETE /api/skills` — delete skill | `src/app/api/skills/route.ts` | Re-syncs any agent that referenced it |

### sync

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-209 | `POST /api/sync` — full regeneration of all `.claude/commands/*` + skill markdown files | `src/app/api/sync/route.ts` | **Unreachable from UI** — manual ops/recovery endpoint |

### tasks

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-210 | `GET /api/tasks` — token-optimized query: filter by id/assignedTo/kanban/projectId/quadrant, sparse `fields=`, `include=archived`, pagination | `src/app/api/tasks/route.ts` | The most feature-complete GET in the app; agent-facing "92% context compression" surface |
| MC-211 | `POST /api/tasks` — create task | `src/app/api/tasks/route.ts` | Sends delegation inbox message + activity event if assigned |
| MC-212 | `PUT /api/tasks` — update task | `src/app/api/tasks/route.ts` | Re-delegation notice on reassign; collaborator add/remove notice; on →done: completion event + report to "me" + auto-unblock cascade for dependents |
| MC-213 | `DELETE /api/tasks` — soft delete (`?hard=true` permanent, strips refs from `blockedBy` and goals) | `src/app/api/tasks/route.ts` | |

### tasks/[id]/run

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-214 | `POST /api/tasks/[id]/run` — launch single task's agent session | `src/app/api/tasks/[id]/run/route.ts` | Validates assignee/status/not-already-running/not-blocked/no-unanswered-blocking-decision; spawns detached `run-task.ts` |

### tasks/archive

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-215 | `GET /api/tasks/archive` — list archived tasks | `src/app/api/tasks/archive/route.ts` | **Unreachable from UI** — `include=archived` on `/api/tasks` is the wired path instead |
| MC-216 | `POST /api/tasks/archive` — bulk-archive all done tasks | `src/app/api/tasks/archive/route.ts` | **Unreachable from UI** — no "Archive completed" button found anywhere |

### tasks/bulk

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-217 | `PUT /api/tasks/bulk` — atomic bulk field update (one lock/write) | `src/app/api/tasks/bulk/route.ts` | Wired: multi-select mark-done on Status Board / Priority Matrix |
| MC-218 | `DELETE /api/tasks/bulk` — atomic bulk soft-delete | `src/app/api/tasks/bulk/route.ts` | Wired: multi-select bulk delete |

### verification-runs

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-219 | `GET /api/verification-runs` — list run manifests newest-first (`?limit`, `?taskId`) | `src/app/api/verification-runs/route.ts`, `_lib.ts` | Stops scanning once `limit` matched |
| MC-220 | `GET /api/verification-runs/[id]` — full manifest + verdict + inlined persona reports | `src/app/api/verification-runs/[id]/route.ts` | Path-traversal guarded |
| MC-221 | `GET /api/verification-runs/[id]/artifacts` — recursively list every evidence file (incl. uncited) | `src/app/api/verification-runs/[id]/artifacts/route.ts` | Capped 5000 entries, symlinks never followed |
| MC-222 | `GET /api/verification-runs/[id]/file` — stream/download one evidence file | `src/app/api/verification-runs/[id]/file/route.ts` | Double path-safety check (`safeResolve` + `realpath` re-check against symlink escape) |

---

## Daemon / CLI

### Process lifecycle & pnpm surface

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-223 | `daemon:start` — start command | `scripts/daemon/index.ts` (`handleStart`) | Probes backend health, sweeps stale verification runs, writes `data/daemon.pid`, starts scheduler, runs an initial poll |
| MC-224 | `daemon:stop` — stop command | `scripts/daemon/index.ts` (`handleStop`) | SIGTERM to PID; cleans stale PID file |
| MC-225 | `daemon:status` — status command | `scripts/daemon/index.ts` (`handleStatus`) | Prints uptime, active sessions, completed/failed stats |
| MC-226 | Graceful shutdown on SIGINT/SIGTERM | `scripts/daemon/index.ts` (`shutdown()`) | Kills child sessions via tree-kill, resets their tasks to not-started |
| MC-227 | Config hot-reload (60s interval, no restart) | `scripts/daemon/index.ts` | Reloads scheduler if config changed on disk |
| MC-228 | Full pnpm script surface | `mission-control/package.json` (`scripts`) | `dev/build/start/lint/test*/check/verify/gen:context/seed:demo/env:acceptance/daemon:*/governor:status` |
| MC-229 | `governor:status` CLI — quota table | `scripts/daemon/governor-status.ts` | Window usage, reserve floor, per-backend cooling, ledger/kill-switch paths |

### Config

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-230 | Config load/validate/save | `scripts/daemon/config.ts` | Hand-rolled per-field validation vs `DEFAULT_CONFIG`, `structuredClone` to avoid shared-object mutation bugs |
| MC-231 | Config caching (mtime+size keyed memoization) | `scripts/daemon/config-cache.ts` | Avoids re-parse/re-log on hot paths |
| MC-232 | Per-role tool grants | `scripts/daemon/config.ts` (`toolsForRole`) | Only "builder" role gets full `allowedTools` incl. Bash |
| MC-233 | Per-role deny rules | `scripts/daemon/config.ts` (`denyRulesForRole`) | Denies `data/contracts/**` to all roles; denies `data/tasks.json` to all but builder/inbox (holdout protection) |

### Dispatch & concurrency

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-234 | Concurrency enforcement (`maxParallelAgents`) | `scripts/daemon/dispatcher.ts` | Gates both new task dispatch and verification runs |
| MC-235 | Retry logic with exponential backoff | `scripts/daemon/dispatcher.ts` | Persisted retry queue (`data/daemon-retry-queue.json`), delay = base × 2^(attempt-1), capped 60min |
| MC-236 | Retry attempt cap | `scripts/daemon/dispatcher.ts`, `scripts/daemon/health.ts` (`getRetryCount`) | Skips dispatch once `retries+1` attempts exceeded |
| MC-237 | Stale in-progress task reconciliation | `scripts/daemon/dispatcher.ts` (`reconcileStaleInProgressTasks`) | Resets orphaned in-progress tasks to not-started each poll |
| MC-238 | Dependency/decision gating before dispatch | `scripts/daemon/prompt-builder.ts` (`isTaskUnblocked`, `hasBlockingPendingDecision`) | Blocks dispatch on unfinished deps or ≥1 blocking / ≥3 unanswered decisions |

### Scheduling

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-239 | Cron scheduling: daily-plan / standup / weekly-review / brain-dump-triage | `scripts/daemon/scheduler.ts`, `scripts/daemon/config.ts` | node-cron; default crons `0 7 * * *`, `0 9 * * 1-5`, `0 17 * * 5`, triage disabled by default |
| MC-240 | Task polling loop | `scripts/daemon/scheduler.ts`, `scripts/daemon/dispatcher.ts` (`pollAndDispatch`) | Reconcile → retries → dispatch pending → dispatch verifications → prune |
| MC-241 | Scheduled-command execution | `scripts/daemon/dispatcher.ts` (`runScheduledCommand`), `prompt-builder.ts` | Reads `.claude/commands/<cmd>/user.md`, spawns governor-gated (Read/Edit/Write only) |

### File locking & security

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-242 | Cross-process file locking (atomic mkdir mutex) | `scripts/daemon/file-lock.ts` (`withFileLock`) | Jittered busy-wait, force-breaks stale locks after 15s; used for all `data/*.json` read-modify-write |
| MC-243 | Credential scrubbing | `scripts/daemon/security.ts` (`scrubCredentials`) | Regex denylist (API keys, Bearer tokens, AWS/GitHub/npm/Slack/Stripe/Anthropic tokens, SSH keys, DB conn strings) applied to all logs/output/transcripts |
| MC-244 | Path-traversal validation | `scripts/daemon/security.ts` (`validatePathWithinWorkspace`) | |
| MC-245 | Prompt-injection fencing | `scripts/daemon/security.ts` (`fenceTaskData`), `prompt-builder.ts` | Escapes closing tags in untrusted task text |
| MC-246 | Prompt size limit (100KB, staged degradation) | `scripts/daemon/security.ts` (`enforcePromptLimit`) | Avoids argv E2BIG spawn failures |
| MC-247 | Binary allowlist (claude/codex/gemini only) | `scripts/daemon/security.ts` (`validateBinary`) | |
| MC-248 | Safe child-process environment | `scripts/daemon/security.ts` (`buildSafeEnv`) | Strips API keys/AWS/GitHub/npm/Stripe/DB vars + nested-session markers before handing env to spawned CLI |

### Health & logging

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-249 | Health monitoring / active session tracking | `scripts/daemon/health.ts` (`HealthMonitor`) | Rolling history (50), atomic write of `data/daemon-status.json` |
| MC-250 | Stale-session detection (PID probe every minute) | `scripts/daemon/health.ts` (`cleanStaleSessions`) | Proactively frees concurrency slot on dead PID |
| MC-251 | Quota-deferred session bookkeeping | `scripts/daemon/health.ts` (`deferSession`) | Deferral never counts against retry budget |
| MC-252 | Log rotation (1MB, 3 rotated files) | `scripts/daemon/logger.ts` (`rotateIfNeeded`) | |
| MC-253 | Leveled/tagged logging incl. SECURITY level | `scripts/daemon/logger.ts` (`DaemonLogger`) | |
| MC-254 | Append-only run-output capture (JSONL, 72h prune) | `scripts/daemon/output-writer.ts` (`OutputWriter`) | Scrubs credentials per chunk, sanitizes runId |

### Prompt construction

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-255 | Task prompt construction (persona + skills + fenced instructions + SOP) | `scripts/daemon/prompt-builder.ts` (`buildTaskPrompt`) | |
| MC-256 | Verification-failure feedback loop injected into rebuild prompt | `scripts/daemon/prompt-builder.ts` (`buildVerificationFeedback`) | Capped 2000 chars, fenced |
| MC-257 | Subtask-progress reporting protocol (trailing fenced JSON) | `scripts/daemon/prompt-builder.ts` (`parseCompletedSubtaskIds`) | Because `data/tasks.json` is denied to builder spawns |

### Standalone CLI entrypoints

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-258 | Multi-backend CLI auto-detection | `scripts/daemon/runner.ts` (`findCliBinary`) | Config override → common paths → `which`/`where` → fallback name |
| MC-259 | Backend probing on daemon start | `scripts/daemon/runner.ts` (`probeBackend`), `scripts/daemon/index.ts` | Logs availability without spawning a task |
| MC-260 | Restriction-aware argv building per backend | `scripts/daemon/runner.ts` (`decideBackend`, `buildArgs`) | Maps allowedTools/skipPermissions/model to each CLI's actual flags; fails closed if unexpressible |
| MC-261 | Process spawn + timeout/tree-kill | `scripts/daemon/runner.ts` (`spawnAgent`, `killSession`) | argv array (no shell interpolation), SIGTERM→SIGKILL, 10MB output cap |
| MC-262 | `run-task.ts <taskId>` — standalone task runner CLI | `scripts/daemon/run-task.ts` | Quota-gates, writes `active-runs.json`, backend fallback chain, kicks verification on success |
| MC-263 | `run-inbox-respond.ts <messageId>` — standalone inbox auto-respond CLI | `scripts/daemon/run-inbox-respond.ts` | No-Bash session, posts fallback reply if agent didn't |
| MC-264 | `run-brain-dump-triage.ts <entryId...>` — standalone triage CLI | `scripts/daemon/run-brain-dump-triage.ts` | Eisenhower-quadrant categorization + task creation, capped 20 turns/10 min |

### Utility scripts

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-265 | `pnpm seed:demo` — seed demo dataset | `scripts/seed-demo.ts` | |
| MC-266 | `pnpm gen:context` — generate AI context snapshot | `scripts/generate-context.ts` | Writes `data/ai-context.md`; deliberately omits `acceptanceCriteria` (holdout leak prevention) |
| MC-267 | Verification-status migration (idempotent backfill) | `scripts/migrate-verification-status.ts` | Adds `verificationStatus: "unverified"` to legacy tasks |
| MC-268 | Crew task bulk-create script | `scripts/create-crew-tasks.mjs` | POSTs hardcoded seed batch to local `/api/tasks` |
| MC-269 | Branch-protection setup script | `scripts/setup-branch-protection.sh` | One-shot `gh api` repo-admin config, unrelated to daemon runtime |
| MC-270 | Brain-dump triage script (empty file) | `scripts/triage-bd.js` | **Dead — file exists but is empty, no functionality** |

### Start/stop scripts

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-271 | Start/stop scripts (macOS/Linux) | `start-mission-control.sh`, `stop-mission-control.sh` | PID-file/port pre-flight, backgrounds `pnpm dev`, opens browser when ready |
| MC-272 | Start/stop scripts (Windows) | `start-mission-control.bat`, `stop-mission-control.bat` | netstat port check, PowerShell browser poller, taskkill fallback via wmic |

---

## Engine

### Multi-backend dispatch & rotation

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-273 | Backend selection modes: claude / codex / gemini / mixed (per-task tag routing) | `scripts/daemon/config.ts` (`execution.backendMode`), `scripts/daemon/dispatcher.ts` (`resolveBackendForTask`) | Confirmed via `data/daemon-config.json`: `codexTaskTags`, `geminiTaskTags` |
| MC-274 | Governor role-routing overrides backend mode | `scripts/daemon/dispatcher.ts` (`resolveBackendForTask`/`resolveBackendForNonTask`) | `governor.roleRouting.builder/scheduled` wins whenever it points off "claude" |
| MC-275 | Consecutive-failure auto-failover rotation (claude→gemini→codex→claude…) | `scripts/daemon/dispatcher.ts` (`recordBackendOutcome`, `BACKEND_ROTATION`) | After `claudeAutoFailoverThreshold` consecutive availability failures |
| MC-276 | Per-attempt fallback chain within one dispatch | `scripts/daemon/dispatcher.ts` (`spawnTaskWithFallback`), `scripts/daemon/run-task.ts` | Each fallback re-passes the quota governor |
| MC-277 | Restriction-aware backend skipping (fail closed) | `scripts/daemon/runner.ts` (`canBackendHonorRestrictions`) | Never spawns unrestricted when a backend can't express a grant; deferred if chain empty |
| MC-278 | Per-backend deny-rule expressiveness warning | `scripts/daemon/runner.ts` (`warnUnexpressibleDeny`) | Only claude enforces `--disallowedTools`; codex/gemini spawns log which deny rules aren't enforced |
| MC-279 | Configurable per-backend settings (binary path/model/task-routing tags) | `scripts/daemon/types.ts` (`DaemonConfig.execution`) | |

### Quota governor

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-280 | Rolling-window quota + reserve floor + file-based kill switch | `scripts/daemon/quota-governor.ts` | Governs Claude-subscription usage only; `reservePercent` floor for interactive human use |
| MC-281 | Atomic race-safe claim (`claimSpawn`) | `scripts/daemon/quota-governor.ts` | Decide-and-book in one `withFileLock` r-m-w on `data/quota-ledger.json` |
| MC-282 | Backend cooling/backoff on real availability failures | `scripts/daemon/quota-governor.ts` | Exponential 1m→30m cap, cleared on success |
| MC-283 | Role→backend routing overrides | `scripts/daemon/quota-governor.ts` (`resolveRoleBackend`), `types.ts` (`GovernorConfig.roleRouting`) | |
| MC-284 | Waiting vs aborting semantics (builder never blocks, harness spawns wait up to 20min) | `scripts/daemon/quota-governor.ts` (`awaitSpawn`), `scripts/harness/spawn-slot.ts` (`awaitClaimedSlot`) | Avoids wasting a partial persona panel |
| MC-285 | Quota-window accounting is backend-aware (claude only) | `scripts/daemon/quota-governor.ts` (`decide()`) | codex/gemini bypass the window, still respect cooling |

### Ephemeral environments

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-286 | Create ephemeral env (git-worktree isolation off a dangling snapshot commit) | `scripts/env/lifecycle.ts` (`createEnv`) | Snapshots the *uncommitted working tree*, not HEAD — verifies the builder's actual edits |
| MC-287 | Teardown ephemeral env (best-effort: stop process, remove worktree, delete branch) | `scripts/env/lifecycle.ts` (`teardownEnv`) | Each step independent so a failure doesn't block the rest |
| MC-288 | List ephemeral envs / manifest persistence with per-phase timings | `scripts/env/manifest.ts`, `scripts/env/lifecycle.ts` (`listEnvs`) | `data/ephemeral-envs.json`; worktree/install/seed/boot/health/total ms |
| MC-289 | Reconcile orphaned envs (dead-PID + stray worktree detection) | `scripts/env/manifest.ts`, `scripts/env/preflight.ts` (`findDeadEnvs`, `orphanWorktreeDirs`) | |
| MC-290 | Mission Control target adapter (install/seed/boot/health per env) | `scripts/env/mission-control-adapter.ts` | |
| MC-291 | Deterministic seeded dataset per env (PRNG seed) | `scripts/env/mission-control-adapter.ts` | Same seed ⇒ same data, for reproducible persona runs |
| MC-292 | Free-port allocation for env boot | `scripts/env/mission-control-adapter.ts` (`getFreePort`) | |
| MC-293 | Environment preflight checks (node/pnpm/git/disk/manifest/orphans/boot-logs/chromium/quota-ledger) | `scripts/env/preflight.ts` (`runPreflight`) | Fast, offline, no writes |
| MC-294 | One-click preflight fixes (closed enum) | `scripts/env/preflight.ts` (`applyPreflightFix`, `FIX_KINDS`) | reconcile-orphans / prune-boot-logs / reset-env-manifest / install-chromium — no freeform command ever runs |
| MC-295 | `pnpm env:acceptance` — Phase-1 acceptance CLI entrypoint | `scripts/env/acceptance-phase1.ts` | |
| MC-296 | Mutation/fault-injection hook on fresh worktree | `scripts/env/lifecycle.ts` (`CreateEnvOptions.mutate`), `scripts/harness/mutations/drop-notes-field.ts` | Used by the harness's own acceptance test (`--mutate`) to prove the persona panel catches a planted defect |

---

## Harness (Acceptance-testing subsystem)

### Contracts

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-297 | Deterministic contract compilation (criteria → Criterion objects, no LLM) | `scripts/harness/compile-contract.ts` (`compileDeterministicContract`) | Automatic on builder completion |
| MC-298 | LLM contract compilation (rephrase + propose invariants) | `scripts/harness/compile-contract.ts` (`compileWithLlm`) | `--llm [--conversation <path>]`; parse failure is fatal, no silent fallback |
| MC-299 | Holdout criteria withholding (~30% hidden from builder) | `scripts/harness/compile-contract.ts` (`assignHoldouts`) | Deterministic sha256 split per (scope, criterion); 100% of invariants held out |
| MC-300 | Contract storage — append-only signed JSONL per task | `scripts/harness/contract-store.ts` (`saveContract`, `getLatestContract`, `verifyContract`) | `data/contracts/<taskId>.jsonl` |

### Signing

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-301 | Ed25519 keypair generation & persistence | `scripts/harness/signing.ts` (`getOrCreateSigningKey`) | `data/harness-signing-key.json`, mode 0600, gitignored |
| MC-302 | Ed25519 signing of contracts | `scripts/harness/signing.ts` (`sign`), `contract-store.ts` | Signs sha256(canonicalized JSON) |
| MC-303 | Ed25519 signature verification (fails loud on tampering) | `scripts/harness/signing.ts` (`verify`) | Logs whether failure is hash mismatch vs bad signature |
| MC-304 | Judge verifies contract signature before judging | `scripts/harness/judge.ts` (`runJudge`) | Tampered contract → signed `outcome: "error"`, never treated as a product failure |
| MC-305 | Ed25519-signed verdicts | `scripts/harness/judge.ts` (`signVerdict`) | Every `VerificationVerdict` (pass/fail/error) signed |

### Persona panel

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-306 | Naive-user persona (×N, distinct seeded personalities) | `scripts/harness/personas.ts` (`NAIVE_SEEDS`) | Default runs 3× with distinct seeds, no shared memory |
| MC-307 | Saboteur persona (targets invariants) | `scripts/harness/personas.ts` | Double-submit/back/reload/hostile-paste/two-tab/offline/tiny-viewport playbook |
| MC-308 | Returning-user persona (data persistence across reload/new session) | `scripts/harness/personas.ts` | |
| MC-309 | Visual-critic persona (responsive/contrast/keyboard-nav rubric, 3 viewports) | `scripts/harness/personas.ts` | Includes a11y rubric + axe-core call |
| MC-310 | Spec-auditor persona (walks full contract incl. holdouts) | `scripts/harness/personas.ts` | Only charter allowed to mark criteria met/not-met/not-tested |
| MC-311 | Smoke-test mode (`--smoke`: naive-user×1 + spec-auditor only) | `scripts/harness/run-verification.ts` | |
| MC-312 | Persona isolation & Bash-only tooling | `scripts/harness/personas.ts` (`runPersona`) | Fresh CLI session per persona, no Read/Edit/Write, empty sandbox cwd |
| MC-313 | Concurrent persona execution with cancellation-safe teardown | `scripts/harness/run-verification.ts` (`mapWithLimit`) | Fixed-size worker pool via `config.execution.harness.maxParallelPersonas` |

### Judge

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-314 | Fail-default judge logic | `scripts/harness/judge.ts` (`parseJudgeOutput`, `computeOutcome`) | Every criterion seeded `unknown`; pass requires ALL "met" + no blocker findings + no invalid load-bearing run |
| MC-315 | Judge-model ≠ builder-model enforcement | `scripts/harness/judge.ts` (`assertJudgeModel`) | Refuses to run unless configured judge model differs from builder's |
| MC-316 | Judge prompt degradation under size cap | `scripts/harness/judge.ts` (`buildJudgePrompt`, `dropOrder`) | Caps finding text/evidence → drops low-priority charters → strips findings; every drop named so judge downgrades to `unknown` |
| MC-317 | Judge harness-error vs product-failure distinction | `scripts/harness/judge.ts` (`harnessError`) | Crash/timeout → signed `outcome: "error"`, task position untouched |

### Verdicts & evidence

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-318 | Single choke point for writing `kanban: "done"` | `scripts/harness/verdict.ts` (`applyVerdict`) | Only path allowed to mark done — passed verdict, or honest "waived" (no criteria) |
| MC-319 | Verification-attempt cap with escalation | `scripts/harness/verdict.ts` (`maxVerificationAttempts`) | Default 3; hits → one-time inbox report + decision card, explicitly not a claim the work is wrong |
| MC-320 | Stale/killed run reclamation | `scripts/harness/verdict.ts` (`isRunLive`, `sweepStaleVerificationRuns`) | A "running" run is trusted only while its PID is alive within 2× timeout |
| MC-321 | Evidence locker (on-disk artifact layout) | `scripts/harness/types.ts`, `run-verification.ts` | `data/verification-runs/<runId>/{run.json,verdict.json,personas/<charter>/{report.json,transcript.jsonl,steps.jsonl,shots/*.png}}` |
| MC-322 | Evidence retention/pruning (72h) | `scripts/harness/verdict.ts` (`pruneVerificationEvidence`) | Deletes screenshots/transcripts/steps, permanently keeps verdict/report as audit trail |
| MC-323 | End-to-end verification run orchestration | `scripts/harness/run-verification.ts` (`main`) | contract → createEnv → startBridge → persona panel → judge → applyVerdict → teardownEnv, per-phase timings |
| MC-324 | Structured CLI-output parsing (shared across compiler/personas/judge) | `scripts/harness/personas.ts` (`unwrapCliReply`, `extractFencedJson`) | Takes the LAST fenced JSON block; one parser for 3 CLI envelope shapes |
| MC-325 | Governed spawn-slot waiting for harness spawns | `scripts/harness/spawn-slot.ts` (`awaitClaimedSlot`) | Poll-claims a governor slot; `GovernorAbort` only on kill-switch/timeout |
| MC-326 | Kill-switch pre-check before booting an env | `scripts/harness/run-verification.ts` | Refuses to start a run if quota governor kill switch active |

### Browser bridge

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| MC-327 | Capability-URL HTTP bridge (one per run, shared Chromium) | `scripts/harness/browser-bridge.ts` (`startBridge`) | Each persona gets its own BrowserContext + unguessable 128-bit session token |
| MC-328 | Bridge action surface (goto/click/fill/press/back/reload/viewport/newtab/switchtab/offline/snapshot/screenshot/console/network) | `scripts/harness/browser-bridge.ts` (`perform()`) | Personas drive it via curl (Bash-only grant) |
| MC-329 | Origin lockdown (403 outside product origin) | `scripts/harness/browser-bridge.ts` (`resolveUrl`) | Prevents wandering onto the open internet or another env's port |
| MC-330 | Auth/host hardening (constant-time token compare, loopback-only Host) | `scripts/harness/browser-bridge.ts` (`tokenMatches`, `isLoopbackHost`) | Blocks timing attacks + DNS rebinding |
| MC-331 | Automatic evidence capture (auto-screenshot on mutating/goto/click, steps.jsonl) | `scripts/harness/browser-bridge.ts` (`recordStep`) | Evidence exists even if a persona misreports its actions |
| MC-332 | Fault-injection mutation testing (`--mutate <module>`) | `scripts/harness/run-verification.ts`, `scripts/harness/mutations/drop-notes-field.ts` | Shipped example silently drops a field server-side — the harness's own acceptance test for itself |

---

## Dead / Unreachable UI flagged (relevant to seam audit)

| # | Finding | Where |
|---|---|---|
| 1 | `SidebarNav` component is entirely unused — zero imports across `src/`. Legacy sidebar superseded by `app-sidebar.tsx`. | `src/components/sidebar-nav.tsx` |
| 2 | `/verification/[id]` full-page tabbed report has **no in-app entry point** — no `Link`/`href` anywhere builds that URL. The Task Detail Panel renders `VerificationReport` inline/compact directly, bypassing the standalone page. Only reachable by manually typing the URL. | `src/app/verification/[id]/page.tsx`, `src/components/task-detail-panel.tsx` |
| 3 | `/launch` (Autopilot) has **no sidebar link** — reachable only via the dashboard card link and the `G L` keyboard shortcut. Likely intentional (dashboard-primary CTA) but easy to miss. | `src/components/app-sidebar.tsx` |
| 4 | `KeyboardShortcuts`'s "N" shortcut (create task) is **inert** — `layout-shell.tsx` instantiates `<KeyboardShortcuts />` with no `onCreateTask` prop, so pressing N does nothing, even though the shortcuts help dialog still advertises it. | `src/components/keyboard-shortcuts.tsx`, `src/components/layout-shell.tsx` |
| 5 | `DecisionDialog` is a **second, separate answer surface** from the Decisions page's own deck/list UI — wired instead into `active-runs-provider.tsx` as a pre-run blocking-decision prompt. Not dead, but a parallel code path against the same `DecisionItem` data worth reconciling. | `src/components/decision-dialog.tsx`, `src/providers/active-runs-provider.tsx` |
| 6 | `scripts/triage-bd.js` is an **empty file** — no functionality despite existing in the tree. | `scripts/triage-bd.js` |
| 7 | 9 API routes implemented but **no UI ever calls them** (see MC-166, MC-167, MC-171, MC-186, MC-189, MC-195, MC-209, MC-215, MC-216) — mostly agent/backend-only writes (activity-log POST/DELETE, decisions POST/DELETE, inbox DELETE) or manual ops endpoints (sync, tasks/archive GET+POST, agents DELETE). | see API section above |

---

**Row count: 332** (MC-001–MC-332), grouped into 5 areas: Pages (163), API (58), Daemon/CLI (50), Engine (24), Harness (36), plus a 7-item dead/unreachable appendix. Exceeds the 60–120 suggested range — the codebase's actual surface area (fine-grained UI actions × token-optimized API × daemon/governor internals × acceptance harness) warranted finer splitting to stay useful for a parity diff.

*(Note, 2026-08-27: the five group counts above sum to 331, one short of the stated 332 — one area's count is off by one somewhere. Flagged, not corrected here: recounting which of the five groups is short needs a full row-by-row recount this pass didn't do. See `docs/audits/docs-audit-2026-08-27.md` D41.)*
