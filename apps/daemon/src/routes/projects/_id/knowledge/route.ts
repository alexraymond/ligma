/**
 * GET /api/projects/:id/knowledge — the `.ligma/` directory, rendered.
 *
 * Boot status, the recipe, project.md, the journeys, and any journey file that
 * failed validation (surfaced, never silently dropped — a knowledge tab that
 * hides a broken file is how a repo quietly stops being verifiable).
 */

import { NextResponse } from '../../../../http';
import { readKnowledge } from '../../../../store/ligma-dir';
import { findProject } from '../_lib';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json(readKnowledge(project.id, project.repoPath ?? null));
}
