import type { CritiqueReport, DesignCriticEvent } from '@ligma/api';
/**
 * `resolveCritiqueDisplay` is what "replay reuses the lane's live rendering"
 * cashes out to: feed it a `CritiqueLiveState` built by replaying transcript
 * events through the exact reducer live SSE uses, and it must render
 * identically to a live run at the same point.
 */
import { describe, expect, it } from 'vitest';
import { CRITIQUE_IDLE, reduceCriticEvent } from './critique-events';
import { critiqueLaneChips, resolveCritiqueDisplay } from './critique-lane';

function event(overrides: Partial<DesignCriticEvent>): DesignCriticEvent {
  return {
    designId: 'd1',
    turnId: 'dt1',
    phase: 'start',
    status: 'running',
    rule: null,
    score: null,
    threshold: 75,
    error: null,
    ...overrides,
  };
}

const SCORED_TRANSCRIPT: DesignCriticEvent[] = [
  event({ phase: 'start' }),
  event({ phase: 'rule', rule: { rule: 'typography', score: 90, note: 'consistent scale' } }),
  event({ phase: 'score', score: 90 }),
  event({ phase: 'end', status: 'scored', score: 90 }),
];

describe('resolveCritiqueDisplay — live', () => {
  it("shows 'not run yet' when no critique has run", () => {
    const view = resolveCritiqueDisplay({
      critique: null,
      currentRule: null,
      replaying: false,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'idle',
      replayError: null,
    });
    expect(view.statusLabel).toBe('not run yet');
    expect(view.interruptible).toBe(false);
    expect(view.scoringNow).toBe(false);
  });

  it('is interruptible only while a live run is actually running', () => {
    const running: CritiqueReport = {
      status: 'running',
      score: null,
      threshold: 75,
      rules: [],
      designSystem: null,
      error: null,
      startedAt: 't0',
      finishedAt: null,
    };
    const view = resolveCritiqueDisplay({
      critique: running,
      currentRule: 'typography',
      replaying: false,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'idle',
      replayError: null,
    });
    expect(view.interruptible).toBe(true);
    expect(view.scoringNow).toBe(true);
    expect(view.currentRule).toBe('typography');
  });

  it('maps an errored critique to the harness failure class, never a score', () => {
    const errored: CritiqueReport = {
      status: 'error',
      score: null,
      threshold: 75,
      rules: [],
      designSystem: null,
      error: 'governor denied',
      startedAt: 't0',
      finishedAt: 't1',
    };
    const view = resolveCritiqueDisplay({
      critique: errored,
      currentRule: null,
      replaying: false,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'idle',
      replayError: null,
    });
    expect(view.failureClass).toBe('harness');
    expect(view.critique?.score).toBeNull();
  });
});

describe('resolveCritiqueDisplay — replay', () => {
  it('renders a fully-replayed transcript identically to the live run it recorded', () => {
    const liveEnd = SCORED_TRANSCRIPT.reduce(reduceCriticEvent, CRITIQUE_IDLE);

    const liveView = resolveCritiqueDisplay({
      critique: liveEnd.critique,
      currentRule: liveEnd.currentRule,
      replaying: false,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'idle',
      replayError: null,
    });
    const replayView = resolveCritiqueDisplay({
      critique: null, // the live prop is irrelevant once replaying is true
      currentRule: null,
      replaying: true,
      replayLive: liveEnd,
      replayStatus: 'done',
      replayError: null,
    });

    expect(replayView.critique).toEqual(liveView.critique);
    expect(replayView.statusLabel).toBe(liveView.statusLabel);
    expect(replayView.threshold).toBe(liveView.threshold);
    expect(replayView.failureClass).toBe(liveView.failureClass);
    // The one deliberate difference: a replayed run is never interruptible.
    expect(replayView.interruptible).toBe(false);
  });

  it('shows a mid-playback frame exactly as the ticker would live: scoring, current rule set', () => {
    const partial = SCORED_TRANSCRIPT.slice(0, 2).reduce(reduceCriticEvent, CRITIQUE_IDLE);
    const view = resolveCritiqueDisplay({
      critique: null,
      currentRule: null,
      replaying: true,
      replayLive: partial,
      replayStatus: 'playing',
      replayError: null,
    });
    expect(view.scoringNow).toBe(true);
    expect(view.currentRule).toBe('typography');
    expect(view.critique?.rules).toEqual([
      { rule: 'typography', score: 90, note: 'consistent scale' },
    ]);
  });

  it('surfaces a transcript fetch failure distinctly from a critique-status failure', () => {
    const view = resolveCritiqueDisplay({
      critique: null,
      currentRule: null,
      replaying: true,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'error',
      replayError: 'critique transcript fetch failed: 404',
    });
    expect(view.replayUnavailable).toBe(true);
    // Not a critique verdict — no rule ever ran, so no harness failure class either.
    expect(view.failureClass).toBeNull();
  });

  it("labels the loading window distinctly from 'not run yet'", () => {
    const view = resolveCritiqueDisplay({
      critique: null,
      currentRule: null,
      replaying: true,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'loading',
      replayError: null,
    });
    expect(view.statusLabel).toBe('loading replay…');
  });
});

describe('critiqueLaneChips — the panel row', () => {
  const panel: CritiqueReport = {
    status: 'scored',
    score: 85,
    threshold: 75,
    rules: [{ rule: 'color', score: 90, note: 'restrained' }],
    designSystem: 'anthropic',
    error: null,
    startedAt: 't0',
    finishedAt: 't1',
    lanes: [
      {
        lane: 'craft-rules',
        status: 'scored',
        score: 90,
        rules: [{ rule: 'color', score: 90, note: 'restrained' }],
        error: null,
      },
      { lane: 'design-system-fidelity', status: 'scored', score: 80, rules: [], error: null },
      {
        lane: 'accessibility',
        status: 'skipped',
        score: null,
        rules: [],
        skipReason: 'quota',
        error: 'skipped — the governor window can afford 2 of 3 critique lane(s) this turn',
      },
    ],
  };

  it("renders a quota-denied lane as 'skipped — quota', never as a zero", () => {
    const chips = critiqueLaneChips(panel);
    const a11y = chips.find((chip) => chip.lane === 'accessibility');
    expect(a11y?.label).toBe('skipped — quota');
    expect(a11y?.score).toBeNull();
    // The reason survives to the expanded findings rather than being invented there.
    expect(a11y?.note).toContain('governor window');
  });

  it('distinguishes a lane that had nothing to score from one the governor denied', () => {
    const chips = critiqueLaneChips({
      ...panel,
      lanes: [
        {
          lane: 'design-system-fidelity',
          status: 'skipped',
          score: null,
          rules: [],
          skipReason: 'not-applicable',
          error: 'no design system in use',
        },
      ],
    });
    expect(chips[0]?.label).toBe('skipped — n/a');
  });

  it("shows a scored lane's own number and carries its findings", () => {
    const chips = critiqueLaneChips(panel);
    expect(chips[0]).toMatchObject({ lane: 'craft-rules', label: '90', score: 90 });
    expect(chips[0]?.rules).toHaveLength(1);
  });

  it('is empty for a single-critic report written before the panel existed', () => {
    const { lanes: _lanes, ...prePanel } = panel;
    expect(critiqueLaneChips(prePanel)).toEqual([]);
    expect(critiqueLaneChips(null)).toEqual([]);
  });

  it('labels an errored lane as an error, not a low mark', () => {
    const chips = critiqueLaneChips({
      ...panel,
      lanes: [
        {
          lane: 'craft-rules',
          status: 'error',
          score: null,
          rules: [],
          error: 'provider exploded',
        },
      ],
    });
    expect(chips[0]?.label).toBe('error');
    expect(chips[0]?.score).toBeNull();
  });
});

describe('resolveCritiqueDisplay — the combined score', () => {
  it('says out loud that the overall score is a mean of the lanes that scored', () => {
    const view = resolveCritiqueDisplay({
      critique: {
        status: 'scored',
        score: 85,
        threshold: 75,
        rules: [],
        designSystem: null,
        error: null,
        startedAt: 't0',
        finishedAt: 't1',
        lanes: [
          { lane: 'craft-rules', status: 'scored', score: 90, rules: [], error: null },
          { lane: 'design-system-fidelity', status: 'scored', score: 80, rules: [], error: null },
          {
            lane: 'accessibility',
            status: 'skipped',
            score: null,
            rules: [],
            skipReason: 'quota',
            error: 'denied',
          },
        ],
      },
      currentRule: null,
      currentLane: null,
      replaying: false,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'idle',
      replayError: null,
    });
    expect(view.combinedNote).toBe('mean of 2 scored lanes (1 skipped)');
    expect(view.lanes).toHaveLength(3);
  });

  it('says nothing about a mean when there are no lanes to average', () => {
    const view = resolveCritiqueDisplay({
      critique: null,
      currentRule: null,
      currentLane: null,
      replaying: false,
      replayLive: CRITIQUE_IDLE,
      replayStatus: 'idle',
      replayError: null,
    });
    expect(view.combinedNote).toBeNull();
    expect(view.lanes).toEqual([]);
  });
});
