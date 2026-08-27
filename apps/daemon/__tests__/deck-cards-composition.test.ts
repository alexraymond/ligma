import type { AdoptionRun, DecisionItem, DesignSummary, PendingPromotion } from '@ligma/api';
/**
 * Pure composition tests for `apps/daemon/src/routes/deck/deck-cards.ts`, the
 * daemon-side port of `apps/web/src/lib/deck-cards.ts`'s `buildDeckCards`.
 *
 * No filesystem, no HTTP — these exercise the ported algorithm directly with
 * synthetic sources, which is the most direct way to prove the port kept the
 * three things the D4 contract row calls out by name: the six card kinds, the
 * `KIND_ORDER` they sort into, and the FNV-1a 1-in-10 spot-check sample.
 * `deck-route.test.ts` covers the daemon assembling those sources for real.
 */
import { describe, expect, it } from 'vitest';
import {
  type DeckCardKind,
  type DeckSources,
  SPOT_CHECK_RATE,
  buildDeckCards,
  hashId,
  isSpotChecked,
} from '../src/routes/deck/deck-cards';

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'dec_1',
    requestedBy: 'developer',
    taskId: null,
    question: 'Which way?',
    options: ['A', 'B'],
    context: '',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function design(overrides: Partial<DesignSummary> = {}): DesignSummary {
  return {
    id: 'des_1',
    projectId: 'proj_1',
    title: 'Landing hero',
    status: 'critiquing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    designSystem: null,
    versionCount: 1,
    files: [],
    critiqueScore: 82,
    pendingPinCount: 0,
    ...overrides,
  };
}

function pendingPromotion(overrides: Partial<PendingPromotion> = {}): PendingPromotion {
  return {
    projectId: 'proj_1',
    key: 'brief',
    source: 'brief',
    designId: null,
    taskCount: 3,
    criteriaCount: 5,
    holdoutNote: 'the builder will see 4 of 5',
    estimatedSpawns: 2,
    createdAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

function adoptionRun(overrides: Partial<AdoptionRun> = {}): AdoptionRun {
  return {
    id: 'arun_1',
    repoPath: '/repo',
    projectId: null,
    status: 'awaiting-review',
    shape: null,
    boot: null,
    bootRationale: 'inferred from package.json',
    proposedJourneys: [],
    confusionLog: [],
    envId: null,
    error: null,
    startedAt: '2026-01-04T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

const emptySources: DeckSources = {
  decisions: [],
  designs: [],
  pendingPromotions: [],
  staleBriefs: [],
  adoptionRuns: [],
  spotChecks: [],
};

describe('buildDeckCards — kind ordering', () => {
  it('sorts one of every kind into the pinned KIND_ORDER', () => {
    // A spot-checked run id — found by scanning, same technique seed-demo.ts
    // uses, so the fixture is honest about the 1-in-10 rate rather than
    // hard-coding a value that only works today.
    let n = 0;
    while (!isSpotChecked(`vrun_${n}`)) n++;
    const spotCheckedRunId = `vrun_${n}`;

    const cards = buildDeckCards({
      decisions: [decision({ id: 'dec_1' })],
      designs: [{ projectId: 'proj_1', projectName: 'Proj', design: design() }],
      pendingPromotions: [{ projectName: 'Proj', pending: pendingPromotion() }],
      staleBriefs: [
        {
          projectId: 'proj_1',
          projectName: 'Proj',
          prompt: 'a brief',
          staleFlaggedAt: '2026-01-05T00:00:00.000Z',
        },
      ],
      adoptionRuns: [adoptionRun()],
      spotChecks: [
        {
          runId: spotCheckedRunId,
          taskTitle: 'Hero',
          outcome: 'failed',
          criterion: 'CTA above the fold',
          criterionId: 'crit_1',
          ruling: 'not-met: below the fold on mobile',
          imageUrl: null,
          finishedAt: '2026-01-06T00:00:00.000Z',
        },
      ],
    });

    const kinds = cards.map((c) => c.kind);
    const expectedOrder: DeckCardKind[] = [
      'decision',
      'design-approval',
      'promote-pending',
      'stale-brief',
      'adoption-review',
      'verdict-spot-check',
    ];
    expect(kinds).toEqual(expectedOrder);
  });

  it('excludes a deferred decision and resolves its project through taskProjects', () => {
    const cards = buildDeckCards({
      ...emptySources,
      decisions: [
        decision({ id: 'dec_actionable', taskId: 'task_1' }),
        decision({ id: 'dec_deferred', deferUntil: '2099-01-01T00:00:00.000Z' }),
      ],
      taskProjects: new Map([['task_1', 'proj_1']]),
    });

    expect(cards.map((c) => c.id)).toEqual(['dec_actionable']);
    expect(cards[0].projectId).toBe('proj_1');
  });

  // L3 — the cap card's own `kind` used to stop at the route: the daemon wrote
  // it into decisions.json and the deck handed the UI an anonymous "Decision".
  it("carries a decision's kind onto the card, and nulls it for a plain question", () => {
    const cards = buildDeckCards({
      ...emptySources,
      decisions: [
        decision({ id: 'dec_cap', kind: 'verification-cap' }),
        decision({ id: 'dec_plain' }),
      ],
    });
    expect(cards.find((c) => c.id === 'dec_cap')?.decisionKind).toBe('verification-cap');
    expect(cards.find((c) => c.id === 'dec_plain')?.decisionKind).toBeNull();
  });

  it('adoption runs not awaiting review never become cards', () => {
    const cards = buildDeckCards({
      ...emptySources,
      adoptionRuns: [adoptionRun({ status: 'running' })],
    });
    expect(cards).toEqual([]);
  });
});

describe('isSpotChecked / hashId — FNV-1a 1-in-10 sample', () => {
  it('samples roughly 1 in 10 ids, deterministically', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `vrun_${i}`);
    const sampled = ids.filter((id) => isSpotChecked(id));
    // A hash-based sample of 500 ids at a 1-in-10 rate should land well within
    // 30–70; this is a sanity band, not a re-derivation of the formula.
    expect(sampled.length).toBeGreaterThan(30);
    expect(sampled.length).toBeLessThan(70);
    // Deterministic: the same id samples the same way every time.
    for (const id of sampled) expect(isSpotChecked(id)).toBe(true);
  });

  it('hashId(id) % SPOT_CHECK_RATE === 0 is exactly the sampling rule', () => {
    for (const id of ['vrun_1', 'vrun_2', 'vrun_3', 'a', 'dec_demo_1']) {
      expect(isSpotChecked(id)).toBe(hashId(id) % SPOT_CHECK_RATE === 0);
    }
  });

  it('a spot check whose run id does not sample is dropped from the queue', () => {
    let n = 0;
    while (isSpotChecked(`skip_${n}`)) n++;
    const unsampled = `skip_${n}`;

    const cards = buildDeckCards({
      ...emptySources,
      spotChecks: [
        {
          runId: unsampled,
          taskTitle: 'Hero',
          outcome: 'passed',
          criterion: null,
          criterionId: 'crit_1',
          ruling: 'met: fine',
          imageUrl: null,
          finishedAt: '2026-01-06T00:00:00.000Z',
        },
      ],
    });
    expect(cards).toEqual([]);
  });

  it('reviewedSpotChecks, when a caller has them, still filters (unused by the daemon route — that memory is browser-local)', () => {
    let n = 0;
    while (!isSpotChecked(`vrun_${n}`)) n++;
    const runId = `vrun_${n}`;

    const cards = buildDeckCards({
      ...emptySources,
      spotChecks: [
        {
          runId,
          taskTitle: 'Hero',
          outcome: 'failed',
          criterion: null,
          criterionId: 'c',
          ruling: 'r',
          imageUrl: null,
          finishedAt: '2026-01-06T00:00:00.000Z',
        },
      ],
      reviewedSpotChecks: new Set([runId]),
    });
    expect(cards).toEqual([]);
  });
});
