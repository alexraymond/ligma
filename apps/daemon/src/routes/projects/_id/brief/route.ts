/**
 * GET  /api/projects/:id/brief — the Brief stage artifact.
 * PATCH /api/projects/:id/brief — edit it, lock it, or answer its stale flag.
 *
 * A brief is editable until a contract compiles against it. After that, an edit
 * **flags dependents stale** rather than invalidating anything — the pinned
 * product default (build brief §2). Nothing downstream is touched: staleness is
 * a claim about the designs and tasks, and the human decides what to do about it
 * from the Deck card the flag produces.
 *
 * `acknowledgeStale` and `flagStale` are that card's two directions — answer and
 * undo — which is why the flag is a plain timestamp rather than a separate
 * decision row: one fact, one place, reversible.
 */

import { DRIFT_AGE_DAYS, editFlagsStale } from '@ligma/api';
import { z } from 'zod';
import { readBrief, writeBrief } from '../../../../engine/discovery';
import { NextResponse } from '../../../../http';
import { validateBody } from '../../../../store/validations';

const DRIFT_AGE_MS = DRIFT_AGE_DAYS * 24 * 60 * 60 * 1000;

const patchSchema = z
  .object({
    prompt: z.string().min(1).max(20_000).optional(),
    constraints: z.array(z.string().min(1).max(2000)).max(50).optional(),
    lock: z.boolean().optional(),
    /** Clear the stale flag — the Deck card's answer. */
    acknowledgeStale: z.boolean().optional(),
    /** Re-raise it — the Deck card's undo. */
    flagStale: z.boolean().optional(),
    /** The drift card's "still true" answer — snoozes it for DRIFT_AGE_DAYS. */
    snooze: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change' });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brief = readBrief(id);
  // A project without a brief is a normal state (adopted/legacy projects), not
  // an error — the deck queue polls this for every project on every route.
  return NextResponse.json({ brief: brief ?? null });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validation = await validateBody(request, patchSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const brief = readBrief(id);
  if (!brief) return NextResponse.json({ error: 'No brief for this project' }, { status: 404 });

  const edited = body.prompt !== undefined || body.constraints !== undefined;
  const now = new Date().toISOString();
  // An edit only *raises* the flag; it never lowers one already raised, so the
  // human's acknowledgement of the last edit is not silently undone by the
  // next. Snoozing is a stronger "still true" answer than acknowledge — it
  // resolves both triggers the same card can fire for, so it clears the flag
  // exactly like acknowledgeStale does.
  const staleFlaggedAt =
    body.acknowledgeStale || body.snooze
      ? null
      : body.flagStale || (edited && editFlagsStale(brief))
        ? (brief.staleFlaggedAt ?? now)
        : brief.staleFlaggedAt;

  const next = {
    ...brief,
    prompt: body.prompt ?? brief.prompt,
    constraints: body.constraints ?? brief.constraints,
    updatedAt: now,
    staleFlaggedAt,
    staleSnoozedUntil: body.snooze
      ? new Date(Date.now() + DRIFT_AGE_MS).toISOString()
      : (brief.staleSnoozedUntil ?? null),
    ...(body.lock && brief.status === 'discovery'
      ? { status: 'locked' as const, lockedAt: now }
      : {}),
  };

  return NextResponse.json({ brief: writeBrief(next) });
}
