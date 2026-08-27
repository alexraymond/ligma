import type { KanbanStatus } from '@ligma/api';

/**
 * Single source of truth for how a kanban status renders — label + dot color.
 * Used by task-card, command-bar, and task-form. Add a new KanbanStatus here
 * once and every consumer picks it up; the Record<KanbanStatus, ...> type
 * makes an incomplete mapping a compile error instead of a silently missed spot.
 */
export const kanbanLabels: Record<KanbanStatus, string> = {
  'not-started': 'Todo',
  'in-progress': 'Active',
  'awaiting-verification': 'Verify',
  done: 'Done',
};

export const kanbanDot: Record<KanbanStatus, string> = {
  'not-started': 'bg-status-not-started',
  'in-progress': 'bg-status-in-progress',
  'awaiting-verification': 'bg-amber-500',
  done: 'bg-status-done',
};
