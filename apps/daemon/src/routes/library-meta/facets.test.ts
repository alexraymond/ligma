/**
 * `deriveSkillFacet` against the shapes actually found scanning all 136
 * vendored SKILL.md frontmatter blocks (see the file header for the coverage
 * numbers): `od.mode`-only, `od.category`-bearing, the curated top-level
 * `category` + `tags` subset, and neither.
 */
import { describe, expect, it } from 'vitest';
import { deriveSkillFacet } from './facets';

describe('deriveSkillFacet', () => {
  it("reads od.mode when that's all a skill sets (the ad-creative shape)", () => {
    const frontmatter = {
      name: 'ad-creative',
      od: { mode: 'design-system', upstream: 'https://…' },
    };
    expect(deriveSkillFacet('ad-creative', frontmatter)).toEqual({
      id: 'ad-creative',
      mode: 'design-system',
      category: null,
      tags: [],
    });
  });

  it('falls back to od.category when there is no top-level category (the apple-hig shape)', () => {
    const frontmatter = { od: { mode: 'design-system', category: 'design-systems' } };
    expect(deriveSkillFacet('apple-hig', frontmatter).category).toBe('design-systems');
  });

  it('prefers the top-level category over od.category when both are present', () => {
    const frontmatter = { category: 'card', od: { mode: 'prototype', category: 'should-not-win' } };
    expect(deriveSkillFacet('card-twitter', frontmatter).category).toBe('card');
  });

  it('reads the curated top-level tags array (the article-magazine shape)', () => {
    const frontmatter = { category: 'article', tags: ['blog', 'essay', 'newsletter'] };
    expect(deriveSkillFacet('article-magazine', frontmatter).tags).toEqual([
      'blog',
      'essay',
      'newsletter',
    ]);
  });

  it('reports nulls and an empty array for a skill with no od block and no category', () => {
    expect(deriveSkillFacet('bare', { name: 'bare', description: '…' })).toEqual({
      id: 'bare',
      mode: null,
      category: null,
      tags: [],
    });
  });

  it('tolerates a malformed od block instead of throwing', () => {
    expect(deriveSkillFacet('weird', { od: 'not-an-object' }).mode).toBeNull();
  });
});
