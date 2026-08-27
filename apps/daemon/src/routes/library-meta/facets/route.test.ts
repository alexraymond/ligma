import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * `skillCatalogRoot()` re-reads `LIGMA_SKILLS_DIR` on every call (a function,
 * not a cached constant), so — unlike the `DATA_DIR`-backed stores — this test
 * can point it at a fresh fixture per test with no import-order surprises.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let skillsDir: string;
let previous: string | undefined;

function writeSkill(id: string, frontmatter: string): void {
  const dir = path.join(skillsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\n${frontmatter}\n---\nBody prose, never scanned for facets.\n`,
  );
}

beforeEach(() => {
  previous = process.env.LIGMA_SKILLS_DIR;
  skillsDir = mkdtempSync(path.join(tmpdir(), 'ligma-skill-facets-'));
  process.env.LIGMA_SKILLS_DIR = skillsDir;
});

afterEach(() => {
  if (previous === undefined) delete process.env.LIGMA_SKILLS_DIR;
  else process.env.LIGMA_SKILLS_DIR = previous;
  rmSync(skillsDir, { recursive: true, force: true });
});

describe('GET /api/library-meta/facets', () => {
  it('returns nothing for an empty catalog', async () => {
    const { GET } = await import('./route');
    expect(await (await GET()).json()).toEqual({ skills: [] });
  });

  it('derives facets across a mix of frontmatter shapes, sorted by id', async () => {
    writeSkill('zzz-plain', 'name: zzz-plain\nod:\n  mode: prototype');
    writeSkill('card-twitter', 'name: card-twitter\ncategory: card\ntags: ["twitter", "quote"]');

    const { GET } = await import('./route');
    const body = (await (await GET()).json()) as { skills: unknown[] };
    expect(body.skills).toEqual([
      { id: 'card-twitter', mode: null, category: 'card', tags: ['twitter', 'quote'] },
      { id: 'zzz-plain', mode: 'prototype', category: null, tags: [] },
    ]);
  });

  it('skips a directory with no SKILL.md and a schema-prefixed entry', async () => {
    mkdirSync(path.join(skillsDir, 'not-a-skill'), { recursive: true });
    writeFileSync(path.join(skillsDir, 'not-a-skill', 'README.md'), '# not a skill');
    mkdirSync(path.join(skillsDir, '_schema'), { recursive: true });
    writeSkill('real-one', 'name: real-one');

    const { GET } = await import('./route');
    const body = (await (await GET()).json()) as { skills: Array<{ id: string }> };
    expect(body.skills.map((s) => s.id)).toEqual(['real-one']);
  });
});
