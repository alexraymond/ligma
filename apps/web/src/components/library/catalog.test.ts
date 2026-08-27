/**
 * The Library's pure state and its two catalog fetches.
 *
 * The properties worth holding: filtering searches everything a row shows (not
 * just its name — a catalog you have to know the names of is a list, not a
 * catalog), arrow-key movement stops at the ends rather than wrapping, a
 * narrowing filter can never leave the detail pane on a row that is gone, and a
 * package with no `components.html` still previews — from its own tokens.
 */

import type { DesignSystemSummary } from '@ligma/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCraftRules,
  fetchDesignSystem,
  fetchDesignSystems,
  fetchSkillCatalog,
  fetchSkillCatalogEntry,
  filterEntries,
  moveSelection,
  previewIsAuthored,
  previewSrcdoc,
  rankByUse,
  reconcileSelection,
  specimenSrcdoc,
} from './catalog';

const ENTRIES = [
  { id: 'claude', label: 'Claude (Anthropic)', meta: 'AI & LLM', blurb: 'Warm terracotta accent.' },
  {
    id: 'mono',
    label: 'Mono',
    meta: 'Modern & Minimal',
    blurb: 'Monospace-driven, matrix-inspired.',
  },
  {
    id: 'paper',
    label: 'Paper',
    meta: 'Retro & Nostalgic',
    blurb: 'Print-inspired, tactile surfaces.',
  },
];

const IDS = ENTRIES.map((entry) => entry.id);

describe('filterEntries', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterEntries(ENTRIES, '')).toHaveLength(3);
    expect(filterEntries(ENTRIES, '   ')).toHaveLength(3);
  });

  it('matches the label, case-insensitively', () => {
    expect(filterEntries(ENTRIES, 'CLAUDE').map((e) => e.id)).toEqual(['claude']);
  });

  it('matches the category and the blurb, not just the name', () => {
    expect(filterEntries(ENTRIES, 'nostalgic').map((e) => e.id)).toEqual(['paper']);
    expect(filterEntries(ENTRIES, 'terracotta').map((e) => e.id)).toEqual(['claude']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterEntries(ENTRIES, 'brutalism')).toEqual([]);
  });

  it('tolerates rows with no meta or blurb', () => {
    expect(filterEntries([{ id: 'a', label: 'Alpha' }], 'alpha')).toHaveLength(1);
  });
});

describe('moveSelection', () => {
  it('steps forward and back', () => {
    expect(moveSelection(IDS, 'claude', 1)).toBe('mono');
    expect(moveSelection(IDS, 'mono', -1)).toBe('claude');
  });

  it('clamps at both ends rather than wrapping', () => {
    expect(moveSelection(IDS, 'paper', 1)).toBe('paper');
    expect(moveSelection(IDS, 'claude', -1)).toBe('claude');
  });

  it('starts at the first row from no selection or an unknown one', () => {
    expect(moveSelection(IDS, null, 1)).toBe('claude');
    expect(moveSelection(IDS, 'gone', -1)).toBe('claude');
  });

  it('has nothing to select in an empty list', () => {
    expect(moveSelection([], 'claude', 1)).toBeNull();
  });
});

describe('rankByUse', () => {
  it('sorts most-used first', () => {
    const ranked = rankByUse(ENTRIES, { claude: 1, mono: 5, paper: 2 });
    expect(ranked.map((e) => e.id)).toEqual(['mono', 'paper', 'claude']);
  });

  it('leaves an all-zero (never-used) catalog in its original order — a stable sort with nothing to rank by', () => {
    expect(rankByUse(ENTRIES, {}).map((e) => e.id)).toEqual(IDS);
  });

  it('does not mutate the input array', () => {
    const copy = [...ENTRIES];
    rankByUse(ENTRIES, { paper: 9 });
    expect(ENTRIES).toEqual(copy);
  });

  it('treats an id missing from the counts as zero uses', () => {
    const ranked = rankByUse(ENTRIES, { mono: 3 });
    expect(ranked[0].id).toBe('mono');
  });
});

describe('reconcileSelection', () => {
  it('keeps a selection that survives the filter', () => {
    expect(reconcileSelection(IDS, 'mono')).toBe('mono');
  });

  it('falls to the first row when the selection is filtered away', () => {
    expect(reconcileSelection(['mono', 'paper'], 'claude')).toBe('mono');
    expect(reconcileSelection(IDS, null)).toBe('claude');
  });

  it('selects nothing when the list is empty', () => {
    expect(reconcileSelection([], 'claude')).toBeNull();
  });
});

describe('live preview', () => {
  it("renders the package's own document when it ships one", () => {
    const detail = { preview: '<!doctype html><p>authored</p>', tokensCss: ':root{--bg:#fff}' };
    expect(previewSrcdoc(detail)).toBe(detail.preview);
    expect(previewIsAuthored(detail)).toBe(true);
  });

  it("falls back to a specimen carrying the package's tokens", () => {
    const detail = { preview: null, tokensCss: ':root{--accent:#ff0000}' };
    const doc = previewSrcdoc(detail);
    expect(previewIsAuthored(detail)).toBe(false);
    expect(doc).toContain(':root{--accent:#ff0000}');
    // The specimen must actually consume the tokens, not just embed them.
    expect(doc).toContain('var(--accent');
    expect(doc).toContain('var(--bg');
    expect(doc).toContain('<button');
  });

  it('builds a complete document, so the iframe has nothing to guess', () => {
    expect(specimenSrcdoc('').startsWith('<!doctype html>')).toBe(true);
    expect(specimenSrcdoc('')).toContain('</html>');
  });
});

// ─── Fetches ─────────────────────────────────────────────────────────────────

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

describe('catalog fetches', () => {
  const summary: DesignSystemSummary = {
    id: 'claude',
    name: 'Claude (Anthropic)',
    category: 'AI & LLM',
    blurb: 'Warm terracotta accent.',
    swatches: { accent: '#c96442' },
    hasPreview: true,
    authored: false,
  };

  it('unwraps the design-system list envelope', async () => {
    const fetchMock = stubFetch(200, { systems: [summary] });
    await expect(fetchDesignSystems()).resolves.toEqual([summary]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/design-systems');
  });

  it('asks for one design system by id, url-encoded', async () => {
    const fetchMock = stubFetch(200, {
      ...summary,
      design: '',
      tokensCss: '',
      preview: null,
      previewPages: [],
      usedBy: [],
    });
    await fetchDesignSystem('warm editorial');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/design-systems?id=warm%20editorial');
  });

  it("surfaces the daemon's error message on a 404", async () => {
    stubFetch(404, { error: 'Design system not found: nope' });
    await expect(fetchDesignSystem('nope')).rejects.toThrow('Design system not found: nope');
  });

  it('falls back to the status code when the body carries no message', async () => {
    stubFetch(400, {});
    await expect(fetchCraftRules()).rejects.toThrow('(400)');
  });

  it('unwraps the craft-rule list envelope', async () => {
    const rules = [
      { id: 'color', title: 'Color craft rules', blurb: '…', body: '# Color craft rules' },
    ];
    const fetchMock = stubFetch(200, { rules });
    await expect(fetchCraftRules()).resolves.toEqual(rules);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/craft-rules');
  });

  // The vendored skills/ catalog (OD-077) — a sibling to /api/skills (the
  // unrelated, pre-existing user-authored skill library), so it rides its own
  // /api/skill-catalog path.
  it('unwraps the skill-catalog list envelope', async () => {
    const skills = [
      { id: 'brand-extract', title: 'brand-extract', description: 'Extract a brand kit.' },
    ];
    const fetchMock = stubFetch(200, { skills });
    await expect(fetchSkillCatalog()).resolves.toEqual(skills);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/skill-catalog');
  });

  it('asks for one vendored skill by id, url-encoded', async () => {
    const fetchMock = stubFetch(200, {
      id: 'brand extract',
      title: 'brand extract',
      description: '',
      body: '',
      files: [],
    });
    await fetchSkillCatalogEntry('brand extract');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/skill-catalog?id=brand%20extract');
  });
});
