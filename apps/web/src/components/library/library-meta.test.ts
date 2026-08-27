/**
 * The Library's use-tracking/bookmark fetch wrappers — same `stubFetch`
 * convention `catalog.test.ts` uses for the vendored-catalog fetches. The
 * `useLibraryMeta` hook itself isn't unit-tested here: no hook-testing
 * harness exists elsewhere in this app (`useDesignSystems` in
 * `pickers/design-system-picker.tsx` isn't either) — these functions are the
 * testable surface the hook is built on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLibraryMeta,
  fetchSkillFacets,
  metaKey,
  recordLibraryUse,
  setLibraryBookmark,
} from './library-meta';

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('metaKey', () => {
  it('joins kind and id the same way the daemon store does', () => {
    expect(metaKey('design-system', 'mono')).toBe('design-system:mono');
  });
});

describe('fetchLibraryMeta', () => {
  it('unwraps the entries envelope', async () => {
    const entries = [{ kind: 'skill' as const, id: 'brand-extract', useCount: 3, saved: true }];
    const fetchMock = stubFetch(200, { entries });
    await expect(fetchLibraryMeta()).resolves.toEqual(entries);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/library-meta');
  });

  it("surfaces the daemon's error message on a non-2xx", async () => {
    // 400, not 500: apiFetch retries 5xx with backoff, which would make this
    // assertion true but slow for no reason.
    stubFetch(400, { error: 'boom' });
    await expect(fetchLibraryMeta()).rejects.toThrow('boom');
  });
});

describe('recordLibraryUse', () => {
  it('posts kind and id, and returns the updated entry', async () => {
    const fetchMock = stubFetch(200, { kind: 'craft', id: 'color', useCount: 2, saved: false });
    const entry = await recordLibraryUse('craft', 'color');
    expect(entry).toEqual({ kind: 'craft', id: 'color', useCount: 2, saved: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/library-meta/use');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kind: 'craft',
      id: 'color',
    });
  });
});

describe('setLibraryBookmark', () => {
  it('posts kind, id and the target saved state', async () => {
    const fetchMock = stubFetch(200, {
      kind: 'design-system',
      id: 'mono',
      useCount: 0,
      saved: true,
    });
    await setLibraryBookmark('design-system', 'mono', true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kind: 'design-system',
      id: 'mono',
      saved: true,
    });
  });
});

describe('fetchSkillFacets', () => {
  it('unwraps the skills envelope', async () => {
    const skills = [
      { id: 'apple-hig', mode: 'design-system', category: 'design-systems', tags: [] },
    ];
    const fetchMock = stubFetch(200, { skills });
    await expect(fetchSkillFacets()).resolves.toEqual(skills);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/library-meta/facets');
  });
});
