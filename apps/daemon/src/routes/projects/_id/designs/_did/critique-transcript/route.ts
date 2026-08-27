/**
 * GET /api/projects/:id/designs/:did/critique-transcript — the latest critique
 * run's persisted event stream, for replay.
 *
 * Replay and the live SSE lane share one event vocabulary and one reducer on
 * the web side; this route only hands back what the critic already wrote. No
 * transcript yet (design never critiqued, or written by an older build) is a
 * 404, not an empty stream — an empty replay would look like a critique that
 * found nothing.
 */

import { type NextRequest, NextResponse } from '../../../../../../http';
import { readLatestCritiqueTranscript } from '../../../../../../studio/critic-transcript';
import { requireDesign } from '../../_lib';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  const transcript = await readLatestCritiqueTranscript(id, did);
  if (!transcript) {
    return NextResponse.json(
      { error: 'No critique transcript recorded for this design' },
      { status: 404 },
    );
  }
  return NextResponse.json(transcript);
}
