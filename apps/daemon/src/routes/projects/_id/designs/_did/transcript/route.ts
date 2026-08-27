/**
 * GET /api/projects/:id/designs/:did/transcript — the design's turn
 * conversation, as append records, for a composer column that just reloaded.
 *
 * The live SSE lane and this route carry the identical `DesignTranscriptEntry`
 * shape, so the pane folds one stream of input either way. Unlike
 * `critique-transcript`, an empty transcript is a 200 with no entries rather
 * than a 404: a design that has never had a turn genuinely has nothing to say,
 * and an empty conversation is the honest rendering of that.
 */

import { type NextRequest, NextResponse } from '../../../../../../http';
import { readTurnTranscript } from '../../../../../../studio/turn-transcript';
import { requireDesign } from '../../_lib';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  return NextResponse.json({ designId: did, entries: await readTurnTranscript(id, did) });
}
