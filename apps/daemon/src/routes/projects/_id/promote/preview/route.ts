/**
 * POST /api/projects/:id/promote/preview — propose, commit nothing.
 *
 * Both entrances land here (UX spec F1.4): `designId` for the UI path,
 * `brief` (or nothing, falling back to the project's own) for the headless one.
 * The response carries the breakdown, the criteria WITH their holdout split,
 * the proposed journeys and the live governor estimate — everything the user
 * needs before the one confirm that freezes the oracle.
 *
 * A preview also leaves a **pending-promotion** record behind, so a contract
 * one click from being frozen is visible in the Deck rather than only on the
 * sheet the user has to remember to come back to. `GET` lists what is pending;
 * `DELETE` is the cancel, and committing clears it too.
 */

import type { PendingPromotionListResponse } from '@ligma/api';
import { NextResponse } from '../../../../../http';
import {
  clearPendingPromotion,
  promotionKey,
  readPendingPromotions,
  recordPendingPromotion,
} from '../../../../../studio/pending-promotion';
import { buildPromotePreview } from '../../../../../studio/promote';
import { findProject } from '../../_lib';
import { badRequest, jsonBody } from '../../designs/_lib';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const body: PendingPromotionListResponse = { projectId: id, pending: readPendingPromotions(id) };
  return NextResponse.json(body);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await jsonBody(request);
    const preview = await buildPromotePreview(id, {
      ...(typeof body.designId === 'string' ? { designId: body.designId } : {}),
      ...(typeof body.brief === 'string' ? { brief: body.brief } : {}),
    });
    // Records nothing for a failed or empty preview — there is no confirm to wait on.
    recordPendingPromotion(preview);
    return NextResponse.json(preview);
  } catch (err) {
    return badRequest(err);
  }
}

/** The cancel: `?designId=` names the entrance, absent means the brief one. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const designId = new URL(request.url).searchParams.get('designId');
  const cleared = clearPendingPromotion(id, promotionKey(designId));
  return NextResponse.json({ projectId: id, key: promotionKey(designId), cleared });
}
