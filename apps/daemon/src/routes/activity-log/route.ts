import type { ActivityEvent } from '@ligma/api';
import { z } from 'zod';
import { NextResponse } from '../../http';
import { getActivityLog, mutateActivityLog } from '../../store/data';
import { generateId } from '../../store/ids';
import { DEFAULT_LIMIT, activityEventCreateSchema, validateBody } from '../../store/validations';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const actor = searchParams.get('actor');
  const data = await getActivityLog();

  const total = data.events.length;
  let events = data.events;

  // Filter by actor if provided
  if (actor) {
    events = events.filter((e) => e.actor === actor);
  }

  // Sort newest first
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = events.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  events = events.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: events,
      events,
      meta: { total, filtered: totalFiltered, returned: events.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, activityEventCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newEvent = await mutateActivityLog(async (data) => {
    const event: ActivityEvent = {
      id: generateId('evt'),
      type: body.type,
      actor: body.actor,
      taskId: body.taskId,
      summary: body.summary,
      details: body.details,
      timestamp: body.timestamp ?? new Date().toISOString(),
    };
    data.events.push(event);
    return event;
  });

  return NextResponse.json(newEvent, { status: 201 });
}

// Events are hard-deleted below (unlike Task/Goal/Project, ActivityEvent has
// no `deletedAt` to flip back) — so undo needs somewhere to recover the row
// from. This is that somewhere: DELETE stashes it here, PUT restores from it.
//
// ponytail: in-process Map, unbounded for the process lifetime. Undoing a
// delete across a daemon restart isn't a case this app needs to support; add
// a TTL/prune (mirroring decisions/route.ts's undoJournal) if that changes.
const deletedEvents = new Map<string, ActivityEvent>();

const activityEventRestoreSchema = z.object({ id: z.string().min(1, 'id is required') });

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  await mutateActivityLog(async (data) => {
    const doomed = data.events.find((e) => e.id === id);
    if (doomed) deletedEvents.set(id, doomed);
    data.events = data.events.filter((e) => e.id !== id);
  });

  return NextResponse.json({ ok: true });
}

// PUT /api/activity-log — restore a deleted event. Every sibling collection
// (tasks, goals, projects, inbox) exposes PUT for its `useDataResource` undo
// toast to call; this route lacked one, so the toast's "Undo" action 405'd.
// Activity events are otherwise immutable once logged, so restore is the only
// mutation this PUT needs to support.
export async function PUT(request: Request) {
  const validation = await validateBody(request, activityEventRestoreSchema);
  if (!validation.success) return validation.error;
  const { id } = validation.data;

  const restored = deletedEvents.get(id);
  if (!restored) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  await mutateActivityLog(async (data) => {
    data.events.push(restored);
  });
  deletedEvents.delete(id);

  return NextResponse.json(restored);
}
