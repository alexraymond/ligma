/**
 * DELETE /api/pty/:id?projectId=... — kill a Studio terminal session.
 *
 * The only teardown path (OD-135 security posture): tab close, unmount, or an
 * explicit Close all route here. `projectId` keeps a session scoped to the
 * project it was opened for — a stray id from another project's tab 404s
 * instead of killing (or even confirming the existence of) someone else's shell.
 */
import { NextResponse } from '../../../http';
import { findSession, killSession } from '../store';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';

  const session = findSession(id, projectId);
  if (!session) return NextResponse.json({ error: 'Terminal session not found' }, { status: 404 });

  await killSession(session);
  return NextResponse.json({ ok: true });
}
