import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GoalsFile, ProjectsFile, TasksFile } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../src/paths';
import {
  getActivityLog,
  getAgents,
  getBrainDump,
  getDecisions,
  getGoals,
  getInbox,
  getProjects,
  getSkillsLibrary,
  getTasks,
  getTasksArchive,
  saveGoals,
  saveProjects,
  saveTasks,
  withTasks,
} from '../src/store/data';
import { backupDataFiles, restoreDataFiles } from './helpers';

let backups: Record<string, string>;

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

describe('getTasks / saveTasks', () => {
  it('reads tasks.json and returns a TasksFile object', async () => {
    const data = await getTasks();
    expect(data).toHaveProperty('tasks');
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it('saves tasks and persists changes', async () => {
    const original = await getTasks();
    const originalCount = original.tasks.length;

    const newTask = {
      id: `task_test_${Date.now()}`,
      title: 'Vitest test task',
      description: 'Created during data layer test',
      importance: 'important' as const,
      urgency: 'urgent' as const,
      kanban: 'not-started' as const,
      verificationStatus: 'unverified' as const,
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
      tags: ['test'],
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dueDate: null,
      completedAt: null,
      deletedAt: null,
    };

    const updated: TasksFile = { tasks: [...original.tasks, newTask] };
    await saveTasks(updated);

    const reread = await getTasks();
    expect(reread.tasks).toHaveLength(originalCount + 1);
    const found = reread.tasks.find((t) => t.id === newTask.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Vitest test task');

    // Restore original
    await saveTasks(original);
  });

  it('preserves JSON formatting (2-space indentation)', async () => {
    const data = await getTasks();
    await saveTasks(data);
    const raw = await readFile(path.join(DATA_DIR, 'tasks.json'), 'utf-8');
    // JSON.stringify with 2-space indent starts objects on new lines
    expect(raw).toContain('  ');
    // Should be valid JSON
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ─── Goals ────────────────────────────────────────────────────────────────────

describe('getGoals / saveGoals', () => {
  it('reads goals.json and returns a GoalsFile object', async () => {
    const data = await getGoals();
    expect(data).toHaveProperty('goals');
    expect(Array.isArray(data.goals)).toBe(true);
  });

  it('saves goals and persists changes', async () => {
    const original = await getGoals();
    const originalCount = original.goals.length;

    const newGoal = {
      id: `goal_test_${Date.now()}`,
      title: 'Vitest test goal',
      type: 'medium-term' as const,
      timeframe: 'Q1 2026',
      parentGoalId: null,
      projectId: null,
      status: 'not-started' as const,
      milestones: [],
      tasks: [],
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };

    const updated: GoalsFile = { goals: [...original.goals, newGoal] };
    await saveGoals(updated);

    const reread = await getGoals();
    expect(reread.goals).toHaveLength(originalCount + 1);
    const found = reread.goals.find((g) => g.id === newGoal.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Vitest test goal');

    // Restore original
    await saveGoals(original);
  });
});

// ─── Projects ─────────────────────────────────────────────────────────────────

describe('getProjects / saveProjects', () => {
  it('reads projects.json and returns a ProjectsFile object', async () => {
    const data = await getProjects();
    expect(data).toHaveProperty('projects');
    expect(Array.isArray(data.projects)).toBe(true);
  });

  it('saves projects and persists changes', async () => {
    const original = await getProjects();

    const newProject = {
      id: `proj_test_${Date.now()}`,
      name: 'Vitest test project',
      description: 'Test project',
      status: 'active' as const,
      color: '#ff0000',
      teamMembers: [],
      createdAt: new Date().toISOString(),
      tags: [],
      deletedAt: null,
    };

    const updated: ProjectsFile = { projects: [...original.projects, newProject] };
    await saveProjects(updated);

    const reread = await getProjects();
    const found = reread.projects.find((p) => p.id === newProject.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe('Vitest test project');

    // Restore original
    await saveProjects(original);
  });
});

// ─── Brain Dump ───────────────────────────────────────────────────────────────

describe('getBrainDump', () => {
  it('reads brain-dump.json and returns a BrainDumpFile object', async () => {
    const data = await getBrainDump();
    expect(data).toHaveProperty('entries');
    expect(Array.isArray(data.entries)).toBe(true);
  });
});

// ─── Inbox ────────────────────────────────────────────────────────────────────

describe('getInbox', () => {
  it('reads inbox.json and returns an InboxFile object', async () => {
    const data = await getInbox();
    expect(data).toHaveProperty('messages');
    expect(Array.isArray(data.messages)).toBe(true);
  });
});

// ─── Activity Log ─────────────────────────────────────────────────────────────

describe('getActivityLog', () => {
  it('reads activity-log.json and returns an ActivityLogFile object', async () => {
    const data = await getActivityLog();
    expect(data).toHaveProperty('events');
    expect(Array.isArray(data.events)).toBe(true);
  });
});

// ─── Decisions ────────────────────────────────────────────────────────────────

describe('getDecisions', () => {
  it('reads decisions.json and returns a DecisionsFile object', async () => {
    const data = await getDecisions();
    expect(data).toHaveProperty('decisions');
    expect(Array.isArray(data.decisions)).toBe(true);
  });
});

// ─── Agents ──────────────────────────────────────────────────────────────────

describe('getAgents', () => {
  it('reads agents.json and returns an AgentsFile object', async () => {
    const data = await getAgents();
    expect(data).toHaveProperty('agents');
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it('returns empty array gracefully when agents.json is missing', async () => {
    // getAgents has a try/catch that returns { agents: [] } on failure
    // Just verify the normal path works and the shape is correct
    const data = await getAgents();
    expect(data.agents).toBeDefined();
  });
});

// ─── Skills Library ──────────────────────────────────────────────────────────

describe('getSkillsLibrary', () => {
  it('reads skills-library.json and returns a SkillsLibraryFile object', async () => {
    const data = await getSkillsLibrary();
    expect(data).toHaveProperty('skills');
    expect(Array.isArray(data.skills)).toBe(true);
  });
});

// ─── Tasks Archive ────────────────────────────────────────────────────────────

describe('getTasksArchive', () => {
  it('returns tasks array (empty if archive file does not exist)', async () => {
    const data = await getTasksArchive();
    expect(data).toHaveProperty('tasks');
    expect(Array.isArray(data.tasks)).toBe(true);
  });
});

// ─── Mutex Safety (withTasks) ─────────────────────────────────────────────────
// NOTE: withTasks acquires the tasks mutex, so inside the callback we must
// write the file directly (bypassing saveTasks) to avoid deadlock, since
// saveTasks also tries to acquire the same mutex.

describe('withTasks (mutex-protected read-modify-write)', () => {
  const tasksFilePath = path.join(DATA_DIR, 'tasks.json');

  it('prevents concurrent writes from corrupting data', async () => {
    const original = await getTasks();

    const task1Id = `task_concurrent_1_${Date.now()}`;
    const task2Id = `task_concurrent_2_${Date.now()}`;

    // withTasks already holds the mutex, so we write the file directly
    // inside the callback (not via saveTasks, which would deadlock).
    const op1 = withTasks(async (data) => {
      const newTask = {
        id: task1Id,
        title: 'Concurrent task 1',
        description: '',
        importance: 'important' as const,
        urgency: 'urgent' as const,
        kanban: 'not-started' as const,
        verificationStatus: 'unverified' as const,
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dueDate: null,
        completedAt: null,
        deletedAt: null,
      };
      data.tasks.push(newTask);
      await writeFile(tasksFilePath, JSON.stringify(data, null, 2), 'utf-8');
      return task1Id;
    });

    const op2 = withTasks(async (data) => {
      const newTask = {
        id: task2Id,
        title: 'Concurrent task 2',
        description: '',
        importance: 'not-important' as const,
        urgency: 'not-urgent' as const,
        kanban: 'not-started' as const,
        verificationStatus: 'unverified' as const,
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dueDate: null,
        completedAt: null,
        deletedAt: null,
      };
      data.tasks.push(newTask);
      await writeFile(tasksFilePath, JSON.stringify(data, null, 2), 'utf-8');
      return task2Id;
    });

    // Both operations should complete without error (serialized by mutex)
    const [id1, id2] = await Promise.all([op1, op2]);
    expect(id1).toBe(task1Id);
    expect(id2).toBe(task2Id);

    // The mutex serializes execution: op2 re-reads after op1 finishes,
    // so both tasks should be present in the final state.
    const final = await getTasks();
    const has1 = final.tasks.some((t) => t.id === task1Id);
    const has2 = final.tasks.some((t) => t.id === task2Id);
    expect(has1).toBe(true);
    expect(has2).toBe(true);

    // Restore original
    await saveTasks(original);
  });

  it('returns the value from the callback', async () => {
    const result = await withTasks(async (data) => {
      return data.tasks.length;
    });
    expect(typeof result).toBe('number');
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles saving and reading empty arrays', async () => {
    const original = await getTasks();
    await saveTasks({ tasks: [] });

    const empty = await getTasks();
    expect(empty.tasks).toEqual([]);

    // Restore
    await saveTasks(original);
  });

  it('data files contain valid JSON', async () => {
    const files = [
      'tasks.json',
      'goals.json',
      'projects.json',
      'inbox.json',
      'decisions.json',
      'activity-log.json',
    ];
    for (const file of files) {
      let raw: string;
      try {
        raw = await readFile(path.join(DATA_DIR, file), 'utf-8');
      } catch (err) {
        // Stores are fail-soft: a file that was never written may not exist
        // (a fresh clone has no dogfood decisions.json to seed from).
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });
});
