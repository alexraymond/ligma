import type { DesignCriticEvent } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { CRITIQUE_IDLE, reduceCriticEvent } from './critique-events';

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

describe('reduceCriticEvent', () => {
  it('starts idle-shaped: running status, no rules, no score', () => {
    const state = reduceCriticEvent(CRITIQUE_IDLE, event({ phase: 'start' }));
    expect(state.critique).toMatchObject({ status: 'running', score: null, rules: [] });
    expect(state.currentRule).toBeNull();
  });

  it('accumulates rule frames and tracks the current rule', () => {
    const afterStart = reduceCriticEvent(CRITIQUE_IDLE, event({ phase: 'start' }));
    const afterRule1 = reduceCriticEvent(
      afterStart,
      event({ phase: 'rule', rule: { rule: 'typography', score: 80, note: 'fine' } }),
    );
    expect(afterRule1.currentRule).toBe('typography');
    expect(afterRule1.critique?.rules).toEqual([{ rule: 'typography', score: 80, note: 'fine' }]);

    const afterRule2 = reduceCriticEvent(
      afterRule1,
      event({ phase: 'rule', rule: { rule: 'spacing', score: 60, note: 'cramped' } }),
    );
    expect(afterRule2.critique?.rules).toHaveLength(2);
  });

  it('resets currentRule to null on a frame without a rule (score/end)', () => {
    const withRule = reduceCriticEvent(
      CRITIQUE_IDLE,
      event({ phase: 'rule', rule: { rule: 'typography', score: 80, note: 'fine' } }),
    );
    const scored = reduceCriticEvent(withRule, event({ phase: 'score', score: 80 }));
    expect(scored.currentRule).toBeNull();
  });

  it("only surfaces a score when the status is 'scored' — never as a proxy for error", () => {
    const errored = reduceCriticEvent(
      CRITIQUE_IDLE,
      event({ phase: 'end', status: 'error', error: 'boom' }),
    );
    expect(errored.critique).toMatchObject({ status: 'error', score: null, error: 'boom' });

    const scored = reduceCriticEvent(
      CRITIQUE_IDLE,
      event({ phase: 'end', status: 'scored', score: 42 }),
    );
    expect(scored.critique?.score).toBe(42);
  });

  it("collects one lane verdict per 'lane' frame and tracks the lane being scored", () => {
    const start = reduceCriticEvent(CRITIQUE_IDLE, event({ phase: 'start' }));
    const scoring = reduceCriticEvent(
      start,
      event({
        phase: 'rule',
        lane: 'accessibility',
        rule: { rule: 'accessibility:contrast', score: 55, note: 'thin' },
      }),
    );
    expect(scoring.currentLane).toBe('accessibility');
    expect(scoring.currentRule).toBe('accessibility:contrast');

    const closed = reduceCriticEvent(
      scoring,
      event({
        phase: 'lane',
        lane: 'accessibility',
        laneReport: { lane: 'accessibility', status: 'scored', score: 55, rules: [], error: null },
      }),
    );
    expect(closed.critique?.lanes).toEqual([
      { lane: 'accessibility', status: 'scored', score: 55, rules: [], error: null },
    ]);
    // A lane frame closes a panelist; it is not itself a rule the ticker is on.
    expect(closed.currentLane).toBeNull();
  });

  it("keeps a skipped lane's verdict verbatim — never rewritten as a zero", () => {
    const state = reduceCriticEvent(
      CRITIQUE_IDLE,
      event({
        phase: 'lane',
        lane: 'design-system-fidelity',
        laneReport: {
          lane: 'design-system-fidelity',
          status: 'skipped',
          score: null,
          rules: [],
          skipReason: 'quota',
          error: 'skipped — governor denied',
        },
      }),
    );
    expect(state.critique?.lanes?.[0]).toMatchObject({
      status: 'skipped',
      score: null,
      skipReason: 'quota',
    });
  });

  it("stamps finishedAt only on the 'end' phase", () => {
    const running = reduceCriticEvent(CRITIQUE_IDLE, event({ phase: 'start' }));
    expect(running.critique?.finishedAt).toBeNull();

    const done = reduceCriticEvent(running, event({ phase: 'end', status: 'scored', score: 90 }));
    expect(done.critique?.finishedAt).not.toBeNull();
  });
});
