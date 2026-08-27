/**
 * Goal/milestone status — one derivation, read by web and daemon alike
 * (walkthrough M3: "Not Started" over a 7/7-complete checklist, `0/4
 * milestones` over `78/78 tasks` on the same card).
 *
 * `Goal.status` is a field the user sets by hand — useful before any task is
 * linked ("not started" as a stated intent), and left alone afterwards: the
 * store never rewrites it when a linked task's kanban changes, so it goes
 * stale by design the moment tasks exist. A badge that sits next to a task
 * count must agree with that count, so display status is derived from the
 * linked tasks themselves once there are any; the stored field stays exactly
 * what it always was — the pre-task intent, and whatever the user last typed
 * into the edit dialog — it just stops being read for display.
 */
import type { GoalStatus, Task } from './types';

export function deriveGoalStatus(
  linkedTasks: Pick<Task, 'kanban'>[],
  storedStatus: GoalStatus,
): GoalStatus {
  if (linkedTasks.length === 0) return storedStatus;
  if (linkedTasks.every((t) => t.kanban === 'done')) return 'completed';
  if (linkedTasks.some((t) => t.kanban !== 'not-started')) return 'in-progress';
  return 'not-started';
}
