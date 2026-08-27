/**
 * GET /api/projects/:id/baselines/:jid — one journey's characterization record.
 */

import { readBaseline } from '../../../../../harness/baselines';
import { NextResponse } from '../../../../../http';
import { badRequest, findProject } from '../../_lib';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; jid: string }> },
) {
  const { id, jid } = await params;
  if (!(await findProject(id)))
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  try {
    const baseline = readBaseline(id, jid);
    if (!baseline) {
      return NextResponse.json(
        {
          error: 'No baseline yet — the first journey run records one',
          projectId: id,
          journeyId: jid,
        },
        { status: 404 },
      );
    }
    return NextResponse.json(baseline);
  } catch (err) {
    return badRequest(err);
  }
}
