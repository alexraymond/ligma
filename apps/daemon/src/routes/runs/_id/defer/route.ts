/**
 * POST /api/runs/:id/defer — stop this run and let it come back later.
 *
 * Deferral is the calm state (§7): the run row goes violet with a real resume
 * time and the task carries a `deferredUntil` the dispatcher waits for, rather
 * than being silently dropped or bounced straight back into the queue it was
 * just taken out of.
 *
 * `minutes` is the wait, defaulting to an hour — the same ceiling the retry
 * queue's own backoff caps at, so a human deferral is never longer than the
 * longest wait the engine would impose on itself.
 */

import { z } from 'zod';
import { NextResponse } from '../../../../http';
import { stopRun } from '../../_lib';

const DEFAULT_MINUTES = 60;

const deferSchema = z.object({
  minutes: z.number().int().min(1).max(60).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // An empty body means "the default wait" — this is a one-button action, and
  // demanding `{}` from it would be ceremony.
  const raw = (await request.text().catch(() => '')).trim();
  let body: unknown = {};
  if (raw !== '') {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }
  const validation = deferSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: 'minutes must be a whole number of minutes, 1–60' },
      { status: 400 },
    );
  }

  const minutes = validation.data.minutes ?? DEFAULT_MINUTES;
  const deferredUntil = new Date(Date.now() + minutes * 60_000).toISOString();

  const outcome = await stopRun(id, deferredUntil);
  if (outcome.alreadyFinished) {
    return NextResponse.json(
      { error: 'This run already finished — there is nothing left to defer.' },
      { status: 409 },
    );
  }
  if (!outcome.found)
    return NextResponse.json({ error: 'Run not found or already finished' }, { status: 404 });
  return NextResponse.json({
    runId: id,
    taskId: outcome.taskId,
    status: 'deferred',
    resumesAt: deferredUntil,
  });
}
