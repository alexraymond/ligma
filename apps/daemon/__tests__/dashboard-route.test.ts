import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from '../src/routes/dashboard/route';
import { mutateTasks } from '../src/store/data';
import { backupDataFiles, createTestTask, restoreDataFiles } from './helpers';

// Regression: a task under acceptance-harness verification is real work in
// flight (the harness is actively spending quota on it) but used to count as
// neither in-progress nor done anywhere in the dashboard aggregations.

let backups: Record<string, string>;

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
});

type DashboardBody = {
  stats: { inProgressTasks: number; awaitingVerificationTasks: number; doneTasks: number };
};

describe('GET /api/dashboard — awaiting-verification stat', () => {
  it('counts awaiting-verification tasks separately from in-progress and done', async () => {
    const before = (await (await GET()).json()) as DashboardBody;

    const inProgressId = `task_test_dash_inprogress_${Date.now()}`;
    const verifyingId = `task_test_dash_verifying_${Date.now()}`;
    await mutateTasks(async (data) => {
      data.tasks.push(
        { ...createTestTask({ id: inProgressId, kanban: 'in-progress' }) } as never,
        { ...createTestTask({ id: verifyingId, kanban: 'awaiting-verification' }) } as never,
      );
    });

    const after = (await (await GET()).json()) as DashboardBody;
    expect(after.stats.inProgressTasks).toBe(before.stats.inProgressTasks + 1);
    expect(after.stats.awaitingVerificationTasks).toBe(before.stats.awaitingVerificationTasks + 1);
    expect(after.stats.doneTasks).toBe(before.stats.doneTasks);
  });
});
