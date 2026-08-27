/**
 * POST /api/projects/:id/knowledge/append — append a dated note to
 * `.ligma/project.md`. This is how a run (or a human) teaches the project
 * something durable: architecture notes, conventions, quirks.
 */

import { z } from 'zod';
import { NextResponse } from '../../../../../http';
import { appendProjectMd, appendQuirk, readQuirks } from '../../../../../store/ligma-dir';
import { validateBody } from '../../../../../store/validations';
import { badRequest, requireRepo } from '../../_lib';

const appendSchema = z.object({
  note: z.string().min(1).max(20_000),
  source: z.string().min(1).max(100).optional(),
  /** Target the conventional `## Quirks` section instead of a new dated one. */
  section: z.literal('quirks').optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = await requireRepo(id);
  if (!repo.ok) return repo.response;

  const validation = await validateBody(request, appendSchema);
  if (!validation.success) return validation.error;

  try {
    const { note, source, section } = validation.data;
    const write = section === 'quirks' ? appendQuirk : appendProjectMd;
    const projectMd = write(repo.repoPath, note, source ?? 'human');
    return NextResponse.json({ projectId: id, projectMd, quirks: readQuirks(repo.repoPath) });
  } catch (err) {
    return badRequest(err);
  }
}
