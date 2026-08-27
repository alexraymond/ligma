import type { Goal, Task } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { GOAL_PILL_STATE, groupPlan } from './plan-view';

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'not-started',
    verificationStatus: 'unverified',
    projectId: 'proj',
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

function goal(id: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    title: id,
    type: 'long-term',
    timeframe: '',
    parentGoalId: null,
    projectId: 'proj',
    status: 'not-started',
    milestones: [],
    tasks: [],
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('groupPlan', () => {
  it('nests milestones under their parent goal', () => {
    const plan = groupPlan(
      [goal('g1'), goal('m1', { type: 'medium-term', parentGoalId: 'g1', tasks: ['t1'] })],
      [task('t1')],
    );
    expect(plan.goals).toHaveLength(1);
    expect(plan.goals[0].goal.id).toBe('g1');
    expect(plan.goals[0].milestones.map((m) => m.goal.id)).toEqual(['m1']);
    expect(plan.goals[0].milestones[0].tasks.map((t) => t.id)).toEqual(['t1']);
    expect(plan.ungrouped).toEqual([]);
  });

  it("links tasks by the goal's task list or by the task's own milestoneId", () => {
    const plan = groupPlan(
      [goal('g1', { tasks: ['t1'] }), goal('m1', { type: 'medium-term', parentGoalId: 'g1' })],
      [task('t1'), task('t2', { milestoneId: 'm1' })],
    );
    expect(plan.goals[0].tasks.map((t) => t.id)).toEqual(['t1']);
    expect(plan.goals[0].milestones[0].tasks.map((t) => t.id)).toEqual(['t2']);
  });

  it('puts a task claimed by both the parent and its milestone under the milestone only', () => {
    const plan = groupPlan(
      [
        goal('g1', { tasks: ['t1'] }),
        goal('m1', { type: 'medium-term', parentGoalId: 'g1', tasks: ['t1'] }),
      ],
      [task('t1')],
    );
    expect(plan.goals[0].tasks).toEqual([]);
    expect(plan.goals[0].milestones[0].tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it("buckets unclaimed tasks under 'no goal' rather than dropping them", () => {
    const plan = groupPlan([goal('g1', { tasks: ['t1'] })], [task('t1'), task('t2')]);
    expect(plan.ungrouped.map((t) => t.id)).toEqual(['t2']);
  });

  it('keeps an orphan milestone (parent outside this project) as its own group', () => {
    const plan = groupPlan(
      [goal('m1', { type: 'medium-term', parentGoalId: 'elsewhere', tasks: ['t1'] })],
      [task('t1')],
    );
    expect(plan.goals.map((g) => g.goal.id)).toEqual(['m1']);
    expect(plan.goals[0].tasks.map((t) => t.id)).toEqual(['t1']);
    expect(plan.ungrouped).toEqual([]);
  });

  it('derives status from the linked tasks, not the stored value', () => {
    const plan = groupPlan(
      [
        goal('g1', { status: 'not-started' }),
        goal('m1', {
          type: 'medium-term',
          parentGoalId: 'g1',
          status: 'not-started',
          tasks: ['t1'],
        }),
      ],
      [task('t1', { kanban: 'done' })],
    );
    expect(plan.goals[0].milestones[0].status).toBe('completed');
    // The parent answers for everything beneath it, milestone tasks included.
    expect(plan.goals[0].status).toBe('completed');
  });

  it('leaves a goal with no tasks on its stored status', () => {
    const plan = groupPlan([goal('g1', { status: 'in-progress' })], []);
    expect(plan.goals[0].status).toBe('in-progress');
    expect(plan.goals[0].tasks).toEqual([]);
  });

  it('maps every goal status onto a status-pill execution state', () => {
    expect(GOAL_PILL_STATE).toEqual({
      'not-started': 'queued',
      'in-progress': 'running',
      completed: 'done',
    });
  });
});
