import type { AdoptionRun, DecisionItem, DesignSummary, PendingPromotion } from '@ligma/api';
import { DECK_OPTIONS } from '@ligma/api';
/**
 * `buildDeckCards` — the single implementation (seam S3).
 *
 * `apps/web/src/lib/deck-cards.ts` and its suite were the drifted duplicate and
 * are gone; this file is now the only place the composition is pinned. It
 * therefore covers what that suite covered (decision href, decision kind) plus
 * the behavior neither side ever had a test for: how a spot-check card shapes
 * its content, what the combined attention budget counts, and that the demo
 * seed still produces the Deck it is supposed to.
 *
 * `deckCardLabel` is NOT tested here — it is presentation and still lives (and
 * is still covered) in `apps/web/src/hooks/use-deck-sources.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  type DeckSources,
  type SpotCheckSource,
  buildDeckCards,
  isSpotChecked,
} from './deck-cards';

function sources(overrides: Partial<DeckSources> = {}): DeckSources {
  return {
    decisions: [],
    designs: [],
    staleBriefs: [],
    adoptionRuns: [],
    spotChecks: [],
    ...overrides,
  };
}

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'dec_1',
    requestedBy: 'developer',
    taskId: 't1',
    question: 'Which approach?',
    options: ['A', 'B'],
    context: '',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * `run_1` hashes into the 1-in-10 sample and `run_0` does not — asserted below
 * rather than assumed, so a change to `hashId` fails loudly here instead of
 * silently emptying every spot-check case in this file.
 */
const SAMPLED = 'run_1';
const NOT_SAMPLED = 'run_0';

function spotCheck(overrides: Partial<SpotCheckSource> = {}): SpotCheckSource {
  return {
    runId: SAMPLED,
    taskTitle: 'Scaffold the URL shortener API',
    outcome: 'failed',
    criterion: 'A POST to /shorten returns a 201 with the short code',
    criterionId: 'crit_3',
    ruling: 'not-met: the endpoint returned 500 on every attempt',
    imageUrl: null,
    projectId: 'proj_1',
    finishedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDeckCards — decision card href', () => {
  it('points a task-linked decision at the portfolio Tasks view, not /board', () => {
    const [card] = buildDeckCards(sources({ decisions: [decision({ taskId: 't1' })] }));
    expect(card.href).toBe('/projects?view=tasks&task=t1');
  });

  it('falls back to /deck for a decision with no task', () => {
    const [card] = buildDeckCards(sources({ decisions: [decision({ taskId: null })] }));
    expect(card.href).toBe('/deck');
  });
});

/**
 * L3 — a verification-cap card was written with `kind: "verification-cap"` and
 * arrived in the UI as an anonymous "Decision", so the human had no way to tell
 * "the harness gave up after 3 attempts" from "should the button be blue".
 */
describe('buildDeckCards — decision kind', () => {
  it("carries the decision's kind onto the card", () => {
    const [card] = buildDeckCards(sources({ decisions: [decision({ kind: 'verification-cap' })] }));
    expect(card.decisionKind).toBe('verification-cap');
  });

  it('is null for an ordinary decision', () => {
    const [card] = buildDeckCards(sources({ decisions: [decision()] }));
    expect(card.decisionKind).toBeNull();
  });

  it("resolves the card's project from the task index", () => {
    const [card] = buildDeckCards(
      sources({
        decisions: [decision({ taskId: 't1' })],
        taskProjects: new Map([['t1', 'proj_9']]),
      }),
    );
    expect(card.projectId).toBe('proj_9');
  });
});

/**
 * The spot-check card asks a human to audit the judge, so what it puts in front
 * of them IS the feature: a task they recognise, the criterion in dispute, and
 * the judge's ruling as a separate claim they can disagree with.
 */
describe('buildDeckCards — verdict spot-check content', () => {
  it('pins the sample fixtures this suite depends on', () => {
    expect(isSpotChecked(SAMPLED)).toBe(true);
    expect(isSpotChecked(NOT_SAMPLED)).toBe(false);
  });

  it('titles the card with the task, never the run id', () => {
    const [card] = buildDeckCards(sources({ spotChecks: [spotCheck()] }));

    expect(card.title).toBe(
      'Spot-check: did the judge get "Scaffold the URL shortener API" right?',
    );
    expect(card.title).not.toContain(SAMPLED);
  });

  it("keeps the criterion and the judge's ruling as separate evidence fields", () => {
    const [card] = buildDeckCards(sources({ spotChecks: [spotCheck()] }));

    // What was asked...
    expect(card.evidence?.criterion).toBe('A POST to /shorten returns a 201 with the short code');
    // ...kept apart from what the judge concluded about it. Collapsing the two
    // would leave the human auditing the judge's own summary of the question.
    expect(card.evidence?.ruling).toBe('not-met: the endpoint returned 500 on every attempt');
    expect(card.evidence?.criterion).not.toContain('not-met');
  });

  it('names the unreadable criterion by id rather than rendering an empty box', () => {
    const [card] = buildDeckCards(sources({ spotChecks: [spotCheck({ criterion: null })] }));

    expect(card.evidence?.criterion).toContain('crit_3');
    expect(card.evidence?.ruling).toBe('not-met: the endpoint returned 500 on every attempt');
  });

  it('attaches a screenshot only when there is one', () => {
    const [withShot] = buildDeckCards(
      sources({ spotChecks: [spotCheck({ imageUrl: '/api/x.png' })] }),
    );
    expect(withShot.evidence?.imageUrl).toBe('/api/x.png');

    const [without] = buildDeckCards(sources({ spotChecks: [spotCheck()] }));
    expect(without.evidence).not.toHaveProperty('imageUrl');
  });

  it('offers the shared option strings — they travel back as exact-match text', () => {
    const [card] = buildDeckCards(sources({ spotChecks: [spotCheck()] }));

    expect(card.options).toEqual([...DECK_OPTIONS.verdictSpotCheck]);
    expect(card.href).toBe(`/verification/${SAMPLED}`);
    expect(card.createdAt).toBe('2026-08-20T00:00:00.000Z');
    expect(card.projectId).toBe('proj_1');
  });

  it('drops a run outside the 1-in-10 sample even if the caller passes it', () => {
    expect(
      buildDeckCards(sources({ spotChecks: [spotCheck({ runId: NOT_SAMPLED })] })),
    ).toHaveLength(0);
  });

  it('drops a run the human already reviewed (P9 — the answer is server-side now)', () => {
    const cards = buildDeckCards(
      sources({ spotChecks: [spotCheck()], reviewedSpotChecks: new Set([SAMPLED]) }),
    );
    expect(cards).toHaveLength(0);
  });
});

/**
 * The attention budget: the rail badge and the Deck header agree only because
 * one function produces one list. A kind that stops contributing — or starts
 * contributing twice — is a miscount nobody notices until the badge lies.
 */
describe('buildDeckCards — combined attention budget', () => {
  const design: DesignSummary = {
    id: 'des_1',
    projectId: 'proj_1',
    title: 'Landing page',
    status: 'critiquing',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    designSystem: null,
    versionCount: 3,
    files: [],
    critiqueScore: 72,
    pendingPinCount: 1,
  };

  const pending: PendingPromotion = {
    projectId: 'proj_1',
    key: 'brief',
    source: 'brief',
    designId: null,
    taskCount: 2,
    criteriaCount: 7,
    holdoutNote: 'the builder will see 5 of 7',
    estimatedSpawns: 12,
    createdAt: '2026-08-03T00:00:00.000Z',
  };

  const adoption: AdoptionRun = {
    id: 'arun_1',
    repoPath: '/repos/thing',
    projectId: 'proj_2',
    status: 'awaiting-review',
    shape: 'headless',
    boot: null,
    bootRationale: 'package.json declares a start script',
    proposedJourneys: [],
    confusionLog: [],
    envId: null,
    error: null,
    startedAt: '2026-08-04T00:00:00.000Z',
    finishedAt: null,
  };

  const all = (): DeckSources =>
    sources({
      decisions: [decision()],
      designs: [{ projectId: 'proj_1', projectName: 'Thing', design, previewUrl: null }],
      pendingPromotions: [{ projectName: 'Thing', pending }],
      staleBriefs: [
        {
          projectId: 'proj_1',
          projectName: 'Thing',
          prompt: 'Build a URL shortener',
          staleFlaggedAt: '2026-08-05T00:00:00.000Z',
        },
      ],
      adoptionRuns: [adoption],
      spotChecks: [spotCheck()],
    });

  it('counts every card kind exactly once', () => {
    const cards = buildDeckCards(all());

    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.kind)).toEqual([
      'decision',
      'design-approval',
      'promote-pending',
      'stale-brief',
      'adoption-review',
      'verdict-spot-check',
    ]);
    // Ids are what a client dedupes and keys on — a collision silently merges
    // two things that need two answers.
    expect(new Set(cards.map((c) => c.id)).size).toBe(6);
  });

  it('counts only what is actually waiting on the human', () => {
    const cards = buildDeckCards(
      sources({
        // Answered: resolved, not actionable.
        decisions: [decision({ status: 'answered', answer: 'A' })],
        // Already applied.
        adoptionRuns: [{ ...adoption, status: 'applied' }],
        // Outside the sample.
        spotChecks: [spotCheck({ runId: NOT_SAMPLED })],
      }),
    );

    expect(cards).toHaveLength(0);
  });

  it("trusts the caller on designs — the `critiquing` filter is route.ts's job", () => {
    // Documenting the seam, not endorsing it: `designs` arrives pre-filtered
    // (route.ts keeps only `status === "critiquing"`), so a drafting design
    // handed in here still becomes a card. If that filter ever moves into this
    // function, this expectation is the one that has to change.
    const cards = buildDeckCards(
      sources({
        designs: [
          {
            projectId: 'proj_1',
            projectName: 'Thing',
            design: { ...design, status: 'drafting' },
            previewUrl: null,
          },
        ],
      }),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('design-approval');
  });

  it('orders by kind, then oldest-waiting first within a kind', () => {
    const cards = buildDeckCards(
      sources({
        adoptionRuns: [
          { ...adoption, id: 'arun_new', startedAt: '2026-08-09T00:00:00.000Z' },
          { ...adoption, id: 'arun_old', startedAt: '2026-08-01T00:00:00.000Z' },
        ],
      }),
    );

    expect(cards.map((c) => c.id)).toEqual(['adoption:arun_old', 'adoption:arun_new']);
  });

  it('returns an empty deck for an empty workspace rather than throwing', () => {
    expect(buildDeckCards(sources())).toEqual([]);
  });
});

/**
 * Demo-seed regression. `POST /api/seed-demo` is what a newcomer's first
 * workspace looks like, and its one pending decision is the whole of that
 * workspace's Deck. The fixture below mirrors `routes/seed-demo/route.ts`'s
 * `dec_demo_1` — if the seed's shape drifts (or the href/ordering changes), the
 * demo Deck breaks and this is where it shows up.
 */
describe('buildDeckCards — demo seed', () => {
  const seededDecision: DecisionItem = {
    id: 'dec_demo_1',
    requestedBy: 'developer',
    taskId: 'task_demo_1',
    question: 'Which animation library for the hero section?',
    options: [
      'Framer Motion (full-featured, +30kb)',
      'CSS animations only (lightweight)',
      'GSAP (powerful, commercial license)',
    ],
    context: 'Hero needs smooth entrance animations and scroll-triggered effects.',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: '2026-08-26T00:00:00.000Z',
  };

  it('produces exactly one actionable card from the seeded workspace', () => {
    const cards = buildDeckCards(
      sources({
        decisions: [seededDecision],
        // seed-demo writes no designs, promotions, briefs, adoptions or runs.
        taskProjects: new Map([['task_demo_1', 'proj_demo_1']]),
      }),
    );

    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.kind).toBe('decision');
    expect(card.id).toBe('dec_demo_1');
    expect(card.title).toBe('Which animation library for the hero section?');
    expect(card.options).toHaveLength(3);
    expect(card.decision).toBe(seededDecision);
    expect(card.decisionKind).toBeNull();
  });

  it('links the seeded card to the seeded task and its project', () => {
    const [card] = buildDeckCards(
      sources({
        decisions: [seededDecision],
        taskProjects: new Map([['task_demo_1', 'proj_demo_1']]),
      }),
    );

    expect(card.href).toBe('/projects?view=tasks&task=task_demo_1');
    expect(card.projectId).toBe('proj_demo_1');
  });
});
