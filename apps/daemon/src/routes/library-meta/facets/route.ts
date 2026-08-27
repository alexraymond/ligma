import { readFile, readdir, stat } from 'node:fs/promises';
/**
 * `GET /api/library-meta/facets` — the vendored skill catalog's structured
 * facets (OD-007). See `../facets.ts` for what frontmatter fields exist and
 * why design systems and craft rules need no equivalent route.
 *
 * Reuses `skillRoots()` from `skill-catalog/route.ts` rather than re-deriving
 * the skills paths — that file owns both the vendored root override
 * (`LIGMA_SKILLS_DIR`) and the authored root under DATA_DIR, and this route
 * must resolve the exact same directories it lists, or the two could disagree
 * about which `skills/<id>` exists.
 */
import path from 'node:path';
import type { SkillFacetEntry, SkillFacetsResponse } from '@ligma/api';
import { parseFrontmatter } from '@ligma/core/skills';
import { NextResponse } from '../../../http';
import { skillRoots } from '../../skill-catalog/route';
import { isSafeSegment } from '../../verification-runs/_lib';
import { deriveSkillFacet } from '../facets';

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function listRoot(root: string, into: Map<string, SkillFacetEntry>): Promise<void> {
  let ids: string[];
  try {
    ids = await readdir(root);
  } catch {
    return;
  }
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
    into.set(id, deriveSkillFacet(id, frontmatter));
  }
}

/** Same overlay the catalog route lists: vendored first, authored shadowing. */
async function list(): Promise<SkillFacetEntry[]> {
  const merged = new Map<string, SkillFacetEntry>();
  for (const root of skillRoots()) await listRoot(root, merged);
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function GET(): Promise<Response> {
  const body: SkillFacetsResponse = { skills: await list() };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
  });
}
