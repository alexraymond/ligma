/**
 * Pure summary of what "Stop everything now" actually did, built from a
 * snapshot of `status.activeSessions` taken *before* calling stop() — by the
 * time the daemon reports back, activeSessions is empty, so the aftermath
 * panel has nothing truthful to show unless the caller freezes the list
 * first. Kept in its own module (no React) so the honesty of this copy is
 * unit-testable node-side.
 *
 * Mirrors exactly what apps/daemon/src/engine/lifecycle.ts `stopEngine()`
 * does to each active session — no more, no less:
 *   - the session's process is killed
 *   - if the session had a task, `resetTaskToNotStarted` returns it to
 *     "not-started" — UNLESS it had already reached "done" or
 *     "awaiting-verification", which a shutdown never re-queues as fresh work
 *   - the session itself is closed with reason "Daemon shutdown"
 *
 * A session snapshot doesn't carry its task's kanban state, so this can't
 * claim every task was reset — only that a reset was attempted, with the
 * same caveat lifecycle.ts itself applies.
 */

export interface AftermathSessionSnapshot {
  id: string;
  agentId: string;
  taskId: string | null;
}

export interface RecoveryLink {
  label: string;
  detail: string;
  href: string;
}

export interface AftermathSummary {
  endedCount: number;
  sessions: AftermathSessionSnapshot[];
  /** One honest sentence about what happens to the sessions' tasks — never per-session, since the caveat is a blanket rule. */
  taskNote: string;
  recoveryLinks: RecoveryLink[];
}

const TASK_NOTE =
  'Each ended session\'s task is returned to "not started" — unless it had already reached done or awaiting-verification, which is left exactly as it was.';
const NO_TASK_NOTE = 'None of the ended sessions had a task attached.';

const RECOVERY_LINKS: RecoveryLink[] = [
  { label: 'Runs', detail: 'what ran', href: '/runs' },
  { label: 'Activity', detail: 'what happened', href: '/activity' },
  { label: 'Checkpoints', detail: 'restore points', href: '/settings/checkpoints' },
];

export function aftermathSummary(snapshot: AftermathSessionSnapshot[]): AftermathSummary {
  const hadAnyTask = snapshot.some((s) => s.taskId !== null);
  return {
    endedCount: snapshot.length,
    sessions: snapshot,
    taskNote: hadAnyTask ? TASK_NOTE : NO_TASK_NOTE,
    recoveryLinks: RECOVERY_LINKS,
  };
}
