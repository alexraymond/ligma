import type { ActivityEvent } from '@ligma/api';
import { NextResponse } from '../../../http';
import {
  getTasksArchive,
  mutateActivityLog,
  mutateTasks,
  mutateTasksArchive,
} from '../../../store/data';
import { generateId } from '../../../store/ids';

// GET — Read archived tasks (with optional filters)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const assignedTo = searchParams.get('assignedTo');
  const projectId = searchParams.get('projectId');
  const fields = searchParams.get('fields');

  const archive = await getTasksArchive();
  const total = archive.tasks.length;
  let tasks = archive.tasks;

  // Apply filters
  if (id) {
    tasks = tasks.filter((t) => t.id === id);
  }
  if (assignedTo) {
    tasks = tasks.filter((t) => t.assignedTo === assignedTo);
  }
  if (projectId) {
    tasks = tasks.filter((t) => t.projectId === projectId);
  }

  // Sparse field selection
  if (fields) {
    const fieldList = fields.split(',').map((f) => f.trim());
    if (!fieldList.includes('id')) fieldList.unshift('id');
    const sparse = tasks.map((t) => {
      const picked: Record<string, unknown> = {};
      for (const f of fieldList) {
        if (f in t) {
          picked[f] = t[f as keyof typeof t];
        }
      }
      return picked;
    });
    return NextResponse.json({
      data: sparse,
      tasks: sparse,
      archived: true,
      meta: { total, filtered: sparse.length },
    });
  }

  return NextResponse.json({
    data: tasks,
    tasks,
    archived: true,
    meta: { total, filtered: tasks.length },
  });
}

// POST — Archive all completed tasks (move from tasks.json to tasks-archive.json)
export async function POST() {
  const result = await mutateTasks(async (tasksData) => {
    const done = tasksData.tasks.filter((t) => t.kanban === 'done');
    tasksData.tasks = tasksData.tasks.filter((t) => t.kanban !== 'done');

    if (done.length > 0) {
      await mutateTasksArchive(async (archive) => {
        archive.tasks.push(...done);
      });
    }

    return {
      archived: done.length,
      remaining: tasksData.tasks.length,
      ids: done.map((t) => t.id),
      titles: done.map((t) => t.title),
    };
  });

  if (result.archived === 0) {
    return NextResponse.json(
      { message: 'No completed tasks to archive', archived: 0, remaining: result.remaining },
      { status: 200 },
    );
  }

  // Log activity event
  await mutateActivityLog(async (logData) => {
    const event: ActivityEvent = {
      id: generateId('evt'),
      type: 'task_updated',
      actor: 'system',
      taskId: null,
      summary: `Archived ${result.archived} completed task${result.archived === 1 ? '' : 's'}`,
      details: `Moved ${result.archived} completed tasks to archive: ${result.titles.join(', ')}`,
      timestamp: new Date().toISOString(),
    };
    logData.events.push(event);
  });

  return NextResponse.json({
    message: `Archived ${result.archived} completed tasks`,
    archived: result.archived,
    remaining: result.remaining,
    archivedIds: result.ids,
  });
}
