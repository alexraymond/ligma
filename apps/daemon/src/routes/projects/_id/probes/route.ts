/**
 * GET /api/projects/:id/probes — the regression corpus, read-only.
 *
 * Every failure the product has been caught in, newest first, each linking the
 * verdict that filed it. Re-asking one is "Prove it" on its journey — there is
 * no separate replay, on purpose.
 */

import type { RegressionProbeListResponse } from '@ligma/api';
import { listProbes } from '../../../../harness/probes';
import { NextResponse } from '../../../../http';
import { findProject } from '../_lib';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const body: RegressionProbeListResponse = {
    projectId: project.id,
    probes: listProbes(project.id),
  };
  return NextResponse.json(body);
}
