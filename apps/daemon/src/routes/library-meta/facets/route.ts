import { readFile, readdir, stat } from 'node:fs/promises';
/**
 * `GET /api/library-meta/facets` — the vendored skill catalog's structured
 * facets (OD-007). See `../facets.ts` for what frontmatter fields exist and
 * why design systems and craft rules need no equivalent route.
 *
 * Reuses `skillCatalogRoot()` from `skill-catalog/route.ts` rather than
 * re-deriving the vendored-skills path — that file owns the root override
 * (`LIGMA_SKILLS_DIR`) and this route must resolve the exact same directory it
 * lists, or the two could disagree about which `skills/<id>` exists.
 */
import path from 'node:path';
import type { SkillFacetEntry, SkillFacetsResponse } from '@ligma/api';
import { parseFrontmatter } from '@ligma/core/skills';
import { NextResponse } from '../../../http';
import { skillCatalogRoot } from '../../skill-catalog/route';
import { isSafeSegment } from '../../verification-runs/_lib';
import { deriveSkillFacet } from '../facets';

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function list(root: string): Promise<SkillFacetEntry[]> {
  let ids: string[];
  try {
    ids = await readdir(root);
  } catch {
    return [];
  }
  const skills: SkillFacetEntry[] = [];
  for (const id of ids.sort()) {
    if (id.startsWith('_') || id.startsWith('.')) continue;
    if (!isSafeSegment(id)) continue;
    const dir = path.join(root, id);
    if (!(await isDirectory(dir))) continue;
    let raw: string;
    try {
      raw = await readFile(path.join(dir, 'SKILL.md'), 'utf-8');
    } catch {
      continue;
    }
    const { frontmatter } = parseFrontmatter(raw);
    skills.push(deriveSkillFacet(id, frontmatter));
  }
  return skills;
}

export async function GET(): Promise<Response> {
  const body: SkillFacetsResponse = { skills: await list(skillCatalogRoot()) };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
  });
}
