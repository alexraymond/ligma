/**
 * GET /api/tasks/:id/evidence-pins — what the fix-task prompt builder reads.
 *
 * Returns every feedback pin filed against this task plus the compiled
 * instruction block, so appending the human's pointing to the next builder
 * prompt is one line at the prompt-builder's existing join. That one line is
 * deliberately not made here: `engine/prompt-builder.ts` belongs to another
 * workstream this phase, and the seam is the whole point of exposing this route.
 */

import { pinsForTask } from '../../../../engine/evidence-pins';
import { NextResponse } from '../../../../http';
import { getProjects } from '../../../../store/data';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { projects } = await getProjects();
  const { pins, instruction } = pinsForTask(
    projects.filter((p) => !p.deletedAt).map((p) => p.id),
    id,
  );
  return NextResponse.json({ taskId: id, pins, instruction });
}
