import type { Task } from '@ligma/api';
/**
 * Pure logic behind the Board's Done-column collapse (walkthrough M4: 200
 * cards rendered into a 36,900px page). `BoardColumn` itself needs
 * `dnd-kit`'s droppable context to render, so the branchy part — what's
 * visible, and in what order — is pulled out here where it can be tested
 * without a DOM (`vitest.config.ts` runs in the "node" environment).
 */
import { describe, expect, it } from 'vitest';
import { DONE_COLLAPSE_LIMIT, sortByCompletedRecency, visibleColumnTasks } from './board-view';

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    importance: 'important',
    urgency: 'not-urgent',
    kanban: 'done',
    verificationStatus: 'unverified',
    projectId: null,
    milestoneId: null,
    assignedTo: null,
    collaborators: [],
    dailyActions: [],
    subtasks: [],
    blockedBy: [],
    estimatedMinutes: null,
    actualMinutes: null,
    acceptanceCriteria: [],
    comments: [],
    tags: [],
    notes: '',
    dueDate: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    deletedAt: null,
    ...overrides,
  } as Task;
}

describe('sortByCompletedRecency', () => {
  it('orders newest completedAt first', () => {
    const a = task('a', { completedAt: '2026-01-01T00:00:00Z' });
    const b = task('b', { completedAt: '2026-01-03T00:00:00Z' });
    const c = task('c', { completedAt: '2026-01-02T00:00:00Z' });
    expect(sortByCompletedRecency([a, b, c]).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('falls back to updatedAt when completedAt is missing', () => {
    const a = task('a', { completedAt: null, updatedAt: '2026-01-01T00:00:00Z' });
    const b = task('b', { completedAt: null, updatedAt: '2026-01-05T00:00:00Z' });
    expect(sortByCompletedRecency([a, b]).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const a = task('a', { completedAt: '2026-01-01T00:00:00Z' });
    const b = task('b', { completedAt: '2026-01-02T00:00:00Z' });
    const input = [a, b];
    sortByCompletedRecency(input);
    expect(input).toEqual([a, b]);
  });
});

describe('visibleColumnTasks', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => task(`t${i}`));

  it('returns everything when there is no limit', () => {
    expect(visibleColumnTasks(tasks, undefined, false)).toHaveLength(25);
  });

  it('returns everything when under the limit', () => {
    expect(visibleColumnTasks(tasks.slice(0, 5), DONE_COLLAPSE_LIMIT, false)).toHaveLength(5);
  });

  it('slices to the limit when over it and not expanded', () => {
    const visible = visibleColumnTasks(tasks, DONE_COLLAPSE_LIMIT, false);
    expect(visible).toHaveLength(DONE_COLLAPSE_LIMIT);
    expect(visible.map((t) => t.id)).toEqual(tasks.slice(0, DONE_COLLAPSE_LIMIT).map((t) => t.id));
  });

  it('returns everything once expanded', () => {
    expect(visibleColumnTasks(tasks, DONE_COLLAPSE_LIMIT, true)).toHaveLength(25);
  });
});
