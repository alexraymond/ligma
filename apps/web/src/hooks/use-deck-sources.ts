'use client';

import { apiFetch } from '@/lib/api-client';
import { useCollection } from '@/providers/collections-provider';
import type { DecisionItem, RunBlockedCause } from '@ligma/api';

/**
 * The composed Deck queue, fetched from the daemon's one source of truth
 * (`GET /api/deck`, apps/daemon/src/routes/deck/route.ts) instead of being
 * assembled here out of a scatter of per-project fetches (designs, brief,
 * promote/preview, adopt runs, verification-runs).
 *
 * That fan-out — and the `buildDeckCards` fold that used to run on its result
 * — moved server-side (D4 seam gap #1, see drill-d4.ts's header; codebase
 * audit W10, seam S3: the daemon's `routes/deck/deck-cards.ts` is now the
 * single implementation). This module is the wire type (matching what that
 * route actually returns) plus the presentation helpers every real card is
 * still typed and labeled with — the fold itself is gone from the web app.
 *
 * `cards` is `null` until the first fetch resolves, and stays at its last
 * known value if a later fetch fails — a failed read is reported via `error`,
 * not collapsed into `cards: []`. "Nothing is waiting on you" and "couldn't
 * load the queue" are different claims; the caller decides which to render.
 */

export type DeckCardKind =
  | 'decision'
  | 'design-approval'
  | 'promote-pending'
  | 'stale-brief'
  | 'adoption-review'
  | 'verdict-spot-check'
  | 'run-blocked';

/** Inline evidence — the reason the card does not need a page behind it. */
export interface DeckCardEvidence {
  /** Absolute or app-relative image URL, rendered inline. */
  imageUrl?: string;
  /** The criterion or claim under review, verbatim. */
  criterion?: string;
  /**
   * A judgement *about* that claim — the judge's call and its reasoning.
   *
   * Separate from `criterion` on purpose: showing only the reasoning ("not-met:
   * the CTA sits 60px below the fold") tells the human what someone concluded
   * without ever telling them what was being asked, which is the one thing a
   * spot-check needs.
   */
  ruling?: string;
  /** Short facts rendered as a definition list. */
  facts?: Array<{ label: string; value: string }>;
}

export interface DeckCard {
  id: string;
  kind: DeckCardKind;
  title: string;
  /** One line of context under the title. */
  context: string;
  /** The answers offered. Empty means the card's only action is its link. */
  options: string[];
  evidence: DeckCardEvidence | null;
  /** "what made this" — always present, so no card is a dead end (§8.3). */
  href: string;
  /** True when answering genuinely needs a form this card cannot carry. */
  opensSheet: boolean;
  /** Only set for `kind === "decision"`; the deck's existing PATCH path. */
  decision: DecisionItem | null;
  /**
   * The decision's own `kind` when it has one ("verification-cap"), so a card
   * raised by machinery keeps its identity instead of flattening into the
   * generic "Decision" label (L3). Absent for every other card kind — optional
   * rather than `null`-everywhere so five unrelated card literals stay untouched.
   */
  decisionKind?: string | null;
  /**
   * The project this card is about, so "what needs me?" can be answered per
   * project on Home as well as workspace-wide here (§5 F3). Null for cards that
   * belong to the workspace rather than to one project — an unlinked decision,
   * an adoption run that has not become a project yet.
   */
  projectId: string | null;
  createdAt: string;
  /**
   * Only set for `kind === "run-blocked"` — the daemon's `RunBlockedCardFields`
   * (`@ligma/api`) flattened onto the common shape, same pattern as
   * `decisionKind`. The task the failed run was building, and why it never
   * got off the ground. See `apps/daemon/src/routes/deck/deck-cards.ts`.
   */
  taskId?: string;
  taskTitle?: string;
  causeKind?: RunBlockedCause;
  /** What the run recorded as the failure, verbatim — never re-derived from `context`. */
  reason?: string;
}

// ─── Presentation ────────────────────────────────────────────────────────────

/** What the card is, said plainly, so a widened queue stays readable at a glance. */
export const DECK_KIND_LABELS: Record<DeckCardKind, string> = {
  decision: 'Decision',
  'design-approval': 'Design approval',
  'promote-pending': 'Contract promotion',
  'stale-brief': 'Stale brief',
  'adoption-review': 'Adoption review',
  'verdict-spot-check': 'Spot-check',
  'run-blocked': 'Run blocked',
};

/**
 * A `run-blocked` card's `causeKind`, said plainly for a badge. Both values
 * are harness trouble, not a verdict on the work (the "error ≠ failed" rule
 * `failure/classify.ts` applies to generation failures) — the task waiting on
 * this run didn't fail; the ground it needed to run on wasn't there.
 */
export const RUN_BLOCKED_CAUSE_LABELS: Record<RunBlockedCause, string> = {
  env: 'Environment',
  backend: 'Backend',
};

/**
 * Decisions that are not plain questions, by the `kind` their raiser stamped on
 * them. "Attempts exhausted" is a very different thing to answer than "should
 * the button be blue", and the card used to say only "Decision" for both.
 */
export const DECISION_KIND_LABELS: Record<string, string> = {
  'verification-cap': 'Attempts exhausted',
};

/** The most specific label this card has. */
export function deckCardLabel(card: Pick<DeckCard, 'kind' | 'decisionKind'>): string {
  return (
    (card.decisionKind ? DECISION_KIND_LABELS[card.decisionKind] : undefined) ??
    DECK_KIND_LABELS[card.kind]
  );
}

/** Cards with no project — an unlinked decision, an adoption run with no project yet — count here. */
const GENERAL_BUCKET = '__workspace__';

/**
 * "What needs me?" per project (§5 F3's needs-you count).
 *
 * The queue is already built once for the whole workspace, so the per-project
 * number is a grouping of it rather than a second computation that could
 * disagree with the rail badge. Cards that belong to no project count under
 * `GENERAL_BUCKET` so they are never silently dropped from the total.
 */
export function needsYouByProject(cards: readonly DeckCard[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = card.projectId ?? GENERAL_BUCKET;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ─── Fetching ────────────────────────────────────────────────────────────────

interface DeckResponse {
  cards: DeckCard[];
  meta: { total: number; byKind: Record<string, number> };
}

export const DECK_KEY = '/api/deck';
const POLL_INTERVAL = 10_000; // matches decisions — the queue is one number with the rail badge

async function fetchDeck(): Promise<DeckCard[]> {
  const res = await apiFetch(DECK_KEY);
  if (!res.ok) throw new Error(`Failed to load the deck queue (${res.status})`);
  const body = (await res.json()) as DeckResponse;
  return body.cards ?? [];
}

/**
 * Polled rather than fetched once (F8): Home's per-project "needs you" badges
 * and the rail badge read this, and a decision raised while the user sits on
 * Home used to be invisible there until a reload. Answering a decision also
 * re-reads it — `/api/deck` is declared as derived from `/api/decisions` in the
 * collection store, so list-mode answers no longer leave the badge stale (F5).
 */
export function useDeckCards(): {
  cards: DeckCard[] | null;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const { data, error, refetch } = useCollection<DeckCard[]>(DECK_KEY, fetchDeck, POLL_INTERVAL);
  return { cards: data, error, refetch };
}
