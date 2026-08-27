/**
 * Completing a task must not erase the dependency graph.
 *
 * execution-flow-review M5: `handleUnblocking` rewrote `blockedBy` to the
 * still-open blockers as each one finished, so a chain that had run was
 * indistinguishable from a chain that never had one — the board could not draw
 * "after X", nobody could audit why a task waited, and re-opening a blocker
 * left its dependent permanently unblocked. Nothing needed the pruning:
 * `isTaskUnblocked` (engine/prompt-builder) and the manual Run route both
 * compute blockedness by looking up each blocker's kanban status.
 *
 * So the graph stays, and the notification still fires exactly once, when the
 * last open blocker closes.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Task } from '@ligma/api';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-tasks-route-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { PUT } = await import('./route');
const { getTasks, getInbox } = await import('../../store/data');
const { isTaskUnblocked } = await import('../../engine/prompt-builder');

const base = {
  description: '',
  importance: 'important' as const,
  urgency: 'not-urgent' as const,
  verificationStatus: 'unverified' as const,
  projectId: null,
  milestoneId: null,
  assignedTo: 'developer' as const,
  collaborators: [],
  dailyActions: [],
  subtasks: [],
  estimatedMinutes: null,
  actualMinutes: null,
  acceptanceCriteria: [],
  comments: [],
  tags: [],
  notes: '',
  dueDate: null,
  completedAt: null,
  deletedAt: null,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

function seed(): void {
  for (const [file, empty] of Object.entries({
    'goals.json': { goals: [] },
    'activity-log.json': { events: [] },
    'inbox.json': { messages: [] },
  })) {
    writeFileSync(path.join(dataDir, file), JSON.stringify(empty), 'utf-8');
  }
  writeFileSync(
    path.join(dataDir, 'tasks.json'),
    JSON.stringify({
      tasks: [
        { ...base, id: 'task_a', title: 'Build it', kanban: 'in-progress', blockedBy: [] },
        { ...base, id: 'task_b', title: 'Test it', kanban: 'in-progress', blockedBy: [] },
        {
          ...base,
          id: 'task_c',
          title: 'Write it up',
          kanban: 'not-started',
          blockedBy: ['task_a', 'task_b'],
        },
      ],
    }),
    'utf-8',
  );
}

async function complete(id: string): Promise<void> {
  const response = await PUT(
    new Request('http://127.0.0.1/api/tasks', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, kanban: 'done' }),
    }),
  );
  expect(response.status).toBe(200);
}

const find = async (id: string): Promise<Task> =>
  (await getTasks()).tasks.find((t) => t.id === id)!;

beforeEach(seed);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe('completing a blocker', () => {
  it('keeps the dependency graph intact', async () => {
    await complete('task_a');
    expect((await find('task_c')).blockedBy).toEqual(['task_a', 'task_b']);

    await complete('task_b');
    expect((await find('task_c')).blockedBy).toEqual(['task_a', 'task_b']);
  });

  it("still decides dispatchability from the blockers' status", async () => {
    expect(isTaskUnblocked(await find('task_c'))).toBe(false);

    await complete('task_a');
    expect(isTaskUnblocked(await find('task_c'))).toBe(false);

    await complete('task_b');
    expect(isTaskUnblocked(await find('task_c'))).toBe(true);
  });

  it('notifies the dependent once, when the last blocker closes', async () => {
    await complete('task_a');
    const half = (await getInbox()).messages.filter((m) => m.subject.startsWith('Unblocked:'));
    expect(half).toHaveLength(0);

    await complete('task_b');
    const done = (await getInbox()).messages.filter((m) => m.subject.startsWith('Unblocked:'));
    expect(done).toHaveLength(1);
    expect(done[0]!.taskId).toBe('task_c');
  });
});
