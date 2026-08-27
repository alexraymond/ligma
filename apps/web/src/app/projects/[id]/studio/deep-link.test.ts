import { describe, expect, it } from 'vitest';
import { parseStudioDeepLink } from './deep-link';

describe('parseStudioDeepLink', () => {
  it('returns nulls when neither param is present', () => {
    expect(parseStudioDeepLink(new URLSearchParams(''))).toEqual({
      designId: null,
      filePath: null,
    });
  });

  it('reads session and file', () => {
    const params = new URLSearchParams('session=des_123&file=index.html');
    expect(parseStudioDeepLink(params)).toEqual({ designId: 'des_123', filePath: 'index.html' });
  });

  it('treats blank or whitespace-only values as absent', () => {
    expect(parseStudioDeepLink(new URLSearchParams('session=%20&file='))).toEqual({
      designId: null,
      filePath: null,
    });
  });

  it('URL-decodes a nested file path', () => {
    const params = new URLSearchParams();
    params.set('file', 'src/pages/index.tsx');
    expect(parseStudioDeepLink(params).filePath).toBe('src/pages/index.tsx');
  });

  it('ignores an unrelated query param', () => {
    expect(parseStudioDeepLink(new URLSearchParams('tab=versions'))).toEqual({
      designId: null,
      filePath: null,
    });
  });

  // W4: deck cards and the task detail panel's "see where this came from" link
  // both produce `?design=`, not `?session=`.
  it('accepts `design` as an alias for `session`', () => {
    const params = new URLSearchParams('design=des_456&file=index.html');
    expect(parseStudioDeepLink(params)).toEqual({ designId: 'des_456', filePath: 'index.html' });
  });

  it('prefers `session` when both `session` and `design` are present', () => {
    const params = new URLSearchParams('session=des_1&design=des_2');
    expect(parseStudioDeepLink(params).designId).toBe('des_1');
  });
});
