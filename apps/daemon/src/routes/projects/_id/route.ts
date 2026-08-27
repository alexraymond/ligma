/**
 * GET/PATCH /api/projects/:id — the shape and repoPath the twin primitives hang
 * off (twin-primitives §1). Shape is inferred at discovery and changeable here;
 * repoPath is what makes a project a codebase with a `.ligma/`.
 */

import { NextResponse } from '../../../http';
import { mutateProjects } from '../../../store/data';
import { projectPatchSchema, validateBody } from '../../../store/validations';
import { findProject } from './_lib';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validation = await validateBody(request, projectPatchSchema);
  if (!validation.success) return validation.error;

  const updated = await mutateProjects(async (data) => {
    const project = data.projects.find((p) => p.id === id);
    if (!project) return null;
    Object.assign(project, validation.data);
    // A name set through this route is human-typed — it must never be
    // clobbered later by the promote planner's proposed title.
    if (validation.data.name !== undefined) project.nameIsPlaceholder = false;
    return project;
  });

  if (!updated) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json(updated);
}
