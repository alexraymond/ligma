import { NextResponse } from '../../../http';
import { mutateTasks } from '../../../store/data';

// PUT — Bulk update tasks
export async function PUT(request: Request) {
  const body = (await request.json()) as { updates?: { id: string; [key: string]: unknown }[] };
  const updates = body.updates as { id: string; [key: string]: unknown }[];
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: 'updates array required' }, { status: 400 });
  }

  const results = await mutateTasks(async (data) => {
    const updated: string[] = [];
    for (const update of updates) {
      const idx = data.tasks.findIndex((t) => t.id === update.id);
      if (idx === -1) continue;
      const { id, ...changes } = update;
      data.tasks[idx] = {
        ...data.tasks[idx],
        ...changes,
        updatedAt: new Date().toISOString(),
        completedAt:
          changes.kanban === 'done'
            ? (data.tasks[idx].completedAt ?? new Date().toISOString())
            : changes.kanban !== undefined
              ? null
              : data.tasks[idx].completedAt,
      };
      updated.push(id);
    }
    return updated;
  });

  return NextResponse.json({ updated: results, count: results.length });
}

// DELETE — Bulk soft-delete tasks
export async function DELETE(request: Request) {
  const body = (await request.json()) as { ids?: string[] };
  const ids = body.ids as string[];
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const deleted = await mutateTasks(async (data) => {
    const deletedIds: string[] = [];
    const idSet = new Set(ids);
    for (const task of data.tasks) {
      if (idSet.has(task.id)) {
        task.deletedAt = now;
        task.updatedAt = now;
        deletedIds.push(task.id);
      }
    }
    return deletedIds;
  });

  return NextResponse.json({ deleted, count: deleted.length });
}
