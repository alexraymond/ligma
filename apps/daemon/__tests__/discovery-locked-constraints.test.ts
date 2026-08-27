/**
 * `lockedConstraints` is the one place a locked brief's discovery answers
 * become prompt-ready text. d2-attempt-6's crit_goal failure (a two-screen
 * tip calculator promoted into an 8-task app with per-person splits and a
 * currency picker) traced back to this data never reaching a downstream
 * prompt at all: the shape question aside, nothing carried "No — tip total
 * only" or "No rounding" past the brief. This pins the structural read —
 * verbatim, no parsing from prose — that `studio/promote.ts` now feeds the
 * planner as hard constraints.
 */

import type { Brief } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { lockedConstraints, newBrief } from '../src/engine/discovery';

function briefWithAnswers(
  answers: Record<string, string | string[]>,
  constraints: string[] = [],
): Brief {
  const brief = newBrief('proj_locked', 'A tip calculator web app.', null);
  brief.constraints = constraints;
  brief.turns.push({
    form: {
      id: 'frm_1',
      title: 'A few questions',
      description: '',
      questions: [
        {
          id: 'shape',
          label: 'What is this, shaped like?',
          type: 'single',
          options: ['UI'],
          required: true,
          help: '',
        },
        {
          id: 'split',
          label: 'Split the bill per person?',
          type: 'single',
          options: ['Yes', 'No'],
          required: true,
          help: '',
        },
        {
          id: 'rounding',
          label: 'Round the total?',
          type: 'single',
          options: ['Yes', 'No'],
          required: true,
          help: '',
        },
      ],
    },
    answers,
    askedAt: new Date().toISOString(),
    answeredAt: new Date().toISOString(),
  });
  return brief;
}

describe('lockedConstraints', () => {
  it('carries every answered discovery question verbatim, except the shape question', () => {
    const brief = briefWithAnswers({
      shape: 'A UI app — people will look at it and click it',
      split: 'No — tip total only',
      rounding: 'No — exact amounts only',
    });

    const locked = lockedConstraints(brief);

    expect(locked).toContain('Split the bill per person?: No — tip total only');
    expect(locked).toContain('Round the total?: No — exact amounts only');
    expect(locked.join('\n')).not.toContain('shaped like');
  });

  it('appends the human-typed constraints after the discovery answers', () => {
    const brief = briefWithAnswers({ split: 'No — tip total only', rounding: 'No rounding' }, [
      'USD only — hardcode the $ sign',
    ]);

    expect(lockedConstraints(brief)).toEqual([
      'Split the bill per person?: No — tip total only',
      'Round the total?: No rounding',
      'USD only — hardcode the $ sign',
    ]);
  });

  it('skips a question left unanswered rather than inventing a line for it', () => {
    const brief = briefWithAnswers({ split: 'No — tip total only' });
    expect(lockedConstraints(brief)).toEqual(['Split the bill per person?: No — tip total only']);
  });

  it('joins a multi-select answer the same way the discovery prompt does', () => {
    const brief = newBrief('proj_locked', 'ask', null);
    brief.turns.push({
      form: {
        id: 'frm_1',
        title: 't',
        description: '',
        questions: [
          {
            id: 'channels',
            label: 'Which channels?',
            type: 'multi',
            options: ['Email', 'SMS'],
            required: false,
            help: '',
          },
        ],
      },
      answers: { channels: ['Email', 'SMS'] },
      askedAt: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
    });
    expect(lockedConstraints(brief)).toEqual(['Which channels?: Email, SMS']);
  });

  it('returns an empty list for a brief with no answers and no constraints', () => {
    expect(lockedConstraints(newBrief('proj_locked', 'ask', null))).toEqual([]);
  });
});
