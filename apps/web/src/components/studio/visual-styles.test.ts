import { describe, expect, it } from 'vitest';
import {
  DIRECTION_PREFIX,
  VISUAL_STYLES,
  styleInPrompt,
  stylePromptFragment,
  withStyleDirection,
} from './visual-styles';

const quiet = VISUAL_STYLES.find((s) => s.slug === 'quiet-saas')!;
const retro = VISUAL_STYLES.find((s) => s.slug === 'retro-pop')!;

describe('visual style catalog', () => {
  it('carries the vendored directions with unique slugs and a swatch each', () => {
    expect(VISUAL_STYLES.length).toBe(26);
    expect(new Set(VISUAL_STYLES.map((s) => s.slug)).size).toBe(VISUAL_STYLES.length);
    for (const style of VISUAL_STYLES) {
      expect(style.title).not.toBe('');
      expect(style.description).not.toBe('');
      expect(style.swatch).toHaveLength(3);
    }
  });

  it('names exactly one recommended direction', () => {
    expect(VISUAL_STYLES.filter((s) => s.recommended).map((s) => s.slug)).toEqual(['quiet-saas']);
  });
});

describe('stylePromptFragment', () => {
  it("is the style's own words, prefixed so the user can see and edit it", () => {
    expect(stylePromptFragment(quiet)).toBe(
      `${DIRECTION_PREFIX}Quiet SaaS — Precise spacing, calm controls, and focused product hierarchy.`,
    );
  });
});

describe('withStyleDirection', () => {
  it('appends the fragment below what the user typed', () => {
    expect(withStyleDirection('A billing dashboard.', quiet)).toBe(
      `A billing dashboard.\n\n${stylePromptFragment(quiet)}`,
    );
  });

  it('is the whole prompt when nothing was typed yet', () => {
    expect(withStyleDirection('', quiet)).toBe(stylePromptFragment(quiet));
  });

  it('swaps rather than stacks when a second card is picked', () => {
    const once = withStyleDirection('A billing dashboard.', quiet);
    expect(withStyleDirection(once, retro)).toBe(
      `A billing dashboard.\n\n${stylePromptFragment(retro)}`,
    );
  });

  it('is idempotent — the same card twice reads the same as once', () => {
    const once = withStyleDirection('A billing dashboard.', quiet);
    expect(withStyleDirection(once, quiet)).toBe(once);
  });

  it('drops the direction and keeps the prose when passed null', () => {
    const once = withStyleDirection('A billing dashboard.', quiet);
    expect(withStyleDirection(once, null)).toBe('A billing dashboard.');
    expect(withStyleDirection(stylePromptFragment(quiet), null)).toBe('');
  });
});

describe('styleInPrompt', () => {
  it('reads the pick back out of the text — the textarea is the only source of truth', () => {
    expect(styleInPrompt(withStyleDirection('Screens.', retro))).toEqual(retro);
    expect(styleInPrompt('Screens.')).toBeNull();
  });

  it('forgets the pick once the user edits that line away', () => {
    expect(styleInPrompt(`${DIRECTION_PREFIX}something I typed myself`)).toBeNull();
  });
});
