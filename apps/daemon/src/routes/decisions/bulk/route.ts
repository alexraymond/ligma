import type { ActivityEvent, DecisionItem } from '@ligma/api';
import { type DeckAction, UNDO_WINDOW_MS, applyDisposition } from '@ligma/api';
import { z } from 'zod';
/**
 * PATCH /api/decisions/bulk — answer/dismiss/urgent/defer N decisions at once.
 *
 * Closes the second D4 seam gap (see scripts/acceptance/drill-d4.ts's header,
 * before this row): the Deck's batch mode (`bulkApply` in
 * apps/web/src/app/deck/page.tsx) used to loop one `PATCH /api/decisions` per
 * selected item — "one server round-trip per item" by its own comment. This
 * mirrors `/api/tasks/bulk`'s shape (one body, one `{ id, ...changes }` per
 * entry) but keeps every item on the *deck-disposition* semantics of the
 * single PATCH in `../route.ts`, not the plain-field PUT: same
 * `applyDisposition`, same server-derived `undoExpiresAt`, same undo journal
 * (imported from there, not a second one) — so an item answered in a batch of
 * twelve is undoable exactly like one answered alone.
 *
 * Atomic: every item is read, checked and written inside ONE `mutateDecisions`
 * pass — the file is read and rewritten once for the whole batch, not once per
 * item. Idempotent: an item that is no longer pending (already answered, e.g.
 * by a second tab, or a retried request replaying the same batch) reports its
 * own failure rather than throwing or corrupting the rest of the batch — the
 * exact "stale-card guard" the single PATCH already enforces.
 */
import { NextResponse } from '../../../http';
import { mutateActivityLog, mutateDecisions } from '../../../store/data';
import { generateId } from '../../../store/ids';
import { LIMITS, validateBody } from '../../../store/validations';
import { pruneJournal, taskProjectIndex, undoJournal } from '../route';

const bulkItemSchema = z
  .object({
    id: z.string().min(1, 'Decision ID is required'),
    action: z.enum(['answer', 'dismiss', 'urgent', 'defer']),
    answer: z.string().max(LIMITS.ANSWER).optional(),
  })
  .refine((b) => b.action !== 'answer' || (b.answer?.trim().length ?? 0) > 0, {
    message: 'answer is required for the answer action',
    path: ['answer'],
  });

const bulkSchema = z.object({
  items: z.array(bulkItemSchema).min(1, 'items array required'),
});

interface BulkItemOk {
  id: string;
  ok: true;
  decision: DecisionItem;
  undoExpiresAt: string;
}
interface BulkItemErr {
  id: string;
  ok: false;
  error: string;
}
type BulkItemResult = BulkItemOk | BulkItemErr;

export async function PATCH(request: Request) {
  const validation = await validateBody(request, bulkSchema);
  if (!validation.success) return validation.error;
  const { items } = validation.data;

  const now = Date.now();
  pruneJournal(now);

  // One read-modify-write pass for the whole batch — same file, same lock,
  // exactly once (async-mutex's runExclusive inside mutateDecisions), so a
  // concurrent request can never observe half the batch applied.
  const results = await mutateDecisions(async (data) => {
    const outcomes: BulkItemResult[] = [];
    for (const item of items) {
      const idx = data.decisions.findIndex((d) => d.id === item.id);
      if (idx === -1) {
        outcomes.push({ id: item.id, ok: false, error: 'Decision not found' });
        continue;
      }
      const before = data.decisions[idx];
      // Same stale-card guard as the single PATCH: an already-resolved
      // decision (by an earlier item in this same batch, a second tab, or a
      // retried request) fails for that one id instead of double-applying.
      if (before.status !== 'pending') {
        outcomes.push({ id: item.id, ok: false, error: 'Decision is no longer pending' });
        continue;
      }
      const after = applyDisposition(
        before,
        item.action as DeckAction,
        item.answer?.trim() ?? '',
        now,
      );
      data.decisions[idx] = after;
      // eventId is patched in below once the activity log write (a separate
      // mutex) has actually happened.
      undoJournal.set(item.id, { at: now, before, eventId: null });
      outcomes.push({
        id: item.id,
        ok: true,
        decision: after,
        undoExpiresAt: new Date(now + UNDO_WINDOW_MS).toISOString(),
      });
    }
    return outcomes;
  });

  const actionById = new Map(items.map((i) => [i.id, i.action] as const));
  const succeeded = results.filter((r): r is BulkItemOk => r.ok);
  // Only answer/dismiss resolve a decision, so only they belong in the
  // activity log — same rule as the single PATCH.
  const loggable = succeeded.filter((r) => {
    const action = actionById.get(r.id);
    return action === 'answer' || action === 'dismiss';
  });

  if (loggable.length > 0) {
    // One read of tasks.json for the whole batch, matching the single-write
    // promise above — a per-item lookup would undo the point of this endpoint.
    const projectByTask = await taskProjectIndex();
    await mutateActivityLog(async (logData) => {
      for (const r of loggable) {
        const eventId = generateId('evt');
        const taskId = r.decision.taskId;
        const event: ActivityEvent = {
          id: eventId,
          type: 'decision_answered',
          actor: 'me',
          taskId,
          projectId: taskId ? (projectByTask.get(taskId) ?? null) : null,
          summary: `Answered: ${r.decision.question.slice(0, 60)} → "${r.decision.answer}"`,
          details: `decision:${r.id}`,
          timestamp: new Date(now).toISOString(),
        };
        logData.events.push(event);
        const entry = undoJournal.get(r.id);
        if (entry) entry.eventId = eventId;
      }
    });
  }

  return NextResponse.json({
    results,
    succeeded: succeeded.length,
    failed: results.length - succeeded.length,
  });
}
