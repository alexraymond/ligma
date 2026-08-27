/**
 * The composer's pure logic: the submit gate, the request shape, and the
 * garnish added this wave (sub-chip prompt seeding, placeholder rotation).
 * DOM-free by design (see composer.ts's own docstring) — vitest covers this
 * without mounting `KickoffComposer`.
 */
import { describe, expect, it } from 'vitest';
import {
  type ComposerState,
  EMPTY_COMPOSER,
  PROJECT_KINDS,
  composerRequest,
  gateComposer,
  nextPlaceholderIndex,
  placeholdersForKind,
  seedPromptFromSubChip,
  starterPromptForKind,
  subChipsForKind,
} from './composer';

function state(overrides: Partial<ComposerState> = {}): ComposerState {
  return { ...EMPTY_COMPOSER, ...overrides };
}

describe('gateComposer', () => {
  it('requires a prompt in prompt mode', () => {
    expect(gateComposer(state())).toEqual({
      ok: false,
      missing: 'Prompt — describe the product you want built',
    });
  });

  it('requires an absolute repo path in adopt mode', () => {
    expect(gateComposer(state({ mode: 'adopt', repoPath: 'relative/path' }))).toEqual({
      ok: false,
      missing: 'Repo path — needs to be absolute, starting from the filesystem root',
    });
  });

  it('passes with a non-empty prompt', () => {
    expect(gateComposer(state({ prompt: 'Build a thing' }))).toEqual({ ok: true, missing: null });
  });
});

describe('composerRequest', () => {
  it('includes the kind only when one is chosen', () => {
    expect(composerRequest(state({ prompt: 'Build a thing' }))).toEqual({
      url: '/api/briefs',
      body: { prompt: 'Build a thing' },
    });
    expect(composerRequest(state({ prompt: 'Build a thing', kind: 'CLI tool' }))).toEqual({
      url: '/api/briefs',
      body: { prompt: 'Build a thing', kind: 'CLI tool' },
    });
  });

  it('includes a trimmed name only when the user typed one', () => {
    expect(composerRequest(state({ prompt: 'Build a thing', name: '  Shortlink  ' }))).toEqual({
      url: '/api/briefs',
      body: { prompt: 'Build a thing', name: 'Shortlink' },
    });
    expect(composerRequest(state({ prompt: 'Build a thing', name: '   ' }))).toEqual({
      url: '/api/briefs',
      body: { prompt: 'Build a thing' },
    });
  });
});

describe('subChipsForKind', () => {
  it('returns [] for no kind and for an unrecognised kind', () => {
    expect(subChipsForKind(null)).toEqual([]);
    expect(subChipsForKind('Not a kind')).toEqual([]);
  });

  it('has at least one chip for every project kind', () => {
    for (const kind of PROJECT_KINDS) {
      expect(subChipsForKind(kind).length).toBeGreaterThan(0);
    }
  });
});

describe('seedPromptFromSubChip', () => {
  const chip = { label: 'Dashboard', prompt: 'Build a dashboard.' };

  it('fills an empty prompt', () => {
    expect(seedPromptFromSubChip('', chip)).toBe('Build a dashboard.');
    expect(seedPromptFromSubChip('   ', chip)).toBe('Build a dashboard.');
  });

  it('never overwrites text the user already typed', () => {
    expect(seedPromptFromSubChip('Something else entirely', chip)).toBe('Something else entirely');
  });
});

describe('starterPromptForKind', () => {
  it('is null with no kind chosen', () => {
    expect(starterPromptForKind(null)).toBeNull();
  });

  it("matches the kind's first sub-chip prompt", () => {
    for (const kind of PROJECT_KINDS) {
      expect(starterPromptForKind(kind)).toBe(subChipsForKind(kind)[0]?.prompt);
    }
  });
});

describe('placeholdersForKind', () => {
  it('falls back to the default pool for no kind', () => {
    expect(placeholdersForKind(null).length).toBeGreaterThan(0);
  });

  it('has a dedicated pool for every project kind', () => {
    for (const kind of PROJECT_KINDS) {
      expect(placeholdersForKind(kind).length).toBeGreaterThan(0);
    }
  });
});

describe('nextPlaceholderIndex', () => {
  it('cycles back to 0 past the end of the pool', () => {
    expect(nextPlaceholderIndex(0, 3)).toBe(1);
    expect(nextPlaceholderIndex(2, 3)).toBe(0);
  });

  it('never divides by zero on an empty pool', () => {
    expect(nextPlaceholderIndex(0, 0)).toBe(0);
  });
});
