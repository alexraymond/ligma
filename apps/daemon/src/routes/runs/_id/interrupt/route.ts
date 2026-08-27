/**
 * POST /api/runs/:id/interrupt — stop **one** run (UX spec §6 Runs).
 *
 * Until now the only interrupt was daemon-wide: "Disengage Autopilot" stops
 * every session at once, which is not the same offer at all. This stops the one
 * run the human is looking at, returns its task to the board, and records that a
 * human did it — so the row reads "stopped by you", not "a run malfunctioned".
 */

import { NextResponse } from '../../../../http';
import { stopRun } from '../../_lib';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const outcome = await stopRun(id, null);
  if (outcome.alreadyFinished) {
    return NextResponse.json(
      { error: 'This run already finished — its history is evidence and is not rewritten.' },
      { status: 409 },
    );
  }
  if (!outcome.found)
    return NextResponse.json({ error: 'Run not found or already finished' }, { status: 404 });
  return NextResponse.json({ runId: id, taskId: outcome.taskId, status: 'interrupted' });
}
