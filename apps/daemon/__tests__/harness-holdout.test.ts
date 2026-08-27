/**
 * Holdout split variance (fix #1).
 *
 * The bug: holdoutScore() hashed only the positional id ("crit_1"…), which is a
 * constant, so crit_1 was the holdout for EVERY 2-criterion task in the repo.
 * Seeing one contract told you the hidden set of all the others.
 *
 * These tests prove the split now varies per (scope, criterion text), still
 * recompiles identically, and keeps the ≥1-visible / ≥1-holdout guarantees.
 */

import { describe, expect, it } from 'vitest';
import { assignHoldouts, buildDeterministicCriteria } from '../src/harness/compile-contract';

/** 24 synthetic task scopes, each with its own criterion wording. */
const SCOPES = Array.from(
  { length: 24 },
  (_, i) => `task_17600000000${String(i).padStart(2, '0')}`,
);

function criteriaFor(scope: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${scope}: user can do thing ${i + 1}`);
}

function holdoutPositions(scope: string, n: number): number[] {
  return buildDeterministicCriteria(criteriaFor(scope, n), scope).flatMap((c, i) =>
    c.holdout ? [i + 1] : [],
  );
}

describe('holdout split varies per contract scope', () => {
  it('does not hold out the same positions for every scope (2, 3 and 4 criteria)', () => {
    for (const n of [2, 3, 4]) {
      const patterns = new Set(SCOPES.map((s) => holdoutPositions(s, n).join(',')));
      // The old implementation produced exactly ONE pattern repo-wide.
      expect(patterns.size, `n=${n} produced ${[...patterns].join(' | ')}`).toBeGreaterThan(1);
    }
  });

  it('no single position is the holdout in every scope', () => {
    for (const n of [2, 3, 4]) {
      for (let pos = 1; pos <= n; pos++) {
        const always = SCOPES.every((s) => holdoutPositions(s, n).includes(pos));
        expect(always, `n=${n}, position ${pos} was the holdout in every scope`).toBe(false);
      }
    }
  });

  it('holds out roughly 30% of criteria in aggregate', () => {
    let total = 0;
    let held = 0;
    for (const scope of SCOPES) {
      for (let n = 4; n <= 12; n++) {
        const out = buildDeterministicCriteria(criteriaFor(scope, n), scope);
        total += out.length;
        held += out.filter((c) => c.holdout).length;
      }
    }
    const rate = held / total;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.42);
  });

  it('two scopes with identical criterion text still split differently', () => {
    const texts = [
      'user can log in',
      'user can log out',
      'session survives reload',
      'errors are shown',
    ];
    const patterns = new Set(
      SCOPES.map((s) =>
        buildDeterministicCriteria(texts, s)
          .map((c) => (c.holdout ? 'H' : 'v'))
          .join(''),
      ),
    );
    expect(patterns.size).toBeGreaterThan(1);
  });

  it('is stable across recompiles of the same scope', () => {
    for (const scope of SCOPES) {
      const a = buildDeterministicCriteria(criteriaFor(scope, 6), scope).map((c) => c.holdout);
      const b = buildDeterministicCriteria(criteriaFor(scope, 6), scope).map((c) => c.holdout);
      expect(b).toEqual(a);
    }
  });

  it('keeps the ≥1 visible and ≥1 holdout guarantees for every scope', () => {
    for (const scope of SCOPES) {
      for (let n = 1; n <= 10; n++) {
        const out = buildDeterministicCriteria(criteriaFor(scope, n), scope);
        expect(
          out.filter((c) => !c.holdout).length,
          `${scope} n=${n} visible`,
        ).toBeGreaterThanOrEqual(1);
        if (n >= 2) {
          expect(
            out.filter((c) => c.holdout).length,
            `${scope} n=${n} holdout`,
          ).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('still hides every invariant, whatever the scope', () => {
    for (const scope of SCOPES) {
      const out = assignHoldouts(
        [
          { id: 'crit_1', kind: 'criterion', text: 'a', holdout: false, provenance: null },
          { id: 'crit_2', kind: 'criterion', text: 'b', holdout: false, provenance: null },
          {
            id: 'inv_1',
            kind: 'invariant',
            text: 'never loses data',
            holdout: false,
            provenance: null,
          },
        ],
        scope,
      );
      expect(out.find((c) => c.id === 'inv_1')?.holdout).toBe(true);
    }
  });
});
