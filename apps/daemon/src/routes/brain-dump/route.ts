import type { BrainDumpEntry } from '@ligma/api';
import { NextResponse } from '../../http';
import { getBrainDump, mutateBrainDump } from '../../store/data';
import { generateId } from '../../store/ids';
import {
  DEFAULT_LIMIT,
  brainDumpCreateSchema,
  brainDumpUpdateSchema,
  validateBody,
} from '../../store/validations';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const processed = searchParams.get('processed');

  const data = await getBrainDump();
  const total = data.entries.length;
  let entries = data.entries;

  if (id) {
    entries = entries.filter((e) => e.id === id);
  }
  if (processed !== null) {
    const isProcessed = processed === 'true';
    entries = entries.filter((e) => e.processed === isProcessed);
  }

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = entries.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  entries = entries.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: entries,
      entries,
      meta: { total, filtered: totalFiltered, returned: entries.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, brainDumpCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newEntry = await mutateBrainDump(async (data) => {
    const entry: BrainDumpEntry = {
      id: generateId('bd'),
      content: body.content,
      capturedAt: body.capturedAt ?? new Date().toISOString(),
      processed: body.processed,
      convertedTo: body.convertedTo,
      tags: body.tags,
    };
    data.entries.push(entry);
    return entry;
  });

  return NextResponse.json(newEntry, { status: 201 });
}

export async function PUT(request: Request) {
  const validation = await validateBody(request, brainDumpUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const result = await mutateBrainDump(async (data) => {
    const idx = data.entries.findIndex((e) => e.id === body.id);
    if (idx === -1) return null;
    data.entries[idx] = { ...data.entries[idx], ...body };
    return data.entries[idx];
  });

  if (!result) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  await mutateBrainDump(async (data) => {
    data.entries = data.entries.filter((e) => e.id !== id);
  });

  return NextResponse.json({ ok: true });
}
