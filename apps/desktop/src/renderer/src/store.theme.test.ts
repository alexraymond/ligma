/**
 * Covers the two theme helpers that encode the Ligma "light-by-default"
 * acceptance criterion (paper-sketchbook rebrand flipped the prior dark
 * default):
 *   - readInitialTheme()  — default = 'light' when no persisted value
 *   - applyThemeClass()   — toggles only the `.dark` class on documentElement;
 *                           light leaves `:root` untouched
 *
 * Desktop vitest runs in the default (node) environment — no happy-dom / no
 * jsdom — so we stub `window` and `document` manually via `vi.stubGlobal`.
 * That keeps us off the happy-dom dependency graph for a one-file test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyThemeClass, readInitialTheme } from './store';

const THEME_STORAGE_KEY = 'ligma:theme';

/** Minimal Storage double — tracks keys in a plain Map, matches the shape
 *  `readInitialTheme` consumes (`getItem`). Mutable throwOnGet for the
 *  "localStorage unavailable" branch. */
function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  let throwOnGet = false;
  return {
    getItem: (key: string): string | null => {
      if (throwOnGet) throw new Error('quota exceeded / access denied');
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (n: number) => [...store.keys()][n] ?? null,
    get length() {
      return store.size;
    },
    setThrowOnGet(v: boolean) {
      throwOnGet = v;
    },
  };
}

describe('readInitialTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 'light' when `window` is undefined (SSR / node)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberate undefined global
    vi.stubGlobal('window', undefined as any);
    expect(readInitialTheme()).toBe('light');
  });

  it("returns 'light' when window exists and localStorage has no theme key", () => {
    vi.stubGlobal('window', { localStorage: makeStorage() });
    expect(readInitialTheme()).toBe('light');
  });

  it("returns 'light' when localStorage has 'light' stored", () => {
    vi.stubGlobal('window', {
      localStorage: makeStorage({ [THEME_STORAGE_KEY]: 'light' }),
    });
    expect(readInitialTheme()).toBe('light');
  });

  it("returns 'dark' when localStorage has 'dark' stored", () => {
    vi.stubGlobal('window', {
      localStorage: makeStorage({ [THEME_STORAGE_KEY]: 'dark' }),
    });
    expect(readInitialTheme()).toBe('dark');
  });

  it("returns 'light' on unrecognised stored values (e.g. legacy keys)", () => {
    vi.stubGlobal('window', {
      localStorage: makeStorage({ [THEME_STORAGE_KEY]: 'sepia' }),
    });
    expect(readInitialTheme()).toBe('light');
  });

  it("returns 'light' when localStorage.getItem throws", () => {
    const storage = makeStorage();
    storage.setThrowOnGet(true);
    vi.stubGlobal('window', { localStorage: storage });
    expect(readInitialTheme()).toBe('light');
  });
});

/** DocumentElement stand-in that implements just the classList API we consume. */
function makeDocumentElement(initialClasses: string[] = []) {
  const classes = new Set(initialClasses);
  return {
    classList: {
      add: (c: string) => {
        classes.add(c);
      },
      remove: (c: string) => {
        classes.delete(c);
      },
      contains: (c: string) => classes.has(c),
      get size() {
        return classes.size;
      },
      toArray: () => [...classes],
    },
  };
}

describe('applyThemeClass', () => {
  let root: ReturnType<typeof makeDocumentElement>;

  beforeEach(() => {
    root = makeDocumentElement();
    vi.stubGlobal('document', { documentElement: root });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a no-op when `document` is undefined (SSR safety)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberate undefined global
    vi.stubGlobal('document', undefined as any);
    expect(() => {
      applyThemeClass('dark');
    }).not.toThrow();
  });

  it("removes both `.dark` and `.light` for 'light' (paper is the :root default)", () => {
    root.classList.add('dark');
    root.classList.add('light');
    applyThemeClass('light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('light')).toBe(false);
  });

  it("adds `.dark` and removes `.light` for 'dark'", () => {
    root.classList.add('light');
    applyThemeClass('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
  });

  it('is idempotent when called with the same theme twice', () => {
    applyThemeClass('dark');
    applyThemeClass('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
    // Set-semantics: only one `dark` entry ever.
    expect(root.classList.toArray().filter((c: string) => c === 'dark')).toHaveLength(1);
  });

  it('flips cleanly between light and dark', () => {
    applyThemeClass('light');
    expect(root.classList.contains('dark')).toBe(false);
    applyThemeClass('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
    applyThemeClass('light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('light')).toBe(false);
  });
});
