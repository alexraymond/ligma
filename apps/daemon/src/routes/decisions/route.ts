import type { ActivityEvent, DecisionItem } from '@ligma/api';
import { type DeckAction, UNDO_WINDOW_MS, applyDisposition } from '@ligma/api';
import { z } from 'zod';
// Applies the answer the human just gave NOW, rather than at the next
// dispatcher poll (process audit P16 / seam S6): answering a verification-cap
// card used to flip the card and leave the task sitting for up to five minutes
// — 4½ minutes of "answered, nothing moved" was measured. The poll cycle stays
// the backstop; each card is consumed once, so running from both places is
// idempotent, and the callable never throws.
import { consumeAnsweredCapCardsNow } from '../../engine/dispatcher';
import { NextResponse } from '../../http';
import { getDecisions, getTasks, mutateActivityLog, mutateDecisions } from '../../store/data';
import { generateId } from '../../store/ids';
import {
  DEFAULT_LIMIT,
  LIMITS,
  decisionCreateSchema,
  decisionUpdateSchema,
  validateBody,
} from '../../store/validations';

/**
 * taskId → projectId, for stamping a decision's activity event with the project
 * it belongs to. A decision carries a taskId, and the task is what knows the
 * project — so the scope is derived from the store, never guessed.
 *
 * Returns the whole index rather than one lookup so `./bulk/route.ts` can stamp
 * a twelve-item batch off a single read of tasks.json, which is the one-read
 * promise that endpoint is built around. Exported for exactly that.
 */
export async function taskProjectIndex(): Promise<Map<string, string | null>> {
  const { tasks } = await getTasks();
  return new Map(tasks.map((t) => [t.id, t.projectId ?? null]));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const data = await getDecisions();

  const total = data.decisions.length;
  let decisions = data.decisions;

  if (status) {
    decisions = decisions.filter((d) => d.status === status);
  }

  // Sort: pending first, then by date newest first
  decisions.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = decisions.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  decisions = decisions.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: decisions,
      decisions,
      meta: { total, filtered: totalFiltered, returned: decisions.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, decisionCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newDecision = await mutateDecisions(async (data) => {
    const decision: DecisionItem = {
      id: generateId('dec'),
      requestedBy: body.requestedBy,
      taskId: body.taskId,
      question: body.question,
      options: body.options,
      context: body.context,
      status: 'pending',
      answer: null,
      answeredAt: null,
      createdAt: body.createdAt ?? new Date().toISOString(),
      // Accepted by decisionCreateSchema and used for daemon gating + deck
      // ordering, so it has to survive the round-trip. Undefined stringifies away.
      blocksTask: body.blocksTask,
    };
    data.decisions.push(decision);
    return decision;
  });

  // Log activity
  const projectId = newDecision.taskId
    ? ((await taskProjectIndex()).get(newDecision.taskId) ?? null)
    : null;
  await mutateActivityLog(async (logData) => {
    const event: ActivityEvent = {
      id: generateId('evt'),
      type: 'decision_requested',
      actor: newDecision.requestedBy,
      taskId: newDecision.taskId,
      projectId,
      summary: `Decision requested: ${newDecision.question.slice(0, 80)}`,
      details: newDecision.context,
      timestamp: new Date().toISOString(),
    };
    logData.events.push(event);
  });

  return NextResponse.json(newDecision, { status: 201 });
}

export async function PUT(request: Request) {
  const validation = await validateBody(request, decisionUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const result = await mutateDecisions(async (data) => {
    const idx = data.decisions.findIndex((d) => d.id === body.id);
    if (idx === -1) return null;

    const wasAnswered = data.decisions[idx].status === 'pending' && body.status === 'answered';
    // Same stale-card guard PATCH enforces (codebase audit R8): a second tab
    // must not re-answer a decision that is already resolved. Only the
    // answer/dismiss transition is guarded — an edit that leaves the status
    // alone is not a disposition.
    if (body.status && body.status !== 'pending' && data.decisions[idx].status !== 'pending') {
      return 'not-pending' as const;
    }

    data.decisions[idx] = {
      ...data.decisions[idx],
      ...body,
      answeredAt: wasAnswered ? new Date().toISOString() : data.decisions[idx].answeredAt,
    };

    return { decision: data.decisions[idx], wasAnswered };
  });

  if (!result) {
    return NextResponse.json({ error: 'Decision not found' }, { status: 404 });
  }
  if (result === 'not-pending') {
    return NextResponse.json({ error: 'Decision is no longer pending' }, { status: 409 });
  }

  // Log activity if decision was just answered
  if (result.wasAnswered) {
    const taskId = result.decision.taskId;
    const projectId = taskId ? ((await taskProjectIndex()).get(taskId) ?? null) : null;
    await mutateActivityLog(async (logData) => {
      const event: ActivityEvent = {
        id: generateId('evt'),
        type: 'decision_answered',
        actor: 'me',
        taskId,
        projectId,
        summary: `Answered: ${result.decision.question.slice(0, 60)} → "${body.answer}"`,
        details: '',
        timestamp: new Date().toISOString(),
      };
      logData.events.push(event);
    });
    await consumeAnsweredCapCardsNow();
  }

  return NextResponse.json(result.decision);
}

// ─── Deck dispositions (PATCH) ───────────────────────────────────────────────

const deckActionSchema = z
  .object({
    id: z.string().min(1, 'Decision ID is required'),
    action: z.enum(['answer', 'dismiss', 'urgent', 'defer', 'undo']),
    answer: z.string().max(LIMITS.ANSWER).optional(),
  })
  .refine((b) => b.action !== 'answer' || (b.answer?.trim().length ?? 0) > 0, {
    message: 'answer is required for the answer action',
    path: ['answer'],
  });

/**
 * Undo journal — the previous state of every deck disposition, kept for the
 * length of the undo window. The server owns the clock, so the 10s window
 * cannot be lied about by a client, and no timestamp has to be invented on
 * DecisionItem (a pending decision with an `answeredAt` would be a lie).
 *
 * ponytail: in-process Map, pruned on write. An undo window that does not
 * survive a server restart is not a bug — 10 seconds of unsaved intent is not
 * state worth persisting. Move it into data/ only if the app ever runs
 * multi-process.
 */
// Exported so `./bulk/route.ts` shares the exact same journal: a decision
// answered through the batch endpoint must be undoable through this same
// PATCH's `action: "undo"`, on the same terms as one answered singly.
export const undoJournal = new Map<
  string,
  { at: number; before: DecisionItem; eventId: string | null }
>();

export function pruneJournal(now: number): void {
  for (const [id, entry] of undoJournal) {
    if (now - entry.at > UNDO_WINDOW_MS) undoJournal.delete(id);
  }
}

export async function PATCH(request: Request) {
  const validation = await validateBody(request, deckActionSchema);
  if (!validation.success) return validation.error;
  const { id, action, answer } = validation.data;

  const now = Date.now();
  // Undo first: pruning before the expiry check would turn "window expired"
  // into "nothing to undo" and lie to the user about why it failed.
  if (action === 'undo') return undoDisposition(id, now);
  pruneJournal(now);

  const result = await mutateDecisions(async (data) => {
    const idx = data.decisions.findIndex((d) => d.id === id);
    if (idx === -1) return { error: 'not-found' as const };
    const before = data.decisions[idx];
    // Stale-card guard: a second tab (or a keyboard repeat that slipped through)
    // must never re-dispose an already-answered decision.
    if (before.status !== 'pending') return { error: 'not-pending' as const };
    const after = applyDisposition(before, action as DeckAction, answer?.trim() ?? '', now);
    data.decisions[idx] = after;
    return { before, after };
  });

  if ('error' in result) {
    return result.error === 'not-found'
      ? NextResponse.json({ error: 'Decision not found' }, { status: 404 })
      : NextResponse.json({ error: 'Decision is no longer pending' }, { status: 409 });
  }

  // Only answer/dismiss resolve a decision, so only they belong in the activity log.
  let eventId: string | null = null;
  if (action === 'answer' || action === 'dismiss') {
    eventId = generateId('evt');
    const taskId = result.after.taskId;
    const projectId = taskId ? ((await taskProjectIndex()).get(taskId) ?? null) : null;
    await mutateActivityLog(async (logData) => {
      const event: ActivityEvent = {
        id: eventId!,
        type: 'decision_answered',
        actor: 'me',
        taskId,
        projectId,
        summary: `Answered: ${result.after.question.slice(0, 60)} → "${result.after.answer}"`,
        details: `decision:${id}`,
        timestamp: new Date(now).toISOString(),
      };
      logData.events.push(event);
    });
  }

  undoJournal.set(id, { at: now, before: result.before, eventId });

  // Deliberately AFTER the undo journal entry: undo restores the decision row,
  // and a cap card consumed here has already moved its task — the same race the
  // poll cycle always had, not a new one this introduces.
  if (action === 'answer') await consumeAnsweredCapCardsNow();

  return NextResponse.json({
    decision: result.after,
    undoExpiresAt: new Date(now + UNDO_WINDOW_MS).toISOString(),
  });
}

async function undoDisposition(id: string, now: number) {
  const entry = undoJournal.get(id);
  if (!entry) {
    return NextResponse.json({ error: 'Nothing to undo for this decision' }, { status: 404 });
  }
  if (now - entry.at > UNDO_WINDOW_MS) {
    undoJournal.delete(id);
    return NextResponse.json({ error: 'Undo window expired (10s)' }, { status: 409 });
  }

  // Restores the exact pre-disposition snapshot. Within 10s that is the honest
  // rollback; a concurrent edit in that window loses, which is the same trade
  // the rest of the file-backed API makes.
  const restored = await mutateDecisions(async (data) => {
    const idx = data.decisions.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    data.decisions[idx] = entry.before;
    return entry.before;
  });

  if (!restored) {
    undoJournal.delete(id);
    return NextResponse.json({ error: 'Decision not found' }, { status: 404 });
  }

  // Drop the activity event too — the log must not claim an answer that was undone.
  if (entry.eventId) {
    await mutateActivityLog(async (logData) => {
      logData.events = logData.events.filter((e) => e.id !== entry.eventId);
    });
  }

  undoJournal.delete(id);
  return NextResponse.json({ decision: restored });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const removed = await mutateDecisions(async (data) => {
    const before = data.decisions.length;
    data.decisions = data.decisions.filter((d) => d.id !== id);
    return data.decisions.length !== before;
  });

  // `{ok:true}` for an id that was never there told a caller its delete
  // succeeded when nothing happened (codebase audit R8).
  if (!removed) return NextResponse.json({ error: 'Decision not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
