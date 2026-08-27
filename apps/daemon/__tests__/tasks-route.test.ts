import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from '../src/http';
import { PUT } from '../src/routes/tasks/route';
import { mutateTasks } from '../src/store/data';
import { backupDataFiles, createTestTask, restoreDataFiles } from './helpers';

// Regression for: "Mark Reviewed" destroys the completion timestamp.
// The PUT handler used to null completedAt whenever body.kanban !== "done",
// including when body.kanban was entirely absent (e.g. {id, reviewed:true}).
// It must only recompute completedAt when the caller actually sent a kanban
// value — mirroring the bulk route's guard.

let backups: Record<string, string>;

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
});

function putRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/tasks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/tasks — completedAt guard', () => {
  it('preserves completedAt when reviewed:true is sent without kanban', async () => {
    const completedAt = '2026-01-01T00:00:00.000Z';
    const taskId = `task_test_reviewed_${Date.now()}`;
    await mutateTasks(async (data) => {
      data.tasks.push({
        ...createTestTask({ id: taskId, kanban: 'done', completedAt }),
      } as never);
    });

    const res = await PUT(putRequest({ id: taskId, reviewed: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completedAt: string | null; reviewed: boolean };
    expect(body.completedAt).toBe(completedAt);
    expect(body.reviewed).toBe(true);
  });

  it('still clears completedAt when kanban moves away from done', async () => {
    const completedAt = '2026-01-01T00:00:00.000Z';
    const taskId = `task_test_unclear_${Date.now()}`;
    await mutateTasks(async (data) => {
      data.tasks.push({
        ...createTestTask({ id: taskId, kanban: 'done', completedAt }),
      } as never);
    });

    const res = await PUT(putRequest({ id: taskId, kanban: 'not-started' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completedAt: string | null; reviewed: boolean };
    expect(body.completedAt).toBeNull();
  });

  it('still stamps completedAt when kanban moves to done', async () => {
    const taskId = `task_test_stamp_${Date.now()}`;
    await mutateTasks(async (data) => {
      data.tasks.push({
        ...createTestTask({ id: taskId, kanban: 'in-progress', completedAt: null }),
      } as never);
    });

    const res = await PUT(putRequest({ id: taskId, kanban: 'done' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completedAt: string | null; reviewed: boolean };
    expect(body.completedAt).not.toBeNull();
  });
});
