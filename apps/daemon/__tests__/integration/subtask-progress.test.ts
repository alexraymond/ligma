/**
 * The builder cannot write tasks.json (the oracle lives there), so it reports
 * finished subtasks as structured output and the daemon applies them. Without
 * this wiring the dashboard's live subtask progress silently dies — which is
 * exactly the regression the holdout fix introduced.
 *
 * Every case runs the builder's raw stdout through the real parser before the
 * consumer sees it, so the producer→consumer seam is covered end to end.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCompletedSubtaskIds } from '../../src/engine/prompt-builder';
import { handleBuilderCompletion } from '../../src/harness/verdict';

import { DATA_DIR } from '../../src/paths';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

let backup = '';

function seedTask(id: string, subtasks: Subtask[], acceptanceCriteria: string[] = []) {
  const raw = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
    tasks: Array<Record<string, unknown>>;
  };
  raw.tasks.push({
    id,
    title: `Subtask progress probe ${id}`,
    description: '',
    importance: 'not-important',
    urgency: 'not-urgent',
    kanban: 'in-progress',
    verificationStatus: 'unverified',
    projectId: null,
    milestoneId: null,
    assignedTo: 'developer',
    collaborators: [],
    dailyActions: [],
    subtasks,
    blockedBy: [],
    estimatedMinutes: null,
    actualMinutes: null,
    acceptanceCriteria,
    comments: [],
    tags: [],
    notes: '',
    dueDate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    deletedAt: null,
  });
  writeFileSync(TASKS_FILE, JSON.stringify(raw, null, 2), 'utf-8');
}

function readTask(id: string): { subtasks: Subtask[]; updatedAt: string } {
  const raw = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
    tasks: Array<{ id: string; subtasks?: Subtask[]; updatedAt: string }>;
  };
  const task = raw.tasks.find((t) => t.id === id);
  return { subtasks: task?.subtasks ?? [], updatedAt: task?.updatedAt ?? '' };
}

/** Shape the real CLI emits: a JSON envelope whose result holds a fenced block. */
function builderStdout(ids: string[]): string {
  return JSON.stringify({
    type: 'result',
    result: `Did the work.\n\n\`\`\`json\n${JSON.stringify({ completedSubtaskIds: ids })}\n\`\`\``,
  });
}

/** The daemon's real path: parse the CLI output, then apply it. */
function completeWith(taskId: string, stdout: string) {
  return handleBuilderCompletion(taskId, 'developer', 'summary', parseCompletedSubtaskIds(stdout));
}

describe('builder subtask progress', () => {
  beforeEach(() => {
    backup = readFileSync(TASKS_FILE, 'utf-8');
  });

  afterEach(() => {
    writeFileSync(TASKS_FILE, backup, 'utf-8');
  });

  it('ticks exactly the reported subtasks and leaves the rest alone', async () => {
    const id = `task_subtask_probe_${Date.now()}`;
    seedTask(id, [
      { id: 'st_1', title: 'one', done: false },
      { id: 'st_2', title: 'two', done: false },
      { id: 'st_3', title: 'three', done: false },
    ]);

    await completeWith(id, builderStdout(['st_1', 'st_3']));

    const { subtasks } = readTask(id);
    expect(subtasks.find((s) => s.id === 'st_1')?.done).toBe(true);
    expect(subtasks.find((s) => s.id === 'st_3')?.done).toBe(true);
    expect(subtasks.find((s) => s.id === 'st_2')?.done).toBe(false);
  });

  it('ignores ids that do not belong to the task', async () => {
    const id = `task_subtask_foreign_${Date.now()}`;
    seedTask(id, [{ id: 'st_1', title: 'one', done: false }]);

    await completeWith(id, builderStdout(['st_9', '../../etc/passwd', 'st_1']));

    const { subtasks } = readTask(id);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].done).toBe(true);
  });

  it('is a no-op when the builder reports no block', async () => {
    const id = `task_subtask_absent_${Date.now()}`;
    seedTask(id, [{ id: 'st_1', title: 'one', done: false }]);

    await completeWith(id, 'no fenced json here at all');

    expect(readTask(id).subtasks[0].done).toBe(false);
  });

  it('never un-ticks an already-done subtask', async () => {
    const id = `task_subtask_sticky_${Date.now()}`;
    seedTask(id, [
      { id: 'st_1', title: 'one', done: true },
      { id: 'st_2', title: 'two', done: false },
    ]);

    await completeWith(id, builderStdout(['st_2']));

    expect(readTask(id).subtasks.every((s) => s.done)).toBe(true);
  });

  it("does not touch updatedAt when a finished task's report changed nothing", async () => {
    const id = `task_subtask_noop_${Date.now()}`;
    seedTask(id, [{ id: 'st_1', title: 'one', done: true }]);
    // Mark it finished — the state a re-reported completion arrives in.
    const raw = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
      tasks: Array<Record<string, unknown>>;
    };
    const task = raw.tasks.find((t) => t.id === id);
    if (!task) throw new Error('seed failed');
    task.kanban = 'done';
    task.updatedAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(TASKS_FILE, JSON.stringify(raw, null, 2), 'utf-8');

    await completeWith(id, builderStdout(['st_1']));

    expect(readTask(id).updatedAt).toBe('2020-01-01T00:00:00.000Z');
  });
});
