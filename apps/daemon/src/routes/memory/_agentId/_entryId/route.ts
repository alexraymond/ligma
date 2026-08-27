/**
 * PATCH  /api/memory/:agentId/:entryId — pin or unpin: `{ pinned: boolean }`.
 * DELETE /api/memory/:agentId/:entryId — forget one memory.
 *
 * Pinning is the only field a client may change. The text of a memory is what
 * was decided worth keeping at the time it was kept; editing it in place would
 * quietly rewrite what an agent believes it learned, so a correction is a
 * delete plus an add.
 */

import { NextResponse } from '../../../../http';
import { deleteMemory, setMemoryPinned } from '../../../../store/memory';
import { badRequest } from '../../../projects/_id/_lib';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ agentId: string; entryId: string }> },
) {
  const { agentId, entryId } = await params;
  try {
    const body = (await request.json()) as { pinned?: unknown };
    if (typeof body.pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned must be a boolean' }, { status: 400 });
    }

    const entry = await setMemoryPinned(agentId, entryId, body.pinned);
    if (!entry) return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    return NextResponse.json({ agentId, entry });
  } catch (err) {
    return badRequest(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ agentId: string; entryId: string }> },
) {
  const { agentId, entryId } = await params;
  try {
    const removed = await deleteMemory(agentId, entryId);
    if (!removed) return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    return NextResponse.json({ agentId, entryId });
  } catch (err) {
    return badRequest(err);
  }
}
