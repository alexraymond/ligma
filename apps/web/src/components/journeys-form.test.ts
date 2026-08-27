import { describe, expect, it } from 'vitest';
import {
  addStep,
  buildJourneyPayload,
  emptyJourneyForm,
  isJourneyFormValid,
  parseTags,
  removeStep,
} from './journeys-form';

describe('parseTags', () => {
  it('splits on comma, trims, and drops empties', () => {
    expect(parseTags('checkout,  billing ,, growth')).toEqual(['checkout', 'billing', 'growth']);
  });

  it('returns an empty array for blank input', () => {
    expect(parseTags('   ')).toEqual([]);
  });
});

describe('addStep', () => {
  it('appends a trimmed step', () => {
    expect(addStep(['a'], '  b  ')).toEqual(['a', 'b']);
  });

  it('ignores whitespace-only input instead of adding an empty step', () => {
    expect(addStep(['a'], '   ')).toEqual(['a']);
  });
});

describe('removeStep', () => {
  it('removes only the step at the given index', () => {
    expect(removeStep(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
});

describe('isJourneyFormValid', () => {
  it('requires a non-blank title and goal', () => {
    expect(isJourneyFormValid(emptyJourneyForm())).toBe(false);
    expect(isJourneyFormValid({ ...emptyJourneyForm(), title: 'Checkout' })).toBe(false);
    expect(
      isJourneyFormValid({ ...emptyJourneyForm(), title: 'Checkout', goal: 'Buy a widget' }),
    ).toBe(true);
  });

  it('treats whitespace-only fields as blank', () => {
    expect(isJourneyFormValid({ ...emptyJourneyForm(), title: '  ', goal: '  ' })).toBe(false);
  });
});

describe('buildJourneyPayload', () => {
  it('trims title/goal, drops empty steps, and parses tags', () => {
    const payload = buildJourneyPayload({
      title: '  Checkout  ',
      goal: '  Buy a widget end to end  ',
      steps: ['Add to cart', '  ', 'Pay'],
      tags: 'checkout, growth',
    });
    expect(payload).toEqual({
      title: 'Checkout',
      goal: 'Buy a widget end to end',
      steps: ['Add to cart', 'Pay'],
      tags: ['checkout', 'growth'],
    });
  });
});
