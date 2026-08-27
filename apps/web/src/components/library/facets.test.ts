import { describe, expect, it } from 'vitest';
import { facetOptions, matchesFacet, matchesTagFacet } from './facets';

describe('facetOptions', () => {
  it('counts distinct values, sorted by frequency then alphabetically', () => {
    expect(facetOptions(['card', 'article', 'card', 'card', 'article'])).toEqual([
      { value: 'card', count: 3 },
      { value: 'article', count: 2 },
    ]);
  });

  it('breaks ties alphabetically', () => {
    expect(facetOptions(['b', 'a'])).toEqual([
      { value: 'a', count: 1 },
      { value: 'b', count: 1 },
    ]);
  });

  it('excludes null, undefined and empty-string values', () => {
    expect(facetOptions(['card', null, undefined, ''])).toEqual([{ value: 'card', count: 1 }]);
  });

  it('returns nothing for an all-blank input', () => {
    expect(facetOptions([null, undefined])).toEqual([]);
  });
});

describe('matchesFacet', () => {
  it('matches everything when nothing is selected', () => {
    expect(matchesFacet('card', null)).toBe(true);
    expect(matchesFacet(null, null)).toBe(true);
  });

  it('matches only an exact value once one is selected', () => {
    expect(matchesFacet('card', 'card')).toBe(true);
    expect(matchesFacet('article', 'card')).toBe(false);
    expect(matchesFacet(null, 'card')).toBe(false);
  });
});

describe('matchesTagFacet', () => {
  it('matches everything when nothing is selected', () => {
    expect(matchesTagFacet([], null)).toBe(true);
  });

  it('matches when the selected tag is anywhere in the list', () => {
    expect(matchesTagFacet(['blog', 'essay'], 'essay')).toBe(true);
    expect(matchesTagFacet(['blog'], 'essay')).toBe(false);
  });
});
