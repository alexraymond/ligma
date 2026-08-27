import type { Brief } from '@ligma/api';
import { SHAPE_LABELS, SHAPE_QUESTION_ID } from '@ligma/api';
/**
 * `applyAmendment` — the thread's "edit an answered question" affordance
 * (build brief §16 Phase 2). Deliberately the mirror of `applyAnswers`: that
 * one only accepts the *open* form and refuses a stale one with "That form is
 * no longer the open one"; this one only ever targets an *answered* turn, and
 * reuses that exact throw for the id-not-found case (a formId that was never
 * answered — including the still-open one — has nothing to amend).
 */
import { describe, expect, it } from 'vitest';
import { applyAmendment, newBrief } from '../src/engine/discovery';

function briefWithAnsweredTurn(): Brief {
  const brief = newBrief('proj_amend', 'A tool for shortening URLs', null);
  brief.turns.push({
    form: {
      id: 'frm_1',
      title: 'A few questions',
      description: '',
      questions: [
        {
          id: SHAPE_QUESTION_ID,
          label: 'What is this, shaped like?',
          type: 'single',
          options: Object.values(SHAPE_LABELS),
          required: true,
          help: '',
        },
        {
          id: 'auth',
          label: 'Who signs in?',
          type: 'single',
          options: ['Nobody', 'One admin', 'Many accounts'],
          required: true,
          help: '',
        },
      ],
    },
    answers: { [SHAPE_QUESTION_ID]: SHAPE_LABELS.headless, auth: 'Nobody' },
    askedAt: '2026-01-01T00:00:00.000Z',
    answeredAt: '2026-01-01T00:00:00.000Z',
  });
  brief.shape = 'headless';
  return brief;
}

describe('applyAmendment', () => {
  it("changes an already-answered question's value in place", () => {
    const brief = briefWithAnsweredTurn();
    const result = applyAmendment(brief, 'frm_1', 'auth', 'One admin');
    expect(result.brief.turns[0].answers).toEqual({
      [SHAPE_QUESTION_ID]: SHAPE_LABELS.headless,
      auth: 'One admin',
    });
    expect(result.questionLabel).toBe('Who signs in?');
    // The turn's own answeredAt is untouched — this is an edit, not a re-answer.
    expect(result.brief.turns[0].answeredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.brief.updatedAt).not.toBe(brief.updatedAt);
  });

  it("still throws 'that form is no longer open' for a form with nothing answered on it", () => {
    const brief = briefWithAnsweredTurn();
    expect(() => applyAmendment(brief, 'frm_never_answered', 'auth', 'One admin')).toThrow(
      'That form is no longer the open one',
    );
  });

  it('rejects an unknown question id on an otherwise real form', () => {
    const brief = briefWithAnsweredTurn();
    expect(() => applyAmendment(brief, 'frm_1', 'nonexistent', 'x')).toThrow(/Unknown question/);
  });

  it("rejects an answer that does not fit the question's own options", () => {
    const brief = briefWithAnsweredTurn();
    expect(() => applyAmendment(brief, 'frm_1', 'auth', 'Everyone, no login')).toThrow(
      /does not fit/,
    );
  });

  it('re-derives project.shape when the shape question itself is amended', () => {
    const brief = briefWithAnsweredTurn();
    const result = applyAmendment(brief, 'frm_1', SHAPE_QUESTION_ID, SHAPE_LABELS.ui);
    expect(result.brief.shape).toBe('ui');
    expect(result.shape).toBe('ui'); // non-null: the caller must PATCH project.shape
  });

  it("returns a null shape signal when the amendment doesn't change it", () => {
    const brief = briefWithAnsweredTurn();
    const result = applyAmendment(brief, 'frm_1', 'auth', 'One admin');
    expect(result.shape).toBeNull();
  });

  it('sets staleFlaggedAt when the brief is locked, and never lowers it again', () => {
    const brief = { ...briefWithAnsweredTurn(), status: 'locked' as const };
    const first = applyAmendment(brief, 'frm_1', 'auth', 'One admin');
    expect(first.staleFlagged).toBe(true);
    expect(first.brief.staleFlaggedAt).not.toBeNull();

    const stamp = first.brief.staleFlaggedAt;
    const second = applyAmendment(first.brief, 'frm_1', 'auth', 'Many accounts');
    expect(second.staleFlagged).toBe(false); // already flagged — this amend didn't newly raise it
    expect(second.brief.staleFlaggedAt).toBe(stamp);
  });

  it('leaves staleFlaggedAt untouched while the brief is still in discovery', () => {
    const brief = briefWithAnsweredTurn(); // status defaults to "discovery"
    const result = applyAmendment(brief, 'frm_1', 'auth', 'One admin');
    expect(result.staleFlagged).toBe(false);
    expect(result.brief.staleFlaggedAt).toBeNull();
  });
});
