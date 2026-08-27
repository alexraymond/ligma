/**
 * GET/POST/PATCH /api/projects/:id/designs/:did/pins — comment pin CRUD.
 *
 * A pin carries the enrichment the runtime overlay captured at click time
 * (selector, outerHTML, parent context) so the compiled instruction can name
 * the element instead of describing it. PATCH edits or removes a staged pin;
 * an applied pin is history and is not editable.
 */

import type { DesignPin, PinScope } from '@ligma/api';
import { NextResponse } from '../../../../../../http';
import { generateId } from '../../../../../../store/ids';
import { mutateManifest } from '../../../../../../studio/store';
import { badRequest, jsonBody, requireDesign } from '../../_lib';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;
  return NextResponse.json({ designId: did, pins: found.manifest.pins });
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
    for (const field of ['filePath', 'selector', 'tag', 'outerHTML', 'text']) {
      if (typeof body[field] !== 'string' || (body[field] as string).trim() === '') {
        throw new Error(`\`${field}\` is required`);
      }
    }
    const pin: DesignPin = {
      id: generateId('pin'),
      filePath: body.filePath as string,
      selector: body.selector as string,
      tag: body.tag as string,
      outerHTML: body.outerHTML as string,
      parentOuterHTML: typeof body.parentOuterHTML === 'string' ? body.parentOuterHTML : null,
      text: body.text as string,
      scope: body.scope === 'global' ? 'global' : ('element' as PinScope),
      status: 'pending',
      createdAt: new Date().toISOString(),
      appliedInVersionId: null,
    };
    await mutateManifest(id, did, (manifest) => {
      manifest.pins.push(pin);
    });
    return NextResponse.json(pin, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  try {
    const body = await jsonBody(request);
    if (typeof body.pinId !== 'string') throw new Error('`pinId` is required');
    const result = await mutateManifest(id, did, (manifest) => {
      const pin = manifest.pins.find((p) => p.id === body.pinId);
      if (!pin) throw new Error(`Pin not found: ${String(body.pinId)}`);
      // An applied pin records what a turn actually did; editing it would make
      // the link from pin to turn a lie.
      if (pin.status === 'applied')
        throw new Error('An applied pin is history and cannot be edited');
      if (body.remove === true) {
        manifest.pins = manifest.pins.filter((p) => p.id !== body.pinId);
        return { removed: true, pin: null };
      }
      if (typeof body.text === 'string') pin.text = body.text;
      if (body.scope === 'global' || body.scope === 'element') pin.scope = body.scope;
      return { removed: false, pin };
    });
    return NextResponse.json(result);
  } catch (err) {
    return badRequest(err);
  }
}
