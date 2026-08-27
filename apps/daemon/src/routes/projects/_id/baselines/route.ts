/**
 * GET /api/projects/:id/baselines — read-only over the CENTRAL baseline store.
 *
 * Read-only on purpose: baselines are written by journey runs, never by a
 * client, and they live under `data/projects/<id>/baselines/` where builder
 * spawns are denied them (twin-primitives §3).
 */

import { listBaselines } from '../../../../harness/baselines';
import { NextResponse } from '../../../../http';
import { findProject } from '../_lib';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await findProject(id)))
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json({ projectId: id, baselines: listBaselines(id) });
}
