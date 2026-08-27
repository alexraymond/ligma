/**
 * POST /api/projects/:id/promote — the one confirm.
 *
 * Compiles and signs a contract per task (with the design baseline where there
 * is one), lands the tasks on the board, and writes the proposed journeys into
 * the target repo's `.ligma/journeys/`. The reviewed preview is echoed back
 * rather than recomputed: approving one breakdown and compiling a different one
 * would make the review sheet decorative.
 */

import type { PromotePreview } from '@ligma/api';
import { NextResponse } from '../../../../http';
import { ensureProductRepo } from '../../../../store/product-repo';
import { promoteRequestSchema, validateBody } from '../../../../store/validations';
import { clearPendingPromotion, promotionKey } from '../../../../studio/pending-promotion';
import { PromoteAlreadyCommittedError, commitPromote } from '../../../../studio/promote';
import { badRequest } from '../designs/_lib';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Validated, not cast: see promoteRequestSchema's header for what rode in
  // through the old `jsonBody` + `as PromotePreview` (process audit P6).
  const validation = await validateBody(request, promoteRequestSchema);
  if (!validation.success) return validation.error;
  const preview = validation.data.preview as PromotePreview;

  try {
    // A greenfield project has nowhere to be built yet. Provision BEFORE the
    // commit so the journeys below land in the product's own `.ligma/`, and let
    // a failure stop the promote: tasks with no repo would build into ligma.
    await ensureProductRepo(id);
    const result = await commitPromote(id, { preview });
    // The confirm happened — the Deck card that was waiting on it is done.
    clearPendingPromotion(id, promotionKey(preview.designId));
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // A replayed commit is a conflict, not a malformed request (P5).
    if (err instanceof PromoteAlreadyCommittedError) return badRequest(err, 409);
    return badRequest(err);
  }
}
