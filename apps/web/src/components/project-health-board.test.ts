import type { CriterionHealthRow } from '@ligma/api';
/**
 * `ProjectHealthBoard`'s pure derivation logic: the summary roll-up (walkthrough
 * M9 — "9 met · 1 not met · 6 unknown") and the short-label/expand split for
 * long criterion text. No rendering — same convention as `terminal-panel.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  isLongCriterion,
  projectHealthKey,
  shortLabel,
  summarizeHealth,
} from './project-health-board';

const NOW = new Date('2026-08-13T12:00:00Z').getTime();
const RECENT = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();

function row(overrides: Partial<CriterionHealthRow>): CriterionHealthRow {
  return {
    scope: 'task_1',
    contractId: 'c1',
    title: 'Task 1',
    taskId: 'task_1',
    journeyId: null,
    criterionId: 'crit_1',
    text: 'Some criterion',
    kind: 'criterion',
    holdout: false,
    status: 'unknown',
    reasoning: '',
    runId: null,
    verifiedAt: null,
    ...overrides,
  };
}

describe('summarizeHealth', () => {
  it("buckets met / not-met / unknown+unverified into the review's three-word roll-up", () => {
    const rows = [
      row({ criterionId: '1', status: 'met', verifiedAt: RECENT }),
      row({ criterionId: '2', status: 'not-met' }),
      row({ criterionId: '3', status: 'unknown' }),
      row({ criterionId: '4', status: 'unverified' }),
    ];
    expect(summarizeHealth(rows, NOW)).toEqual({
      met: 1,
      notMet: 1,
      unknown: 2,
      stale: 0,
      holdout: 0,
      total: 4,
    });
  });

  it('counts a met-but-stale row as met, and separately as stale', () => {
    const rows = [row({ status: 'met', verifiedAt: STALE })];
    expect(summarizeHealth(rows, NOW)).toMatchObject({ met: 1, stale: 1 });
  });

  it('counts held-out rows independently of their verdict status', () => {
    const rows = [
      row({ status: 'met', verifiedAt: RECENT, holdout: true }),
      row({ status: 'not-met' }),
    ];
    expect(summarizeHealth(rows, NOW).holdout).toBe(1);
  });

  it('is all zeros for an empty board', () => {
    expect(summarizeHealth([], NOW)).toEqual({
      met: 0,
      notMet: 0,
      unknown: 0,
      stale: 0,
      holdout: 0,
      total: 0,
    });
  });
});

describe('isLongCriterion / shortLabel', () => {
  it('leaves short text alone', () => {
    expect(isLongCriterion('Short criterion')).toBe(false);
    expect(shortLabel('Short criterion')).toBe('Short criterion');
  });

  it('truncates long text with an ellipsis, never exceeding the max', () => {
    const long = 'A'.repeat(200);
    expect(isLongCriterion(long)).toBe(true);
    const label = shortLabel(long);
    expect(label.length).toBeLessThan(long.length);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('projectHealthKey', () => {
  it('matches the daemon route so invalidate() and useCollection agree on the same key', () => {
    expect(projectHealthKey('proj_1')).toBe('/api/projects/proj_1/health');
  });
});
