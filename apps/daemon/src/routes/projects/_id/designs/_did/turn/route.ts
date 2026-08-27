/**
 * POST /api/projects/:id/designs/:did/turn — one endpoint, three turn kinds.
 *
 * `kind` discriminates the prompt, not the machinery (CONTRACTS-phase3: "one
 * turn endpoint, kind-discriminated"). The response returns as soon as the turn
 * is accepted; everything after that arrives on the stream, because a
 * multi-file generation takes minutes and the Wall renders it progressively.
 *
 * DELETE interrupts a turn in flight — the critique lane's interrupt button and
 * the Wall's stop share it.
 */

import type { DesignTurnRequest, TweakValues } from '@ligma/api';
import { NextResponse } from '../../../../../../http';
import { abortTurn, startTurn } from '../../../../../../studio/session';
import { badRequest, jsonBody, requireDesign } from '../../_lib';

function parseTurn(body: Record<string, unknown>): DesignTurnRequest {
  switch (body.kind) {
    case 'prompt': {
      if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
        throw new Error('a prompt turn needs a non-empty `prompt`');
      }
      const filePaths = Array.isArray(body.filePaths)
        ? body.filePaths.filter((p): p is string => typeof p === 'string')
        : undefined;
      // Ids only — the bytes went up through `.../attachments` first, and
      // `startTurn` refuses an id that design has never seen.
      const attachmentIds = Array.isArray(body.attachmentIds)
        ? body.attachmentIds.filter((a): a is string => typeof a === 'string')
        : undefined;
      return {
        kind: 'prompt',
        prompt: body.prompt,
        ...(filePaths ? { filePaths } : {}),
        ...(attachmentIds ? { attachmentIds } : {}),
      };
    }
    case 'comment-apply': {
      const pinIds = Array.isArray(body.pinIds)
        ? body.pinIds.filter((p): p is string => typeof p === 'string')
        : undefined;
      // An empty prompt is legitimate: that is the "Apply" button, which sends
      // the compiled edit block and nothing else.
      return {
        kind: 'comment-apply',
        ...(typeof body.prompt === 'string' ? { prompt: body.prompt } : {}),
        ...(pinIds ? { pinIds } : {}),
      };
    }
    case 'tweak': {
      if (body.values === null || typeof body.values !== 'object') {
        throw new Error('a tweak turn needs a `values` object of token → value');
      }
      const values: TweakValues = {};
      for (const [token, value] of Object.entries(body.values as Record<string, unknown>)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          values[token] = value;
        } else {
          throw new Error(`tweak "${token}" must be a string, number or boolean`);
        }
      }
      return { kind: 'tweak', values };
    }
    default:
      throw new Error('`kind` must be one of "prompt", "comment-apply", "tweak"');
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  try {
    const accepted = await startTurn(id, did, parseTurn(await jsonBody(request)));
    return NextResponse.json(accepted, { status: 202 });
  } catch (err) {
    return badRequest(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { did } = await params;
  return NextResponse.json({ designId: did, aborted: abortTurn(did) });
}
