/**
 * GET /api/projects/:id/health — the criterion-level health board (UX spec §6
 * Project Overview).
 *
 * Every criterion this project has frozen into a contract, joined to whatever
 * the latest verdict said about it. Task contracts and journey contracts both
 * land here because both are things the project promised; a criterion no run
 * has ruled on comes back `unverified`, which is the honest word for it.
 */

import type { ProjectHealthResponse } from '@ligma/api';
import { criteriaHealthFor } from '../../../../harness/health-board';
import { NextResponse } from '../../../../http';
import { getTasks } from '../../../../store/data';
import { listJourneys } from '../../../../store/ligma-dir';
import { findProject } from '../_lib';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { tasks } = await getTasks();
  const journeyIds = project.repoPath
    ? listJourneys(project.repoPath).journeys.map((j) => j.id)
    : [];

  const body: ProjectHealthResponse = {
    projectId: project.id,
    criteria: criteriaHealthFor(project.id, tasks, journeyIds),
  };
  return NextResponse.json(body);
}
