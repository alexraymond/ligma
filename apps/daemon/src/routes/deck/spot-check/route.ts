/**
 * POST /api/deck/spot-check — answer a verdict spot-check card.
 *
 * The one card kind that had no server-side answer path at all: its "looks
 * right" memory lived in one browser's localStorage, so it was unanswerable
 * from the CLI or an agent and reappeared in every other client (process audit
 * P9, seam S2). The answer now lands in `spot-check-reviews.json` and
 * `GET /api/deck` drops the cards it covers.
 *
 * `GET` returns the reviews recorded so far — the CLI's way of seeing what has
 * already been audited without opening the Deck.
 */

import { z } from 'zod';
import { NextResponse } from '../../../http';
import { getTasks } from '../../../store/data';
import { readSpotCheckReviews, recordSpotCheckReview } from '../../../store/spot-check-reviews';
import { validateBody } from '../../../store/validations';
import { runExists } from '../../verification-runs/_lib';

const spotCheckSchema = z.object({
  taskId: z.string().min(1).max(64).nullable().default(null),
  runId: z.string().min(1).max(128),
  answer: z.enum(['confirmed', 'disputed']),
});

export async function GET() {
  return NextResponse.json({ reviews: readSpotCheckReviews() });
}

export async function POST(request: Request) {
  const validation = await validateBody(request, spotCheckSchema);
  if (!validation.success) return validation.error;
  const { taskId, runId, answer } = validation.data;

  // A review of a run that does not exist is not a review of anything — and an
  // unchecked id is a path segment on the evidence side.
  if (!runExists(runId)) {
    return NextResponse.json({ error: `Verification run not found: ${runId}` }, { status: 404 });
  }
  if (taskId) {
    const { tasks } = await getTasks();
    if (!tasks.some((t) => t.id === taskId)) {
      return NextResponse.json({ error: `Task not found: ${taskId}` }, { status: 404 });
    }
  }

  return NextResponse.json(recordSpotCheckReview({ taskId, runId, answer }), { status: 201 });
}
