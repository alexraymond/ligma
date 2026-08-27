/**
 * GET  /api/memory/:agentId — this agent's cross-session memories (OD-092).
 * POST /api/memory/:agentId — add one: `{ text, source?, pinned? }`.
 *
 * POST is the ONLY write path, and it is explicit by design: a human in
 * Settings, or later an automation whose model emitted `{text, source}` as
 * structured output. Nothing scrapes a transcript for memories.
 *
 * ponytail: no agents.json existence check. `assertSafeId` (in the store) is
 * the guard that matters — it keeps `agentId` out of the filesystem — and an
 * unknown agent simply has no memories, which the empty list already says.
 */

import { NextResponse } from '../../../http';
import { addMemory, readMemory } from '../../../store/memory';
import { badRequest } from '../../projects/_id/_lib';

/** Long enough for a real note, short enough that 50 of them cannot eat a prompt. */
const MAX_TEXT = 1000;

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const { entries } = await readMemory(agentId);
    return NextResponse.json({ agentId, entries });
  } catch (err) {
    return badRequest(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const body = (await request.json()) as { text?: unknown; source?: unknown; pinned?: unknown };

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text === '') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (text.length > MAX_TEXT) {
      return NextResponse.json(
        { error: `text must be ${MAX_TEXT} characters or fewer` },
        { status: 400 },
      );
    }
    if (body.source !== undefined && body.source !== null && typeof body.source !== 'string') {
      return NextResponse.json({ error: 'source must be a string or null' }, { status: 400 });
    }

    const entry = await addMemory(agentId, {
      text,
      source:
        typeof body.source === 'string' && body.source.trim() !== '' ? body.source.trim() : null,
      pinned: body.pinned === true,
    });
    return NextResponse.json({ agentId, entry }, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
