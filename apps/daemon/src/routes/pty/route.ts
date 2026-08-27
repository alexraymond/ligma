/**
 * POST /api/pty — create a Studio terminal session for a project (OD-135).
 *
 * cwd is the project's repo (twin-primitives §1's repoPath), resolved the same
 * way every other repo-scoped route resolves it: `requireRepo`. A project with
 * no repoPath gets its existing 409, not a shell — "no shell for repo-less
 * projects" is enforced here, once, rather than in the UI.
 *
 * Registered in routes/index.ts and packages/api/src/routes.ts as `pty` — the
 * handoff note this block used to point at was actioned; the docblock had not
 * caught up (codebase audit R9).
 */
import { NextResponse } from '../../http';
import { requireRepo } from '../projects/_id/_lib';
import { createSession } from './store';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { projectId?: unknown };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

  const repo = await requireRepo(projectId);
  if (!repo.ok) return repo.response;

  const { id } = await createSession(projectId, repo.repoPath);
  return NextResponse.json({ id, projectId }, { status: 201 });
}
