'use client';

import { useDecisions } from '@/hooks/use-data';
import { type DeckCard, needsYouByProject, useDeckCards } from '@/hooks/use-deck-sources';
import type { DecisionItem } from '@ligma/api';
import { type ReactNode, createContext, useCallback, useContext, useMemo } from 'react';

/**
 * The attention budget, built once (UX spec §8.7).
 *
 * The rail's Deck badge and the Deck page's own header are two views of one
 * number: "how much is waiting on me?". They used to compute it separately —
 * the badge from the daemon's decisions-only `/api/sidebar` count, the header
 * from the widened queue — so the rail said 12 while the page said 15, and the
 * three cards that only exist in the widened queue were invisible from
 * anywhere else in the app.
 *
 * The composition itself now lives server-side (`GET /api/deck`, apps/daemon
 * /src/routes/deck/route.ts, the ported `buildDeckCards`) — this provider's
 * job shrank to fetching that one array. Spot-check answers are server-side
 * memory too now (seam S2, `POST /api/deck/spot-check`), so the route already
 * excludes reviewed ones; this provider no longer re-filters anything. Both
 * consumers still read the one resulting array. They cannot disagree, because
 * there is nothing left to disagree about.
 */
interface DeckQueueValue {
  /** Every actionable Deck card: decisions, approvals, stale briefs, spot-checks. */
  cards: DeckCard[];
  /**
   * The same queue grouped by project — Home's per-project needs-you count.
   * A grouping rather than a second computation, so a card can never be counted
   * on a portfolio card and missing from the rail badge.
   */
  needsYou: ReadonlyMap<string, number>;
  decisions: DecisionItem[];
  loading: boolean;
  error: string | null;
  /** Refetch everything the queue is built from. */
  refetch: () => Promise<void>;
  /** Decisions only — the fast path for answering and taking back. */
  refetchDecisions: () => Promise<void>;
  updateDecision: (id: string, patch: Partial<DecisionItem>) => Promise<unknown>;
}

const DeckQueueContext = createContext<DeckQueueValue | null>(null);

/** Stable identity for "no cards yet" so a null `rawCards` doesn't force a new array — and everything memoized on it — every render. */
const EMPTY_CARDS: readonly DeckCard[] = [];

export function DeckQueueProvider({ children }: { children: ReactNode }) {
  const {
    decisions,
    loading,
    error,
    update: updateDecision,
    refetch: refetchDecisions,
  } = useDecisions();
  const { cards: rawCards, error: cardsError, refetch: refetchCards } = useDeckCards();

  // `rawCards` is `null` while unloaded or after a failed fetch — that is
  // reported through `error` below, not silently rendered as an empty queue.
  // GET /api/deck already excludes spot-checks the human answered (seam S2),
  // so there is nothing left to re-filter here.
  const cards = (rawCards ?? EMPTY_CARDS) as DeckCard[];
  const needsYou = useMemo(() => needsYouByProject(cards), [cards]);

  const refetch = useCallback(async () => {
    await Promise.all([refetchDecisions(), refetchCards()]);
  }, [refetchDecisions, refetchCards]);

  // Decisions and the wider deck queue are fetched separately; either one
  // failing is a reason the queue can't be trusted as "empty".
  const combinedError = error ?? cardsError;

  const value = useMemo(
    () => ({
      cards,
      needsYou,
      decisions,
      loading,
      error: combinedError,
      refetch,
      refetchDecisions,
      updateDecision,
    }),
    [cards, needsYou, decisions, loading, combinedError, refetch, refetchDecisions, updateDecision],
  );

  return <DeckQueueContext.Provider value={value}>{children}</DeckQueueContext.Provider>;
}

export function useDeckQueue(): DeckQueueValue {
  const ctx = useContext(DeckQueueContext);
  if (!ctx) {
    throw new Error('useDeckQueue must be used within DeckQueueProvider');
  }
  return ctx;
}
