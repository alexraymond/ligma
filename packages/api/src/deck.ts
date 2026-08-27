/**
 * Decision deck logic — pure, shared by the deck API route and the deck UI.
 *
 * "The deck" is the escalation surface for pending decisions: one card at a
 * time, four dispositions (answer / dismiss / urgent / defer).
 *
 * Lives here rather than in the daemon because both sides genuinely run it: the
 * route applies dispositions, the UI orders the cards, and the two must agree on
 * what "actionable" means. No fs, no server imports, no dependencies — safe to
 * import from a client component.
 */

import type { DecisionItem, RunFailureCause } from './types';

/** How long an applied disposition stays undoable (server-enforced). */
export const UNDO_WINDOW_MS = 10_000;

/** A defer pushes the card out of the deck for a week. */
export const DEFER_MS = 7 * 24 * 60 * 60 * 1000;

/** At or above this many actionable decisions, offer the batch list instead. */
export const BATCH_THRESHOLD = 10;

/** The answer recorded when a decision is swiped away without a choice. */
export const DISMISS_ANSWER = 'Dismissed without action';

// ─── Card option strings ─────────────────────────────────────────────────────

/**
 * The exact button labels non-decision Deck cards offer.
 *
 * These are not decoration: a card's chosen option travels back to the daemon
 * as an exact-match display string, so producer and consumer have to agree
 * character for character. They used to be typed out in two `buildDeckCards`
 * implementations (daemon + web) that had already drifted (codebase audit W10),
 * which is exactly the failure mode a shared constant exists to prevent. The
 * daemon's `routes/deck/deck-cards.ts` is now the single implementation; these
 * are what both sides compare against.
 */
export const DECK_OPTIONS = {
  designApproval: ['Approve', 'Keep iterating'],
  promotePending: ['Open the sheet'],
  /** The drift trigger — the brief has simply not been touched in a long time. */
  staleBriefDrifted: ['Re-run discovery', 'Still true (snooze 90 days)'],
  /** The edit trigger — the brief changed after a contract compiled against it. */
  staleBriefEdited: ['Acknowledge — the change is cosmetic'],
  verdictSpotCheck: ['Looks right', 'The judge got this wrong'],
} as const satisfies Record<string, readonly string[]>;

// ─── Run-blocked card ────────────────────────────────────────────────────────

/**
 * The only two failure classes a `run-blocked` card is raised for.
 *
 * `env` = the product's environment could not be booted (the boot gate);
 * `backend` = the CLI we spawned exited badly. Both need a human to change
 * something. The other `RunFailureCause` values are calm and self-resolving —
 * a rate limit retries, a governor deferral resumes — and a card for those
 * would be noise the human cannot act on.
 */
export type RunBlockedCause = Extract<RunFailureCause, 'env' | 'backend'>;

/**
 * The fields the `run-blocked` Deck card carries on top of the common card
 * shape (process audit P13). Declared here because the daemon composes them and
 * the web renders them, and the two must not drift: `routes/deck/deck-cards.ts`
 * is the producer, `hooks/use-deck-sources.ts` the consumer.
 *
 * There is deliberately no answer route and no `options`: the card is a
 * statement, not a question. It leaves the queue on its own once a newer run
 * exists for the task or the task stops waiting to be built.
 */
export interface RunBlockedCardFields {
  /** The task the failed run was building. */
  taskId: string;
  /** That task's title, so the card reads without a second fetch. */
  taskTitle: string;
  /** The run's own structured cause — never sniffed out of `reason`. */
  causeKind: RunBlockedCause;
  /** What the run recorded as the failure, verbatim. */
  reason: string;
}

// ─── Verdict spot-check ──────────────────────────────────────────────────────

/**
 * The human's answer to a spot-check card, as the daemon stores it.
 *
 * `confirmed` = the first option ("Looks right"), `disputed` = the second. The
 * wire value is a stable token rather than the display string, so re-wording a
 * button never silently re-classifies the reviews already recorded.
 */
export type SpotCheckAnswer = 'confirmed' | 'disputed';

/** Body of `POST /api/deck/spot-check`. */
export interface SpotCheckReviewRequest {
  taskId: string | null;
  runId: string;
  answer: SpotCheckAnswer;
}

/** One recorded review. The store is a flat list of these, newest last. */
export interface SpotCheckReview extends SpotCheckReviewRequest {
  reviewedAt: string;
}

/** Map a spot-check card's chosen option string onto its stored answer. */
export function spotCheckAnswerFor(option: string): SpotCheckAnswer | null {
  if (option === DECK_OPTIONS.verdictSpotCheck[0]) return 'confirmed';
  if (option === DECK_OPTIONS.verdictSpotCheck[1]) return 'disputed';
  return null;
}

export type DeckAction = 'answer' | 'dismiss' | 'urgent' | 'defer';

/**
 * Pending and not sitting in the defer lane — i.e. this card belongs in the deck.
 * An unparseable deferUntil is treated as "no defer" so bad data can never hide
 * a decision forever.
 */
export function isActionable(d: DecisionItem, now: number = Date.now()): boolean {
  if (d.status !== 'pending') return false;
  return !isDeferred(d, now);
}

/** Pending but deferred to a future date — shown in the collapsed deferred group. */
export function isDeferred(d: DecisionItem, now: number = Date.now()): boolean {
  if (d.status !== 'pending' || !d.deferUntil) return false;
  const until = Date.parse(d.deferUntil);
  return Number.isFinite(until) && until > now;
}

/** Explicitly urgent (swiped up), as opposed to merely un-annotated. */
export function isUrgent(d: DecisionItem): boolean {
  return d.urgentAt != null;
}

/**
 * The deck query: actionable cards, urgent first (soonest-flagged first among
 * those), then blocking-before-non-blocking, then oldest first. createdAt is
 * never rewritten — urgency is an ordering key, not a timestamp edit.
 */
export function deckOrder(decisions: DecisionItem[], now: number = Date.now()): DecisionItem[] {
  return decisions
    .filter((d) => isActionable(d, now))
    .sort((a, b) => {
      if (isUrgent(a) !== isUrgent(b)) return isUrgent(a) ? -1 : 1;
      if (isUrgent(a) && isUrgent(b)) {
        const byUrgentAt = Date.parse(a.urgentAt!) - Date.parse(b.urgentAt!);
        if (byUrgentAt !== 0) return byUrgentAt;
      }
      if ((a.blocksTask === true) !== (b.blocksTask === true)) {
        return a.blocksTask === true ? -1 : 1;
      }
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
}

/** Deferred cards, soonest to resurface first. */
export function deferredOrder(decisions: DecisionItem[], now: number = Date.now()): DecisionItem[] {
  return decisions
    .filter((d) => isDeferred(d, now))
    .sort((a, b) => Date.parse(a.deferUntil!) - Date.parse(b.deferUntil!));
}

/**
 * A pending decision whose blocksTask is true halts its linked task — including
 * while it's sitting in the deferred lane. Deferring only hides a card from the
 * deck for a week; it must never make a still-gating decision invisible.
 */
export function isBlocking(d: DecisionItem): boolean {
  return d.status === 'pending' && d.blocksTask === true;
}

/**
 * Anything that should still count as "needs attention" for a badge: actionable
 * cards, plus any pending blocking card even if it's currently deferred.
 */
export function needsAttention(d: DecisionItem, now: number = Date.now()): boolean {
  return isActionable(d, now) || isBlocking(d);
}

/**
 * Apply a disposition. Pure: returns the new decision, never mutates the input.
 * Callers must check the decision is still pending first (a stale card in a
 * second tab must not re-answer something already resolved).
 */
export function applyDisposition(
  d: DecisionItem,
  action: DeckAction,
  answer: string,
  now: number = Date.now(),
): DecisionItem {
  const iso = new Date(now).toISOString();
  switch (action) {
    case 'answer':
      return { ...d, status: 'answered', answer, answeredAt: iso };
    case 'dismiss':
      return { ...d, status: 'answered', answer: DISMISS_ANSWER, answeredAt: iso };
    case 'urgent':
      // Stays pending; urgentAt fronts it in deckOrder. Deliberately does NOT
      // touch blocksTask — flagging a card for human attention must never
      // silently gate the agent's task (that's the opposite of the gesture,
      // and it would override the agent's own blocksTask:false report).
      return { ...d, urgentAt: iso };
    case 'defer':
      return {
        ...d,
        deferUntil: new Date(now + DEFER_MS).toISOString(),
        deferCount: (d.deferCount ?? 0) + 1,
      };
  }
}
