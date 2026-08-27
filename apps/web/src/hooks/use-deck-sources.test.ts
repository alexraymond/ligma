/**
 * `deckCardLabel` and `needsYouByProject` — the presentation helpers that
 * survive now that `buildDeckCards` moved server-side (codebase audit W10,
 * seam S3). The card-shaping behavior itself (href rules, decision-kind
 * carry-through) is covered daemon-side now:
 * apps/daemon/src/routes/deck/deck-cards.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  type DeckCard,
  RUN_BLOCKED_CAUSE_LABELS,
  deckCardLabel,
  needsYouByProject,
} from './use-deck-sources';

describe('deckCardLabel', () => {
  it('labels a cap card by what raised it, and everything else by its card kind', () => {
    expect(deckCardLabel({ kind: 'decision', decisionKind: 'verification-cap' })).toBe(
      'Attempts exhausted',
    );
    expect(deckCardLabel({ kind: 'decision', decisionKind: null })).toBe('Decision');
    expect(deckCardLabel({ kind: 'verdict-spot-check' })).toBe('Spot-check');
    expect(deckCardLabel({ kind: 'run-blocked' })).toBe('Run blocked');
    // An unrecognised kind falls back rather than rendering "undefined".
    expect(deckCardLabel({ kind: 'decision', decisionKind: 'something-new' })).toBe('Decision');
  });
});

describe('RUN_BLOCKED_CAUSE_LABELS', () => {
  it('names both causes a run-blocked card can carry', () => {
    expect(RUN_BLOCKED_CAUSE_LABELS.env).toBe('Environment');
    expect(RUN_BLOCKED_CAUSE_LABELS.backend).toBe('Backend');
  });
});

function card(overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    id: 'dec_1',
    kind: 'decision',
    title: 'Which way?',
    context: '',
    options: [],
    evidence: null,
    href: '/deck',
    opensSheet: false,
    decision: null,
    projectId: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('needsYouByProject', () => {
  it('groups cards under their project', () => {
    const counts = needsYouByProject([
      card({ id: 'a', projectId: 'p1' }),
      card({ id: 'b', projectId: 'p1' }),
      card({ id: 'c', projectId: 'p2' }),
    ]);
    expect(counts.get('p1')).toBe(2);
    expect(counts.get('p2')).toBe(1);
  });

  it('counts project-less cards under the workspace bucket rather than dropping them', () => {
    const counts = needsYouByProject([card({ id: 'a', projectId: null })]);
    expect([...counts.values()]).toEqual([1]);
    expect(counts.has('p1')).toBe(false);
  });
});
