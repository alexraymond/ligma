import type { Goal } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupDataFiles, createTestGoal, createTestTask, restoreDataFiles } from './helpers';

function goal(overrides: Partial<Goal> & { id: string }): Goal {
  return {
    ...createTestGoal(),
    createdAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  } as Goal;
}
import { DELETE } from '../src/routes/goals/route';
import { getGoals, getTasks, mutateGoals, mutateTasks } from '../src/store/data';

// D7 parity MC-059: the confirm dialog promises "this objective and its
// milestones"; the route deleted only the objective and left every child with a
// parentGoalId pointing at a row that no longer existed.

let backups: Record<string, string>;

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
});

function del(id: string, hard: boolean) {
  return DELETE(
    new Request(`http://localhost/api/goals?id=${id}${hard ? '&hard=true' : ''}`, {
      method: 'DELETE',
    }),
  );
}

/** objective → milestone → sub-milestone, plus an unrelated bystander. */
async function seedTree(prefix: string) {
  const root = `${prefix}_root`;
  const child = `${prefix}_child`;
  const grandchild = `${prefix}_grandchild`;
  const bystander = `${prefix}_bystander`;
  await mutateGoals(async (data) => {
    data.goals.push(
      goal({ id: root, milestones: [child] }),
      goal({ id: child, type: 'medium-term', parentGoalId: root, milestones: [grandchild] }),
      goal({ id: grandchild, type: 'medium-term', parentGoalId: child }),
      goal({ id: bystander }),
    );
  });
  return { root, child, grandchild, bystander };
}

describe('DELETE /api/goals — milestone cascade', () => {
  it('hard-deletes the whole subtree the dialog promised', async () => {
    const { root, child, grandchild, bystander } = await seedTree(`goal_casc_h_${Date.now()}`);

    const res = await del(root, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, hard: true });

    const ids = (await getGoals()).goals.map((g) => g.id);
    expect(ids).not.toContain(root);
    expect(ids).not.toContain(child);
    expect(ids).not.toContain(grandchild);
    expect(ids).toContain(bystander);
  });

  it('soft-deletes children too, so the list does not show orphans', async () => {
    const { root, child, grandchild, bystander } = await seedTree(`goal_casc_s_${Date.now()}`);

    const res = await del(root, false);
    expect(res.status).toBe(200);

    const goals = (await getGoals()).goals;
    const at = (id: string) => goals.find((g) => g.id === id)?.deletedAt;
    expect(at(root)).toBeTruthy();
    expect(at(child)).toBeTruthy();
    expect(at(grandchild)).toBeTruthy();
    expect(at(bystander)).toBeNull();
  });

  it('clears milestoneId on tasks linked to any deleted descendant', async () => {
    const { root, child } = await seedTree(`goal_casc_t_${Date.now()}`);
    const taskId = `task_casc_${Date.now()}`;
    await mutateTasks(async (data) => {
      data.tasks.push({
        ...createTestTask({ id: taskId, milestoneId: child }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never);
    });

    await del(root, true);

    const task = (await getTasks()).tasks.find((t) => t.id === taskId);
    expect(task?.milestoneId).toBeNull();
  });

  it('does not leave a surviving parent pointing at a deleted child', async () => {
    const prefix = `goal_casc_p_${Date.now()}`;
    const parent = `${prefix}_parent`;
    const doomed = `${prefix}_doomed`;
    await mutateGoals(async (data) => {
      data.goals.push(
        goal({ id: parent, milestones: [doomed] }),
        goal({ id: doomed, type: 'medium-term' }),
      );
    });

    await del(doomed, true);

    const survivor = (await getGoals()).goals.find((g) => g.id === parent);
    expect(survivor?.milestones).toEqual([]);
  });

  it('still 404s an unknown id', async () => {
    const res = await del('goal_does_not_exist', true);
    expect(res.status).toBe(404);
  });
});
