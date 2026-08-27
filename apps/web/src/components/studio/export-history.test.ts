/**
 * Runs under vitest's `node` environment (no real `window`). A minimal
 * in-memory `localStorage` stand-in is installed below so the persistence
 * path (capping, newest-first ordering across calls) is exercised the same
 * way it would run in a browser tab — without pulling in jsdom for one file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readExportHistory, recordExportAttempt } from './export-history';

function fakeLocalStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { localStorage: fakeLocalStorage() };
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('recordExportAttempt', () => {
  it('prepends the new attempt, newest first', () => {
    const first = recordExportAttempt({
      format: 'zip',
      ok: true,
      code: 'OK',
      message: 'Exported design-v1.zip',
    });
    const second = recordExportAttempt({
      format: 'pdf',
      ok: false,
      code: 'EXPORTER_NO_CHROME',
      message: 'no chrome',
    });
    expect(second[0].format).toBe('pdf');
    expect(second[0].ok).toBe(false);
    expect(first[0].format).toBe('zip');
  });

  it('stamps an id and an ISO timestamp', () => {
    const [entry] = recordExportAttempt({
      format: 'html',
      ok: true,
      code: 'OK',
      message: 'Exported design-v1.html',
    });
    expect(entry.id).toBeTruthy();
    expect(() => new Date(entry.at).toISOString()).not.toThrow();
  });

  it('caps the list at 20 entries without growing unbounded', () => {
    let history = recordExportAttempt({ format: 'zip', ok: true, code: 'OK', message: 'seed' });
    for (let i = 0; i < 25; i++) {
      history = recordExportAttempt({
        format: 'zip',
        ok: true,
        code: 'OK',
        message: `attempt ${i}`,
      });
    }
    expect(history.length).toBeLessThanOrEqual(20);
  });

  it('persists across reads through the same storage', () => {
    recordExportAttempt({
      format: 'markdown',
      ok: true,
      code: 'OK',
      message: 'Exported design-v1.md',
    });
    expect(readExportHistory()[0]?.format).toBe('markdown');
  });
});

describe('readExportHistory', () => {
  it('returns an empty list when there is no storage to read', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readExportHistory()).toEqual([]);
  });
});
