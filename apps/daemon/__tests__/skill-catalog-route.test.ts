/**
 * `GET /api/skill-catalog` — the vendored `skills/` catalog.
 *
 * Follows the fixture-pinning approach `catalogs-route.test.ts` uses for
 * design-systems/craft-rules: an env var override points the route at a
 * throwaway directory so tests never depend on (or mutate) the real vendored
 * checkout, except for the one "the real checkout is actually served" test.
 */

import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SkillCatalogDetail, SkillCatalogResponse } from '@ligma/api';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../src/http';
import { REPO_ROOT } from '../src/paths';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-skill-catalog-'));
process.env.LIGMA_DATA_DIR = dataDir;

const {
  GET: getSkillCatalog,
  authoredSkillsRoot,
  skillCatalogRoot,
} = await import('../src/routes/skill-catalog/route');
const { syncSkillFile } = await import('../src/store/sync-commands');
const { stageSkills, stagedSkillsDir } = await import('../src/studio/skill-staging');

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

// ─── The authored overlay ────────────────────────────────────────────────────
//
// A skill the user authors is written to <DATA_DIR>/skills, never into the
// checkout and never into `WORKSPACE_ROOT/skills` (where `syncSkillFile` used
// to write, and where nothing ever read it back). The catalog serves the two
// roots as one, authored shadowing vendored.

describe('authored skills overlay', () => {
  const vendored = path.join(tmpdir(), `ligma-skills-vendored-${Date.now()}`);

  const skillMd = (id: string, description: string, body: string) =>
    ['---', `name: ${id}`, 'description: >', `  ${description}`, '---', '', body, ''].join('\n');

  beforeAll(async () => {
    await mkdir(path.join(vendored, 'brand-extract'), { recursive: true });
    await writeFile(
      path.join(vendored, 'brand-extract', 'SKILL.md'),
      skillMd('brand-extract', 'The vendored one.', '# vendored body'),
    );
  });

  afterEach(async () => {
    await rm(authoredSkillsRoot(), { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(vendored, { recursive: true, force: true });
  });

  it('writes an authored skill under DATA_DIR, not the checkout', async () => {
    await syncSkillFile({
      id: 'my-own-skill',
      name: 'My own skill',
      description: 'Authored here.',
      content: '# mine',
      agentIds: [],
      tags: [],
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    });

    expect(authoredSkillsRoot()).toBe(path.join(dataDir, 'skills'));
    const written = await readFile(
      path.join(dataDir, 'skills', 'my-own-skill', 'SKILL.md'),
      'utf-8',
    );
    expect(written).toContain('name: my-own-skill');
    // The vendored catalog in the checkout is untouched.
    expect(existsSync(path.join(REPO_ROOT, 'skills', 'my-own-skill'))).toBe(false);
  });

  it('lists authored and vendored skills as one catalog', async () => {
    process.env.LIGMA_SKILLS_DIR = vendored;
    await mkdir(path.join(authoredSkillsRoot(), 'my-own-skill'), { recursive: true });
    await writeFile(
      path.join(authoredSkillsRoot(), 'my-own-skill', 'SKILL.md'),
      skillMd('my-own-skill', 'Authored here.', '# mine'),
    );

    const body = (await (await skillCatalog()).json()) as SkillCatalogResponse;
    expect(body.skills.map((s) => s.id)).toEqual(['brand-extract', 'my-own-skill']);
  });

  it('an authored skill shadows a vendored one with the same id', async () => {
    process.env.LIGMA_SKILLS_DIR = vendored;
    await mkdir(path.join(authoredSkillsRoot(), 'brand-extract'), { recursive: true });
    await writeFile(
      path.join(authoredSkillsRoot(), 'brand-extract', 'SKILL.md'),
      skillMd('brand-extract', 'The authored one.', '# authored body'),
    );

    const body = (await (await skillCatalog()).json()) as SkillCatalogResponse;
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].description).toBe('The authored one.');

    const detail = (await (await skillCatalog('?id=brand-extract')).json()) as SkillCatalogDetail;
    expect(detail.body).toBe('# authored body');
  });

  it('stages the authored copy for an @mention', async () => {
    process.env.LIGMA_SKILLS_DIR = vendored;
    await mkdir(path.join(authoredSkillsRoot(), 'brand-extract'), { recursive: true });
    await writeFile(
      path.join(authoredSkillsRoot(), 'brand-extract', 'SKILL.md'),
      skillMd('brand-extract', 'The authored one.', '# authored body'),
    );

    const projectId = 'proj_overlay';
    const designId = 'dsn_overlay';
    const staged = await stageSkills(projectId, designId, ['brand-extract']);
    expect(staged).toEqual([{ id: 'brand-extract', files: ['SKILL.md'], truncated: false }]);
    const copied = await readFile(
      path.join(stagedSkillsDir(projectId, designId), 'brand-extract', 'SKILL.md'),
      'utf-8',
    );
    expect(copied).toContain('# authored body');
  });
});
