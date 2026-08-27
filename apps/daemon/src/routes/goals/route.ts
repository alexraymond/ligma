import type { Goal } from '@ligma/api';
import { NextResponse } from '../../http';
import { getGoals, mutateGoals, mutateTasks } from '../../store/data';
import { generateId } from '../../store/ids';
import {
  DEFAULT_LIMIT,
  goalCreateSchema,
  goalUpdateSchema,
  validateBody,
} from '../../store/validations';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const status = searchParams.get('status');
  const type = searchParams.get('type');
  const projectId = searchParams.get('projectId');
  const includeDeleted = searchParams.get('includeDeleted') === 'true';

  const data = await getGoals();
  const total = data.goals.length;
  let goals = data.goals;

  // Filter out soft-deleted by default
  if (!includeDeleted) {
    goals = goals.filter((g) => !g.deletedAt);
  }

  if (id) {
    goals = goals.filter((g) => g.id === id);
  }
  if (status) {
    goals = goals.filter((g) => g.status === status);
  }
  if (type) {
    goals = goals.filter((g) => g.type === type);
  }
  if (projectId) {
    goals = goals.filter((g) => g.projectId === projectId);
  }

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = goals.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  goals = goals.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: goals,
      goals,
      meta: { total, filtered: totalFiltered, returned: goals.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, goalCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newGoal = await mutateGoals(async (data) => {
    const goal: Goal = {
      id: generateId('goal'),
      title: body.title,
      type: body.type,
      timeframe: body.timeframe,
      parentGoalId: body.parentGoalId,
      projectId: body.projectId,
      status: body.status,
      milestones: body.milestones,
      tasks: body.tasks,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    data.goals.push(goal);
    return goal;
  });

  return NextResponse.json(newGoal, { status: 201 });
}

export async function PUT(request: Request) {
  const validation = await validateBody(request, goalUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const updated = await mutateGoals(async (data) => {
    const idx = data.goals.findIndex((g) => g.id === body.id);
    if (idx === -1) return null;
    data.goals[idx] = { ...data.goals[idx], ...body };
    return data.goals[idx];
  });

  if (!updated) {
    return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

/**
 * The objective and everything hanging off it. The delete dialog promises
 * "this objective and its milestones" (D7 MC-059); before this, children with
 * `parentGoalId` were silently orphaned. Both edges are followed — the parent's
 * `milestones` array and the child's `parentGoalId` — because either one alone
 * leaves a stale row when the two disagree. Transitive, so a milestone that
 * grew children of its own goes with it.
 */
function collectGoalSubtree(goals: Goal[], rootId: string): Set<string> {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const doomed = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (doomed.has(current)) continue;
    doomed.add(current);
    queue.push(...(byId.get(current)?.milestones ?? []));
    for (const goal of goals) {
      if (goal.parentGoalId === current) queue.push(goal.id);
    }
  }
  return doomed;
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const hard = searchParams.get('hard') === 'true';

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const deletedAt = new Date().toISOString();
  const deleted = await mutateGoals(async (data) => {
    if (!data.goals.some((g) => g.id === id)) return null;
    const doomed = collectGoalSubtree(data.goals, id);
    if (hard) {
      data.goals = data.goals.filter((g) => !doomed.has(g.id));
    } else {
      for (const goal of data.goals) {
        if (doomed.has(goal.id)) goal.deletedAt = deletedAt;
      }
    }
    // The surviving parent must not keep pointing at a deleted child.
    for (const goal of data.goals) {
      if (doomed.has(goal.id)) continue;
      goal.milestones = goal.milestones.filter((m) => !doomed.has(m));
    }
    return [...doomed];
  });

  if (!deleted) {
    return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
  }

  if (hard) {
    // Referential integrity: clear milestoneId on tasks that referenced any of them
    await mutateTasks(async (data) => {
      for (const task of data.tasks) {
        if (task.milestoneId && deleted.includes(task.milestoneId)) {
          task.milestoneId = null;
        }
      }
    });
  }

  return NextResponse.json({ ok: true, hard, deleted });
}
