/**
 * `GET /api/skill-catalog` — the vendored `skills/` catalog.
 *
 * Follows the fixture-pinning approach `catalogs-route.test.ts` uses for
 * design-systems/craft-rules: an env var override points the route at a
 * throwaway directory so tests never depend on (or mutate) the real vendored
 * checkout, except for the one "the real checkout is actually served" test.
 */

import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SkillCatalogDetail, SkillCatalogResponse } from '@ligma/api';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../src/http';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-skill-catalog-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { GET: getSkillCatalog, skillCatalogRoot } = await import(
  '../src/routes/skill-catalog/route'
);

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function skillCatalog(query = ''): Promise<Response> {
  return Promise.resolve(
    getSkillCatalog(new DaemonRequest(`http://127.0.0.1/api/skill-catalog${query}`)),
  );
}

afterEach(() => {
  delete process.env.LIGMA_SKILLS_DIR;
});

// ─── The real vendored catalog ───────────────────────────────────────────────

describe('GET /api/skill-catalog — the real checkout', () => {
  it('lists every vendored skill (136 dirs at time of writing)', async () => {
    const response = await skillCatalog();
    expect(response.status).toBe(200);
    const body = (await response.json()) as SkillCatalogResponse;
    expect(body.skills.length).toBeGreaterThan(100);

    const hig = body.skills.find((s) => s.id === 'apple-hig');
    expect(hig).toBeDefined();
    expect(hig!.title).toBe('apple-hig');
    expect(hig!.description).toContain('Apple Human Interface Guidelines');
  });

  it('returns ids in sorted order', async () => {
    const body = (await (await skillCatalog()).json()) as SkillCatalogResponse;
    const ids = body.skills.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('excludes LICENSE/README.md/AGENTS.md — files beside the packages, not one', async () => {
    const body = (await (await skillCatalog()).json()) as SkillCatalogResponse;
    const ids = body.skills.map((s) => s.id);
    expect(ids).not.toContain('LICENSE');
    expect(ids).not.toContain('README');
    expect(ids).not.toContain('AGENTS');
  });

  it("serves one skill's body by id, ignoring sibling non-SKILL.md files", async () => {
    // Several real packages (e.g. article-magazine) ship an example.md
    // alongside SKILL.md with no frontmatter of its own — it must never be
    // mistaken for the skill's metadata or crash the detail read.
    const response = await skillCatalog('?id=article-magazine');
    expect(response.status).toBe(200);
    const detail = (await response.json()) as SkillCatalogDetail;
    expect(detail.id).toBe('article-magazine');
    expect(detail.body.length).toBeGreaterThan(0);
  });
});

// ─── Fixture root ─────────────────────────────────────────────────────────────

describe('GET /api/skill-catalog — fixture root', () => {
  const root = path.join(tmpdir(), `ligma-skills-fixture-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(path.join(root, 'brand-extract'), { recursive: true });
    await writeFile(
      path.join(root, 'brand-extract', 'SKILL.md'),
      [
        '---',
        'name: brand-extract',
        'description: Extract a brand kit from a live website.',
        '---',
        '',
        '# brand-extract',
        '',
        'Body content here.',
        '',
      ].join('\n'),
    );
    await mkdir(path.join(root, 'brand-extract', 'templates'), { recursive: true });
    await writeFile(
      path.join(root, 'brand-extract', 'templates', 'brand-kit.html'),
      '<html></html>',
    );

    // A directory with no SKILL.md is not a skill.
    await mkdir(path.join(root, 'not-a-skill'), { recursive: true });
    await writeFile(path.join(root, 'not-a-skill', 'notes.md'), 'just notes');

    // Files beside the packages, not inside one.
    await writeFile(path.join(root, 'README.md'), '# skills catalog');
    await writeFile(path.join(root, 'LICENSE'), 'MIT');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists only the directory with a SKILL.md', async () => {
    process.env.LIGMA_SKILLS_DIR = root;
    const body = (await (await skillCatalog()).json()) as SkillCatalogResponse;
    expect(body.skills).toEqual([
      {
        id: 'brand-extract',
        title: 'brand-extract',
        description: 'Extract a brand kit from a live website.',
      },
    ]);
  });

  it('serves the body and the file list on detail', async () => {
    process.env.LIGMA_SKILLS_DIR = root;
    const body = (await (await skillCatalog('?id=brand-extract')).json()) as SkillCatalogDetail;
    expect(body.body).toContain('Body content here.');
    expect(body.body).not.toContain('---'); // frontmatter stripped
    expect(body.files).toEqual(['templates/brand-kit.html']);
  });

  it('404s an unknown id and a directory with no SKILL.md', async () => {
    process.env.LIGMA_SKILLS_DIR = root;
    expect((await skillCatalog('?id=not-a-real-skill')).status).toBe(404);
    expect((await skillCatalog('?id=not-a-skill')).status).toBe(404);
  });

  it('rejects a traversal id before touching the filesystem', async () => {
    process.env.LIGMA_SKILLS_DIR = root;
    for (const attempt of ['../../etc', '..%2F..%2Fpackage.json', 'a/b', '..', '%2e%2e%2f']) {
      const response = await skillCatalog(`?id=${attempt}`);
      expect(response.status, attempt).toBe(400);
    }
  });

  it('returns an empty catalog when the directory is absent, never a 500', async () => {
    process.env.LIGMA_SKILLS_DIR = path.join(root, 'nope');
    const response = await skillCatalog();
    expect(response.status).toBe(200);
    expect(((await response.json()) as SkillCatalogResponse).skills).toEqual([]);
  });
});

describe('skillCatalogRoot()', () => {
  it('defaults to <repo>/skills and honours LIGMA_SKILLS_DIR', () => {
    delete process.env.LIGMA_SKILLS_DIR;
    expect(skillCatalogRoot()).toMatch(/skills$/);
    process.env.LIGMA_SKILLS_DIR = '/tmp/custom-skills';
    expect(skillCatalogRoot()).toBe('/tmp/custom-skills');
    delete process.env.LIGMA_SKILLS_DIR;
  });
});
