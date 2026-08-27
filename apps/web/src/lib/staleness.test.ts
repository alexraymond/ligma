import { describe, expect, it } from 'vitest';
import {
  STALE_THRESHOLD_MS,
  codeMovedSince,
  currentShaForProject,
  isStale,
  staleDecision,
  staleTip,
} from './staleness';

const NOW = new Date('2026-08-11T12:00:00.000Z').getTime();

describe('isStale', () => {
  it('is false with no timestamp — never invent staleness', () => {
    expect(isStale(null, NOW)).toBe(false);
    expect(isStale(undefined, NOW)).toBe(false);
  });

  it('is false for an unparsable timestamp rather than throwing', () => {
    expect(isStale('not-a-date', NOW)).toBe(false);
  });

  it('is false just under the threshold', () => {
    const recent = new Date(NOW - (STALE_THRESHOLD_MS - 1000)).toISOString();
    expect(isStale(recent, NOW)).toBe(false);
  });

  it('is true once past the threshold', () => {
    const old = new Date(NOW - (STALE_THRESHOLD_MS + 1000)).toISOString();
    expect(isStale(old, NOW)).toBe(true);
  });
});

describe('staleTip', () => {
  it("carries the actual timestamp, not just the word 'stale'", () => {
    const tip = staleTip('2026-08-01T00:00:00.000Z');
    expect(tip).toContain('Verified');
    expect(tip.length).toBeGreaterThan('stale'.length);
  });
});

describe('codeMovedSince', () => {
  it('is true when the SHAs differ', () => {
    expect(codeMovedSince('abc123', 'def456')).toBe(true);
  });

  it('is false when the SHAs match', () => {
    expect(codeMovedSince('abc123', 'abc123')).toBe(false);
  });

  it('is null (unknowable) when the verdict carries no SHA', () => {
    expect(codeMovedSince(null, 'def456')).toBeNull();
    expect(codeMovedSince(undefined, 'def456')).toBeNull();
  });

  it("is null (unknowable) when the current SHA can't be read", () => {
    expect(codeMovedSince('abc123', null)).toBeNull();
    expect(codeMovedSince('abc123', undefined)).toBeNull();
  });

  it('is null when both sides are missing — never invents a comparison', () => {
    expect(codeMovedSince(null, null)).toBeNull();
  });
});

describe('staleDecision', () => {
  const recent = new Date(NOW - (STALE_THRESHOLD_MS - 1000)).toISOString();
  const old = new Date(NOW - (STALE_THRESHOLD_MS + 1000)).toISOString();

  it('a SHA mismatch is stale — even a fresh verdict, since the timer is replaced', () => {
    const d = staleDecision({ finishedAt: recent, verdictSha: 'abc', currentSha: 'def' }, NOW);
    expect(d).toEqual({ stale: true, reason: 'moved' });
  });

  it('matching SHAs are not stale — even an old verdict, since the timer is replaced', () => {
    const d = staleDecision({ finishedAt: old, verdictSha: 'abc', currentSha: 'abc' }, NOW);
    expect(d).toEqual({ stale: false, reason: 'moved' });
  });

  it('falls back to the age timer once a SHA is missing on either side', () => {
    expect(staleDecision({ finishedAt: old, verdictSha: null, currentSha: 'abc' }, NOW)).toEqual({
      stale: true,
      reason: 'age',
    });
    expect(staleDecision({ finishedAt: recent, verdictSha: 'abc', currentSha: null }, NOW)).toEqual(
      {
        stale: false,
        reason: 'fresh',
      },
    );
  });

  it('no SHA on either side and no timestamp — fresh, never invented', () => {
    expect(staleDecision({ finishedAt: null, verdictSha: null, currentSha: null }, NOW)).toEqual({
      stale: false,
      reason: 'fresh',
    });
  });
});

describe('currentShaForProject', () => {
  const runs = [
    { projectId: 'proj_a', commitSha: 'sha-a-old', startedAt: '2026-08-01T00:00:00.000Z' },
    { projectId: 'proj_a', commitSha: 'sha-a-new', startedAt: '2026-08-05T00:00:00.000Z' },
    { projectId: 'proj_b', commitSha: 'sha-b', startedAt: '2026-08-06T00:00:00.000Z' },
  ];

  it("picks the newest run's SHA for the project, not just the last in the array", () => {
    expect(currentShaForProject(runs, 'proj_a')).toBe('sha-a-new');
  });

  it('is null when no run exists for the project', () => {
    expect(currentShaForProject(runs, 'proj_c')).toBeNull();
  });

  it('is null when no projectId is given', () => {
    expect(currentShaForProject(runs, null)).toBeNull();
  });

  it('is null when the latest run has no commitSha (repo-less)', () => {
    expect(
      currentShaForProject(
        [{ projectId: 'proj_x', commitSha: null, startedAt: '2026-08-01T00:00:00.000Z' }],
        'proj_x',
      ),
    ).toBeNull();
  });
});
