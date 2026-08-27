import { describe, expect, it } from 'vitest';
import { deriveGoalStatus } from './goals';
import type { Task } from './types';

function task(kanban: Task['kanban']): Pick<Task, 'kanban'> {
  return { kanban };
}

describe('deriveGoalStatus', () => {
  // Walkthrough M3: "Not Started" badge over a 7/7-complete checklist, and
  // "0/4 milestones" over "78/78 tasks" on the same card — both caused by
  // reading the stored `status` field instead of the linked tasks.
  it('reads completed from a fully-done checklist, ignoring a stale stored status', () => {
    const linked = Array.from({ length: 7 }, () => task('done'));
    expect(deriveGoalStatus(linked, 'not-started')).toBe('completed');
  });

  it('reads in-progress once any linked task has moved, ignoring a stale not-started status', () => {
    const linked = [task('done'), task('in-progress'), task('not-started')];
    expect(deriveGoalStatus(linked, 'not-started')).toBe('in-progress');
  });

  it('reads not-started when every linked task is still not-started', () => {
    const linked = [task('not-started'), task('not-started')];
    expect(deriveGoalStatus(linked, 'completed')).toBe('not-started');
  });

  it("falls back to the stored status when nothing is linked yet — the field's actual job", () => {
    expect(deriveGoalStatus([], 'not-started')).toBe('not-started');
    expect(deriveGoalStatus([], 'in-progress')).toBe('in-progress');
  });
});
