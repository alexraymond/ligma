import { describe, expect, it } from 'vitest';
import { EXAMPLES, getExample, getExamples } from './index';
import { enExamples } from './locales/en';

describe('examples gallery', () => {
  it('ships at least 6 curated examples', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(6);
    expect(EXAMPLES.length).toBeLessThanOrEqual(30);
  });

  it('every example has a unique id', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every example has a non-trivial prompt and inline SVG thumbnail', () => {
    for (const ex of EXAMPLES) {
      expect(ex.prompt.length).toBeGreaterThan(40);
      expect(ex.thumbnail).toMatch(/^<svg /);
    }
  });

  it('every example has en title/description coverage', () => {
    for (const ex of EXAMPLES) {
      const en = enExamples[ex.id];
      expect(en, `missing en content for ${ex.id}`).toBeDefined();
      expect(en?.title.length).toBeGreaterThan(0);
      expect(en?.description.length).toBeGreaterThan(0);
    }
  });

  it('getExamples returns localized content', () => {
    const en = getExamples('en');
    expect(en).toHaveLength(EXAMPLES.length);
    const cosmicEn = en.find((e) => e.id === 'cosmic-animation');
    expect(cosmicEn?.title).toBeDefined();
  });

  it('getExamples coerces unknown locales to en', () => {
    const fallback = getExamples('fr-FR');
    expect(fallback[0]?.title).toBe(getExamples('en')[0]?.title);
  });

  it('getExample looks up by id', () => {
    const ex = getExample('dashboard', 'en');
    expect(ex?.category).toBe('dashboard');
    expect(getExample('does-not-exist')).toBeUndefined();
  });

  it('getExamples throws when a locale entry is missing from the registry', () => {
    const id = EXAMPLES[0]?.id ?? 'cosmic-animation';
    const enBackup = enExamples[id];
    delete enExamples[id];
    try {
      expect(() => getExamples('en')).toThrow(/missing localized content/);
    } finally {
      if (enBackup) enExamples[id] = enBackup;
    }
  });
});
