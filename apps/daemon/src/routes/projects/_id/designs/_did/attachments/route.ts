/**
 * GET/POST /api/projects/:id/designs/:did/attachments — the reference images a
 * design's composer is holding ("make it look like this").
 *
 * JSON + base64 `dataUrl`, the same upload shape `references/:id/design-files`
 * uses and for the same reason stated there: the daemon has no multipart
 * handling anywhere, and one image per click does not justify a dependency.
 * Every cap and every media-type check lives in `studio/attachments.ts`, so
 * this route and the create-design route cannot disagree about what is
 * acceptable.
 */

import { NextResponse } from '../../../../../../http';
import { listAttachments, saveAttachment } from '../../../../../../studio/attachments';
import { badRequest, jsonBody, requireDesign } from '../../_lib';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;
  return NextResponse.json({ designId: did, attachments: await listAttachments(id, did) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  try {
    const body = await jsonBody(request);
    if (typeof body.name !== 'string' || typeof body.dataUrl !== 'string') {
      throw new Error('an attachment needs `name` and a base64 `dataUrl`');
    }
    const attachment = await saveAttachment(id, did, { name: body.name, dataUrl: body.dataUrl });
    return NextResponse.json(
      { designId: did, attachment, attachments: await listAttachments(id, did) },
      { status: 201 },
    );
  } catch (err) {
    return badRequest(err);
  }
}
