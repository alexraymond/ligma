import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mutateActiveRuns, mutateDecisions, mutateTasks } from '../src/store/data';
import { backupDataFiles, createTestTask, restoreDataFiles } from './helpers';

// The manual Run button used to gate on ANY pending decision for the task,
// ignoring blocksTask. The harness raises non-blocking judgement cards
// (blocksTask: false) precisely so they don't stop work — this route must
// honour that the same way the daemon's hasBlockingPendingDecision does.

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ pid: 4242, unref: vi.fn() })),
}));

import { POST } from '../src/routes/tasks/_id/run/route';

let backups: Record<string, string>;

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
});

async function seedTask(taskId: string) {
  await mutateTasks(async (data) => {
    data.tasks.push({
      ...createTestTask({ id: taskId, kanban: 'in-progress', assignedTo: 'developer' }),
    } as never);
  });
  await mutateActiveRuns(async (data) => {
    data.runs = data.runs.filter((r) => r.taskId !== taskId);
  });
}

function run(taskId: string) {
  return POST(new Request(`http://localhost/api/tasks/${taskId}/run`, { method: 'POST' }), {
    params: Promise.resolve({ id: taskId }),
  });
}

describe('POST /api/tasks/[id]/run — non-blocking decisions', () => {
  it('allows the run when the only pending decision has blocksTask: false', async () => {
    const taskId = `task_test_run_nonblock_${Date.now()}`;
    await seedTask(taskId);
    await mutateDecisions(async (data) => {
      data.decisions.push({
        id: `dec_test_${Date.now()}`,
        requestedBy: 'developer',
        taskId,
        question: 'Non-blocking judgement call',
        options: ['a', 'b'],
        context: '',
        status: 'pending',
        answer: null,
        answeredAt: null,
        createdAt: new Date().toISOString(),
        blocksTask: false,
      } as never);
    });

    const res = await run(taskId);
    expect(res.status).toBe(200);
  });

  it('blocks the run when a pending decision has blocksTask: true', async () => {
    const taskId = `task_test_run_block_true_${Date.now()}`;
    await seedTask(taskId);
    await mutateDecisions(async (data) => {
      data.decisions.push({
        id: `dec_test_${Date.now()}`,
        requestedBy: 'developer',
        taskId,
        question: 'Must be answered first',
        options: ['a', 'b'],
        context: '',
        status: 'pending',
        answer: null,
        answeredAt: null,
        createdAt: new Date().toISOString(),
        blocksTask: true,
      } as never);
    });

    const res = await run(taskId);
    // 409: the task is parked, not malformed — and it is the SAME park the
    // dispatcher applies, with the same wording (H4).
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      parkedReason: string;
      pendingDecisions: number;
    };
    expect(body.error).toMatch(/blocks the whole task/i);
    expect(body.parkedReason).toMatch(/blocks the whole task/i);
    expect(body.pendingDecisions).toBe(1);
  });

  it('blocks the run when a pending decision omits blocksTask (defaults to blocking)', async () => {
    const taskId = `task_test_run_block_missing_${Date.now()}`;
    await seedTask(taskId);
    await mutateDecisions(async (data) => {
      data.decisions.push({
        id: `dec_test_${Date.now()}`,
        requestedBy: 'developer',
        taskId,
        question: 'No blocksTask field at all',
        options: ['a', 'b'],
        context: '',
        status: 'pending',
        answer: null,
        answeredAt: null,
        createdAt: new Date().toISOString(),
      } as never);
    });

    const res = await run(taskId);
    expect(res.status).toBe(409);
  });

  // The half this route never had: three unanswered non-blocking cards is the
  // daemon's own "it keeps asking" park. The button used to start the task
  // anyway, so daemon and button disagreed about the same task.
  it('refuses the run once three non-blocking decisions are unanswered', async () => {
    const taskId = `task_test_run_three_pending_${Date.now()}`;
    await seedTask(taskId);
    await mutateDecisions(async (data) => {
      for (let i = 0; i < 3; i++) {
        data.decisions.push({
          id: `dec_test_${Date.now()}_${i}`,
          requestedBy: 'developer',
          taskId,
          question: `Judgement call ${i}`,
          options: ['a', 'b'],
          context: '',
          status: 'pending',
          answer: null,
          answeredAt: null,
          createdAt: new Date().toISOString(),
          blocksTask: false,
        } as never);
      }
    });

    const res = await run(taskId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { parkedReason: string; pendingDecisions: number };
    expect(body.parkedReason).toMatch(/3 pending decisions are unanswered/i);
    expect(body.pendingDecisions).toBe(3);
  });
});

// The harness owns awaiting-verification tasks; run-task.ts itself exits 1
// immediately if spawned against one. The route used to only reject "done",
// so pressing Run returned a false-positive 200 while the child died at once.
describe('POST /api/tasks/[id]/run — kanban preconditions', () => {
  it('rejects a task that is awaiting-verification', async () => {
    const taskId = `task_test_run_awaiting_verification_${Date.now()}`;
    await seedTask(taskId);
    await mutateTasks(async (data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      if (task) task.kanban = 'awaiting-verification';
    });

    const res = await run(taskId);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/awaiting verification/i);
  });

  it('still rejects a task that is already done', async () => {
    const taskId = `task_test_run_done_${Date.now()}`;
    await seedTask(taskId);
    await mutateTasks(async (data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      if (task) task.kanban = 'done';
    });

    const res = await run(taskId);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already done/i);
  });
});
