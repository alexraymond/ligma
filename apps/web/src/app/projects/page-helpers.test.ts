import type { Goal, Project, Task } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import {
  groupLongTermGoals,
  parseView,
  projectDonePercent,
  projectOpenTasks,
  sortProjects,
  sortTasks,
} from './page-helpers';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Alpha',
    description: '',
    status: 'active',
    color: '#000',
    teamMembers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    deletedAt: null,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Task',
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'not-started',
    verificationStatus: 'unverified',
    projectId: 'p1',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    title: 'Goal',
    type: 'long-term',
    timeframe: '',
    status: 'not-started',
    projectId: null,
    parentGoalId: null,
    milestones: [],
    tasks: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('parseView', () => {
  it('defaults to projects when the param is missing', () => {
    expect(parseView(null)).toBe('projects');
  });

  it('accepts the three known views', () => {
    expect(parseView('projects')).toBe('projects');
    expect(parseView('goals')).toBe('goals');
    expect(parseView('tasks')).toBe('tasks');
  });

  it('falls back to projects for anything unrecognized', () => {
    expect(parseView('bogus')).toBe('projects');
    expect(parseView('')).toBe('projects');
  });
});

describe('projectOpenTasks / projectDonePercent', () => {
  const tasks = [
    task({ id: 't1', kanban: 'not-started' }),
    task({ id: 't2', kanban: 'done' }),
    task({ id: 't3', kanban: 'in-progress' }),
    task({ id: 't4', projectId: 'other' }),
  ];

  it('counts non-done tasks for this project only', () => {
    expect(projectOpenTasks(project({ id: 'p1' }), tasks)).toBe(2);
  });

  it('computes done percent, rounded', () => {
    expect(projectDonePercent(project({ id: 'p1' }), tasks)).toBe(33);
  });

  it('returns 0% for a project with no tasks', () => {
    expect(projectDonePercent(project({ id: 'empty' }), tasks)).toBe(0);
  });
});

describe('sortProjects', () => {
  const projects = [
    project({ id: 'p1', name: 'Zeta', status: 'archived' }),
    project({ id: 'p2', name: 'Alpha', status: 'active' }),
    project({ id: 'p3', name: 'Mid', status: 'paused' }),
  ];
  const tasks = [
    task({ id: 't1', projectId: 'p1', kanban: 'done' }),
    task({ id: 't2', projectId: 'p2', kanban: 'not-started' }),
    task({ id: 't3', projectId: 'p2', kanban: 'not-started' }),
  ];

  it('sorts by name', () => {
    expect(sortProjects(projects, tasks, 'name').map((p) => p.name)).toEqual([
      'Alpha',
      'Mid',
      'Zeta',
    ]);
  });

  it('sorts by status (active before paused before archived)', () => {
    expect(sortProjects(projects, tasks, 'status').map((p) => p.status)).toEqual([
      'active',
      'paused',
      'archived',
    ]);
  });

  it('sorts by open tasks, most first (ties broken by name)', () => {
    // p2 has 2 open tasks; p1 and p3 both have 0, so the tie falls back to name (Mid < Zeta).
    expect(sortProjects(projects, tasks, 'openTasks').map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('does not mutate the input array', () => {
    const copy = [...projects];
    sortProjects(projects, tasks, 'name');
    expect(projects).toEqual(copy);
  });
});

describe('groupLongTermGoals', () => {
  const projects = [project({ id: 'p1', name: 'Alpha' }), project({ id: 'p2', name: 'Beta' })];

  it('groups long-term goals by project', () => {
    const goals = [
      goal({ id: 'g1', projectId: 'p2' }),
      goal({ id: 'g2', projectId: 'p1' }),
      goal({ id: 'g3', type: 'medium-term', projectId: 'p1' }),
    ];
    const groups = groupLongTermGoals(goals, projects);
    expect(groups.map((g) => g.projectName)).toEqual(['Alpha', 'Beta']);
    expect(groups[0].goals.map((g) => g.id)).toEqual(['g2']);
  });

  it('puts project-less goals in their own trailing group', () => {
    const goals = [goal({ id: 'g1', projectId: 'p1' }), goal({ id: 'g2', projectId: null })];
    const groups = groupLongTermGoals(goals, projects);
    expect(groups.at(-1)).toEqual({ projectId: null, projectName: null, goals: [goals[1]] });
  });

  it('omits the project-less group entirely when there are none', () => {
    const groups = groupLongTermGoals([goal({ projectId: 'p1' })], projects);
    expect(groups.some((g) => g.projectId === null)).toBe(false);
  });
});

describe('sortTasks', () => {
  const projects = [project({ id: 'p1', name: 'Alpha' }), project({ id: 'p2', name: 'Beta' })];
  const tasks = [
    task({
      id: 't1',
      title: 'Zebra',
      projectId: 'p2',
      kanban: 'done',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    task({
      id: 't2',
      title: 'Apple',
      projectId: 'p1',
      kanban: 'not-started',
      updatedAt: '2026-01-03T00:00:00.000Z',
    }),
    task({
      id: 't3',
      title: 'Mango',
      projectId: 'p1',
      kanban: 'in-progress',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
  ];

  it('defaults to updatedAt, newest first', () => {
    expect(sortTasks(tasks, projects, 'updatedAt').map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('sorts by title', () => {
    expect(sortTasks(tasks, projects, 'title').map((t) => t.title)).toEqual([
      'Apple',
      'Mango',
      'Zebra',
    ]);
  });

  it('sorts by project name', () => {
    expect(sortTasks(tasks, projects, 'project').map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('sorts by kanban status order', () => {
    expect(sortTasks(tasks, projects, 'status').map((t) => t.kanban)).toEqual([
      'not-started',
      'in-progress',
      'done',
    ]);
  });

  it('does not mutate the input array', () => {
    const copy = [...tasks];
    sortTasks(tasks, projects, 'title');
    expect(tasks).toEqual(copy);
  });
});
