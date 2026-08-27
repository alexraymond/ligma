/**
 * POST /api/pty/:id/input — send one typed line to a Studio terminal session.
 *
 * Blocks until the bridge's `run` action returns (see store.ts's `sendInput`
 * docblock for why: the underlying pty-bridge has no mid-command streaming),
 * so this response IS the command's result — the stream (`stream/route.ts`)
 * gets the same frames for any other tab watching the same session.
 */
import { NextResponse } from '../../../../http';
import { findSession, sendInput } from '../../store';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { projectId?: unknown; data?: unknown };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const line = typeof body.data === 'string' ? body.data : '';

  const session = findSession(id, projectId);
  if (!session) return NextResponse.json({ error: 'Terminal session not found' }, { status: 404 });
  if (!line) return NextResponse.json({ error: 'data is required' }, { status: 400 });

  await sendInput(session, line);
  return NextResponse.json({ ok: true });
}
