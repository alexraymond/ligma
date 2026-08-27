/**
 * The Library's two catalog routes.
 *
 * The properties worth holding: the vendored directories are served as they
 * are on disk (no invented metadata), a package with no `components.html` says
 * so rather than pretending — the Library falls back to a token specimen — and
 * nothing a caller sends is joined onto a path without being checked, whether
 * it arrives as `?id=` or as a path inside a package's own manifest.
 */

import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  CraftRule,
  CraftRulesResponse,
  DesignSystemDetail,
  DesignSystemsResponse,
} from '@ligma/api';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../src/http';

// Pin the store to a throwaway dir BEFORE importing anything that resolves
// paths at module load — the used-by scan must never write into the real
// data/projects/ (same fix as the studio suites).
const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-catalogs-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { CENTRAL_PROJECTS_DIR } = await import('../src/paths');
const {
  GET: getDesignSystems,
  parseDesignHeader,
  parseSwatches,
} = await import('../src/routes/design-systems/route');
const { GET: getCraftRules, parseRuleHeader } = await import('../src/routes/craft-rules/route');
const { createDesign } = await import('../src/studio/store');

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function designSystems(query = ''): Promise<Response> {
  return Promise.resolve(
    getDesignSystems(new DaemonRequest(`http://127.0.0.1/api/design-systems${query}`)),
  );
}

function craftRules(query = ''): Promise<Response> {
  return Promise.resolve(
    getCraftRules(new DaemonRequest(`http://127.0.0.1/api/craft-rules${query}`)),
  );
}

afterEach(() => {
  delete process.env.LIGMA_DESIGN_SYSTEMS_DIR;
  delete process.env.LIGMA_CRAFT_DIR;
});

// ─── Design systems: the vendored catalog ────────────────────────────────────

describe('GET /api/design-systems — list', () => {
  it('lists every vendored package with the metadata a picker needs', async () => {
    const response = await designSystems();
    expect(response.status).toBe(200);
    const body = (await response.json()) as DesignSystemsResponse;

    expect(body.systems.length).toBeGreaterThan(10);
    const claude = body.systems.find((s) => s.id === 'claude');
    expect(claude).toBeDefined();
    expect(claude!.name).toBe('Claude (Anthropic)');
    expect(claude!.category).toBe('AI & LLM');
    // The blurb comes from DESIGN.md, not the manifest's boilerplate.
    expect(claude!.blurb).toContain('terracotta');
    expect(claude!.blurb).not.toContain('Bundled Open Design package');
    expect(claude!.swatches.accent).toBe('#c96442');
    expect(claude!.hasPreview).toBe(true);
  });

  it('skips `_schema/` — a contract directory is not a package', async () => {
    const body = (await (await designSystems()).json()) as DesignSystemsResponse;
    expect(body.systems.map((s) => s.id)).not.toContain('_schema');
  });

  it('returns ids in sorted order', async () => {
    const body = (await (await designSystems()).json()) as DesignSystemsResponse;
    const ids = body.systems.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('carries no design or token bodies — the list feeds a popover', async () => {
    const body = (await (await designSystems()).json()) as DesignSystemsResponse;
    expect(body.systems[0]).not.toHaveProperty('design');
    expect(body.systems[0]).not.toHaveProperty('tokensCss');
  });
});

describe('GET /api/design-systems?id= — detail', () => {
  it('serves the triad plus the live-preview document', async () => {
    const response = await designSystems('?id=claude');
    expect(response.status).toBe(200);
    const body = (await response.json()) as DesignSystemDetail;

    expect(body.design).toContain('# Design System Inspired by Claude');
    expect(body.tokensCss).toContain('--accent: #c96442');
    expect(body.preview).toContain('<!doctype html>');
    expect(body.previewPages.map((p) => p.role)).toContain('colors');
  });

  it('404s an unknown id rather than serving an empty package', async () => {
    const response = await designSystems('?id=not-a-real-system');
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain('not-a-real-system');
  });

  it('rejects a traversal id before touching the filesystem', async () => {
    for (const attempt of ['../../etc', '..%2F..%2Fpackage.json', 'a/b', '..', '%2e%2e%2f']) {
      const response = await designSystems(`?id=${attempt}`);
      expect(response.status, attempt).toBe(400);
    }
  });
});

// ─── Design systems: fixture roots ───────────────────────────────────────────

describe('design systems — packages without a preview', () => {
  const root = path.join(tmpdir(), `ligma-ds-fixture-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(path.join(root, 'bare'), { recursive: true });
    await writeFile(
      path.join(root, 'bare', 'manifest.json'),
      JSON.stringify({ id: 'bare', name: 'Bare', category: 'Starter' }),
    );
    await writeFile(
      path.join(root, 'bare', 'DESIGN.md'),
      '# Bare\n\n> Category: Starter\n> Nothing but tokens.\n',
    );
    await writeFile(
      path.join(root, 'bare', 'tokens.css'),
      ':root {\n  --bg: #ffffff;\n  --accent: #ff0000;\n}\n',
    );

    // A manifest pointing outside its own directory must yield no pages.
    await mkdir(path.join(root, 'escapee'), { recursive: true });
    await writeFile(
      path.join(root, 'escapee', 'manifest.json'),
      JSON.stringify({
        id: 'escapee',
        name: 'Escapee',
        category: 'Starter',
        preview: { pages: [{ path: '../../../package.json', role: 'colors', title: 'Colors' }] },
      }),
    );
    await writeFile(path.join(root, 'escapee', 'DESIGN.md'), '# Escapee\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports hasPreview=false and a null preview document', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    const summary = (await (await designSystems()).json()) as DesignSystemsResponse;
    expect(summary.systems.find((s) => s.id === 'bare')!.hasPreview).toBe(false);

    const body = (await (await designSystems('?id=bare')).json()) as DesignSystemDetail;
    expect(body.preview).toBeNull();
    // The specimen fallback's only input still arrives.
    expect(body.tokensCss).toContain('--accent: #ff0000');
    expect(body.swatches.accent).toBe('#ff0000');
  });

  it('drops a manifest-declared preview path that escapes the package', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    const body = (await (await designSystems('?id=escapee')).json()) as DesignSystemDetail;
    expect(body.previewPages).toEqual([]);
  });

  it('returns an empty catalog when the directory is absent, never a 500', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = path.join(root, 'nope');
    const response = await designSystems();
    expect(response.status).toBe(200);
    expect(((await response.json()) as DesignSystemsResponse).systems).toEqual([]);
  });
});

// ─── Design systems: what this made ──────────────────────────────────────────

describe('design system detail — usedBy', () => {
  const projectId = `test_catalog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let designId = '';

  beforeAll(async () => {
    const design = await createDesign({
      projectId,
      title: 'Landing',
      prompt: 'p',
      designSystem: 'claude',
    });
    designId = design.id;
  });

  afterAll(async () => {
    await rm(path.join(CENTRAL_PROJECTS_DIR, projectId), { recursive: true, force: true });
  });

  it('links back to the design sessions drawn with this system', async () => {
    const body = (await (await designSystems('?id=claude')).json()) as DesignSystemDetail;
    const use = body.usedBy.find((u) => u.designId === designId);
    expect(use).toBeDefined();
    expect(use!.projectId).toBe(projectId);
    expect(use!.title).toBe('Landing');
    expect(use!.status).toBe('drafting');
  });

  it('does not attribute a design to a system it did not use', async () => {
    const body = (await (await designSystems('?id=minimal')).json()) as DesignSystemDetail;
    expect(body.usedBy.some((u) => u.designId === designId)).toBe(false);
  });
});

// ─── Craft rules ─────────────────────────────────────────────────────────────

describe('GET /api/craft-rules', () => {
  it('lists the vendored rulebooks with their markdown bodies', async () => {
    const response = await craftRules();
    expect(response.status).toBe(200);
    const body = (await response.json()) as CraftRulesResponse;

    const color = body.rules.find((r) => r.id === 'color');
    expect(color).toBeDefined();
    expect(color!.title).toBe('Color craft rules');
    expect(color!.blurb).toContain('Universal color rules');
    expect(color!.body).toContain('## Palette structure');
  });

  it("excludes the directory's own documentation", async () => {
    const body = (await (await craftRules()).json()) as CraftRulesResponse;
    const ids = body.rules.map((r) => r.id);
    expect(ids).not.toContain('README');
    expect(ids).not.toContain('FUTURE_SECTIONS');
    expect(ids).toEqual([...ids].sort());
  });

  it('serves one rule by id', async () => {
    const response = await craftRules('?id=anti-ai-slop');
    expect(response.status).toBe(200);
    const rule = (await response.json()) as CraftRule;
    expect(rule.id).toBe('anti-ai-slop');
    expect(rule.body.length).toBeGreaterThan(100);
  });

  it('404s an unknown rule and 400s a traversal or excluded id', async () => {
    expect((await craftRules('?id=not-a-rule')).status).toBe(404);
    for (const attempt of ['../package', 'a/b', '..', 'README', 'FUTURE_SECTIONS']) {
      expect((await craftRules(`?id=${encodeURIComponent(attempt)}`)).status, attempt).toBe(400);
    }
  });

  it('returns an empty list when the directory is absent', async () => {
    process.env.LIGMA_CRAFT_DIR = path.join(tmpdir(), `ligma-craft-missing-${Date.now()}`);
    const response = await craftRules();
    expect(response.status).toBe(200);
    expect(((await response.json()) as CraftRulesResponse).rules).toEqual([]);
  });
});

// ─── Parsers ─────────────────────────────────────────────────────────────────

describe('catalog metadata parsing', () => {
  it('reads category and a wrapped summary out of the DESIGN.md header', () => {
    const parsed = parseDesignHeader(
      '# Neutral Modern\n\n> Category: Starter\n> A clean default. Use when the\n> brief is quiet.\n\n## Theme\nbody\n',
    );
    expect(parsed.category).toBe('Starter');
    expect(parsed.blurb).toBe('A clean default. Use when the brief is quiet.');
  });

  it('survives a DESIGN.md with no header blockquote', () => {
    expect(parseDesignHeader('# Bare\n\nJust prose.\n')).toEqual({ category: null, blurb: '' });
  });

  it('takes :root swatch values, not a later dark-mode override', () => {
    const css =
      ':root {\n  --bg: #fff;\n  --bg-2: #eee;\n  --accent: #f00;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --bg: #000; }\n}';
    const swatches = parseSwatches(css);
    expect(swatches.bg).toBe('#fff');
    expect(swatches.accent).toBe('#f00');
    expect(swatches.surface).toBeUndefined();
  });

  it("reads a craft rule's title and opening paragraph", () => {
    const parsed = parseRuleHeader(
      '# Color craft rules\n\nUniversal color rules applied\non top of DESIGN.md.\n\n> Adapted from elsewhere.\n',
    );
    expect(parsed.title).toBe('Color craft rules');
    expect(parsed.blurb).toBe('Universal color rules applied on top of DESIGN.md.');
  });

  it('leaves the blurb empty when the rulebook opens with structure', () => {
    expect(parseRuleHeader('# Rules\n\n- one\n- two\n').blurb).toBe('');
  });
});
