/**
 * POST /api/projects/:id/designs/:did/pins/preview — the apply-preview.
 *
 * F4's fix for ligma-classic's opacity: "Apply (N)" used to send a compiled
 * instruction block the user never saw. This returns *exactly* what the
 * comment-apply turn would transmit — same function, same inputs — so the
 * preview cannot drift from the payload. If it could, the preview would be
 * reassurance rather than disclosure.
 */

import { NextResponse } from '../../../../../../../http';
import { buildInstructionPreview } from '../../../../../../../studio/prompt';
import { badRequest, jsonBody, requireDesign } from '../../../_lib';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  try {
    const body = await jsonBody(request);
    const requested = Array.isArray(body.pinIds)
      ? body.pinIds.filter((p): p is string => typeof p === 'string')
      : null;
    const staged = found.manifest.pins.filter(
      (pin) => pin.status === 'pending' && (requested === null || requested.includes(pin.id)),
    );
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    return NextResponse.json(buildInstructionPreview(did, prompt, staged));
  } catch (err) {
    return badRequest(err);
  }
}
