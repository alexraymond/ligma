/**
 * Pure logic that the amend route and the drift trigger both lean on:
 * validating an amendment's answer shape against its question, and deciding
 * whether a brief has drifted by neglect (build brief §16 Phase 2).
 */
import { describe, expect, it } from 'vitest';
import {
  DRIFT_AGE_DAYS,
  DRIFT_TASK_THRESHOLD,
  type DiscoveryQuestion,
  YOU_DECIDE,
  isBriefDrifted,
  validateAnswerAgainstQuestion,
} from './briefs';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-14T00:00:00.000Z');

function question(overrides: Partial<DiscoveryQuestion> = {}): DiscoveryQuestion {
  return {
    id: 'q1',
    label: 'Rate limits?',
    type: 'single',
    options: ['Yes', 'No'],
    required: true,
    help: '',
    ...overrides,
  };
}

describe('validateAnswerAgainstQuestion', () => {
  it("accepts one of the question's own options", () => {
    expect(validateAnswerAgainstQuestion(question(), 'Yes')).toBe(true);
  });

  it('rejects a value the question never offered', () => {
    expect(validateAnswerAgainstQuestion(question(), 'Maybe')).toBe(false);
  });

  it('always accepts the you-decide sentinel on a choice question', () => {
    expect(validateAnswerAgainstQuestion(question(), YOU_DECIDE)).toBe(true);
  });

  it('requires an array for multi and rejects a bare string', () => {
    const q = question({ type: 'multi', options: ['A', 'B'] });
    expect(validateAnswerAgainstQuestion(q, ['A', 'B'])).toBe(true);
    expect(validateAnswerAgainstQuestion(q, 'A')).toBe(false);
  });

  it('rejects an array for a non-multi question', () => {
    expect(validateAnswerAgainstQuestion(question(), ['Yes'])).toBe(false);
  });

  it('only accepts true/false for a switch', () => {
    const q = question({ type: 'switch', options: [] });
    expect(validateAnswerAgainstQuestion(q, 'true')).toBe(true);
    expect(validateAnswerAgainstQuestion(q, 'false')).toBe(true);
    expect(validateAnswerAgainstQuestion(q, 'yes')).toBe(false);
  });

  it('accepts any string for free text, never checking options', () => {
    const q = question({ type: 'text', options: [] });
    expect(validateAnswerAgainstQuestion(q, 'whatever the human typed')).toBe(true);
  });
});

describe('isBriefDrifted — the age × task-volume table', () => {
  const briefAged = (days: number, staleSnoozedUntil: string | null = null) => ({
    updatedAt: new Date(NOW - days * DAY_MS).toISOString(),
    staleSnoozedUntil,
  });

  it('89 days old, 25 tasks completed since → not drifted (age gate)', () => {
    expect(isBriefDrifted(briefAged(89), DRIFT_TASK_THRESHOLD, NOW)).toBe(false);
  });

  it('90 days old, 25 tasks completed since → drifted', () => {
    expect(isBriefDrifted(briefAged(DRIFT_AGE_DAYS), DRIFT_TASK_THRESHOLD, NOW)).toBe(true);
  });

  it('90 days old, 24 tasks completed since → not drifted (task-count gate)', () => {
    expect(isBriefDrifted(briefAged(DRIFT_AGE_DAYS), DRIFT_TASK_THRESHOLD - 1, NOW)).toBe(false);
  });

  it('qualifies on both gates but is snoozed → not drifted', () => {
    const snoozedUntil = new Date(NOW + 10 * DAY_MS).toISOString();
    expect(isBriefDrifted(briefAged(DRIFT_AGE_DAYS, snoozedUntil), DRIFT_TASK_THRESHOLD, NOW)).toBe(
      false,
    );
  });

  it('snooze window has expired → drifted again', () => {
    const expiredSnooze = new Date(NOW - DAY_MS).toISOString();
    expect(
      isBriefDrifted(briefAged(DRIFT_AGE_DAYS, expiredSnooze), DRIFT_TASK_THRESHOLD, NOW),
    ).toBe(true);
  });

  it('tolerates a brief with no staleSnoozedUntil field at all (old data)', () => {
    const bare = { updatedAt: new Date(NOW - DRIFT_AGE_DAYS * DAY_MS).toISOString() };
    expect(isBriefDrifted(bare, DRIFT_TASK_THRESHOLD, NOW)).toBe(true);
  });
});
