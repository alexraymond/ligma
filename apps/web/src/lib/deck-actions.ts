/**
 * Answering a Deck card that is not a decision.
 *
 * Each answer hits the endpoint that already owns the thing — no new "deck
 * actions" table, because a design approval *is* an approval and a stale
 * acknowledgement *is* a brief edit.
 *
 * Out here rather than inside the swipe deck because two surfaces answer these
 * cards now: the deck's head card and the list view's compact rows. One copy, so
 * the two can never drift into meaning different things by the same button.
 * Fetch-injectable, so what each option does is testable without a DOM.
 */

import type { DeckCard } from '@/hooks/use-deck-sources';
import { apiFetch } from '@/lib/api-client';
import type { Fetcher } from '@/lib/undo';
import { DECK_OPTIONS } from '@ligma/api';

export interface CardOutcome {
  /** What just happened, for the undo toast. */
  label: string;
  /**
   * Reverses the server-side (or stored) effect. Null where the effect is not
   * reversible from here. Callers add their own local un-acting on top.
   */
  undo: (() => Promise<void>) | null;
}

async function failWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? fallback);
}

async function patchBrief(
  projectId: string,
  body: Record<string, boolean>,
  fetcher: Fetcher,
): Promise<void> {
  const res = await fetcher(`/api/projects/${projectId}/brief`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await failWith(res, 'Brief update failed');
}

/**
 * Record a spot-check answer server-side (seam S2, `POST /api/deck/spot-check`).
 * Replaces what used to be `markSpotCheckReviewed`'s write to one browser's
 * localStorage — unanswerable from the CLI/an agent, and re-asked in every
 * other client (process audit P9).
 */
async function postSpotCheck(
  runId: string,
  answer: 'confirmed' | 'disputed',
  fetcher: Fetcher,
): Promise<void> {
  const res = await fetcher('/api/deck/spot-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: null, runId, answer }),
  });
  if (!res.ok) await failWith(res, 'Could not record the spot-check');
}

/**
 * Apply one of a card's options. Returns null when the option is not an action
 * (a link, or an unrecognised option), so the caller leaves the card alone.
 */
export async function applyCardOption(
  card: DeckCard,
  option: string,
  fetcher: Fetcher = apiFetch,
): Promise<CardOutcome | null> {
  const id = card.id.split(':')[1];
  switch (card.kind) {
    case 'design-approval': {
      if (option !== DECK_OPTIONS.designApproval[0]) {
        // "Keep iterating" is a skip, not a rejection: the design is still there
        // and the Studio is where iterating happens.
        return { label: 'Left for iteration', undo: async () => {} };
      }
      const projectId = card.href.split('/')[2];
      const res = await fetcher(`/api/projects/${projectId}/designs/${id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) await failWith(res, 'Approval failed');
      // Deliberately no undo: approval freezes a signed oracle. Un-approving
      // would have to unwind a contract, which is a Studio decision, not a swipe.
      return { label: 'Approved', undo: null };
    }
    case 'stale-brief': {
      if (option === DECK_OPTIONS.staleBriefEdited[0]) {
        await patchBrief(id, { acknowledgeStale: true }, fetcher);
        return {
          label: 'Staleness acknowledged',
          undo: async () => patchBrief(id, { flagStale: true }, fetcher),
        };
      }
      if (option === DECK_OPTIONS.staleBriefDrifted[1]) {
        await patchBrief(id, { snooze: true }, fetcher);
        // ponytail: no undo — un-snoozing would need to know the prior
        // staleSnoozedUntil (or its absence), which the card carries no slot
        // for. Add one if snooze regret turns out to be common.
        return { label: 'Snoozed for 90 days', undo: null };
      }
      // "Re-run discovery" is a navigation to the brief thread — see
      // navigationFor below — and "Open the brief" is a plain link either way.
      return null;
    }
    case 'verdict-spot-check': {
      if (option === DECK_OPTIONS.verdictSpotCheck[0]) {
        await postSpotCheck(id, 'confirmed', fetcher);
        // No undo: the review is server-side memory now, and there is no
        // "un-review" route — same honesty rule as approval above (W2).
        return { label: 'Verdict confirmed', undo: null };
      }
      // A challenged verdict is real work, so it enters the real queue as a
      // decision rather than evaporating into a local flag.
      const res = await fetcher('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedBy: 'system',
          taskId: null,
          question: `Judge calibration: the verdict on ${id} was challenged by spot-check. What is the right call?`,
          options: [
            'Re-run verification',
            'The criterion is wrong — rewrite it',
            'Leave it, I was wrong',
          ],
          // Both halves travel with the challenge: the criterion is what the
          // recipient has to re-read, the ruling is what is being disputed.
          context:
            [card.evidence?.criterion, card.evidence?.ruling].filter(Boolean).join('\n\n') ||
            card.context,
          blocksTask: false,
        }),
      });
      if (!res.ok) await failWith(res, 'Could not file the challenge');
      await postSpotCheck(id, 'disputed', fetcher);
      return { label: 'Challenge filed', undo: null };
    }
    default:
      return null;
  }
}

/**
 * The one card whose answer is a destination.
 *
 * Confirming a promotion **is** the sheet: the breakdown, the criteria and the
 * holdout note are what you have to read before freezing an oracle, and a Deck
 * button that froze it without showing them would be answering without looking —
 * the same defect bulk-approving designs was refused for. So this card's option
 * navigates, and it is the only one that does.
 */
export function navigationFor(card: DeckCard, option: string): string | null {
  if (card.kind === 'promote-pending' && option === DECK_OPTIONS.promotePending[0])
    return card.href;
  // The drift trigger's other answer: go re-run discovery in the brief
  // thread, rather than pretending a swipe can do that work in place.
  if (card.kind === 'stale-brief' && option === DECK_OPTIONS.staleBriefDrifted[0]) return card.href;
  return null;
}
