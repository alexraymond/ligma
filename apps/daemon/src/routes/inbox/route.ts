import type { InboxMessage } from '@ligma/api';
import { NextResponse } from '../../http';
import { getInbox, mutateInbox } from '../../store/data';
import { generateId } from '../../store/ids';
import {
  DEFAULT_LIMIT,
  inboxCreateSchema,
  inboxUpdateSchema,
  validateBody,
} from '../../store/validations';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');
  const status = searchParams.get('status');
  const data = await getInbox();

  const total = data.messages.length;
  let messages = data.messages;

  // Filter by agent (either from or to)
  if (agent) {
    messages = messages.filter((m) => m.from === agent || m.to === agent);
  }

  // Filter by status
  if (status) {
    messages = messages.filter((m) => m.status === status);
  }

  // Sort newest first
  messages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = messages.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  messages = messages.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: messages,
      messages,
      meta: { total, filtered: totalFiltered, returned: messages.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, inboxCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newMessage = await mutateInbox(async (data) => {
    const message: InboxMessage = {
      id: generateId('msg'),
      from: body.from,
      to: body.to,
      type: body.type,
      taskId: body.taskId,
      subject: body.subject,
      body: body.body,
      status: 'unread',
      createdAt: body.createdAt ?? new Date().toISOString(),
      readAt: null,
    };
    data.messages.push(message);
    return message;
  });

  return NextResponse.json(newMessage, { status: 201 });
}

export async function PUT(request: Request) {
  const validation = await validateBody(request, inboxUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const result = await mutateInbox(async (data) => {
    const idx = data.messages.findIndex((m) => m.id === body.id);
    if (idx === -1) return null;
    data.messages[idx] = {
      ...data.messages[idx],
      ...body,
      readAt:
        body.status === 'read'
          ? (data.messages[idx].readAt ?? new Date().toISOString())
          : data.messages[idx].readAt,
    };
    return data.messages[idx];
  });

  if (!result) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  await mutateInbox(async (data) => {
    data.messages = data.messages.filter((m) => m.id !== id);
  });

  return NextResponse.json({ ok: true });
}
