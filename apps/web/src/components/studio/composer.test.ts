/**
 * The composer's caret arithmetic — the only part of the mention type-ahead
 * that can be wrong without looking wrong. Everything else in `composer.tsx`
 * is markup or a call into a helper that already has its own tests.
 */

import { describe, expect, it } from 'vitest';
import { insertMention, mentionQuery } from './composer';

describe('mentionQuery', () => {
  it('opens on @ at a word boundary and tracks what has been typed', () => {
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('use @brain', 10)).toEqual({ start: 4, query: 'brain' });
    expect(mentionQuery('use (@brain', 11)).toEqual({ start: 5, query: 'brain' });
  });

  it('stays shut inside an email address', () => {
    expect(mentionQuery('alex@tyrell.global', 9)).toBeNull();
  });

  it('closes once the token stops looking like a skill id', () => {
    expect(mentionQuery('@brainstorming then', 19)).toBeNull();
    expect(mentionQuery('@brain, ', 8)).toBeNull();
  });

  it('is null with no @ before the caret', () => {
    expect(mentionQuery('draw a login', 6)).toBeNull();
    expect(mentionQuery('draw @x', 4)).toBeNull();
  });
});

describe('insertMention', () => {
  it('replaces the half-typed mention and leaves the caret after it', () => {
    expect(insertMention('use @brain', 4, 10, 'brainstorming')).toEqual({
      text: 'use @brainstorming ',
      caret: 19,
    });
  });

  it('keeps whatever followed the caret', () => {
    const { text, caret } = insertMention('use @br for this', 4, 7, 'brainstorming');
    expect(text).toBe('use @brainstorming  for this');
    expect(text.slice(caret)).toBe(' for this');
  });
});
