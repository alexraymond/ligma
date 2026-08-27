/**
 * `GET /api/skill-catalog` — the vendored `skills/` catalog (OD-077: 136
 * dirs, each a `SKILL.md` with YAML frontmatter, vendored alongside
 * `design-systems/` and `craft/`).
 *
 * Named `skill-catalog`, not `skills`: `apps/daemon/src/routes/skills/route.ts`
 * already serves `/api/skills`, an unrelated pre-existing feature (the
 * user-authored `SkillDefinition` library agents are given). Reusing that path
 * would either collide with or silently repurpose a shipped feature, so this
 * is a sibling route — same shape as `craft-rules` and `design-systems`.
 *
 * Same read-only contract as those two: GET only, `?id=` is a bare directory
 * name checked with `isSafeSegment` before it ever reaches the filesystem, and
 * only `skills/<id>/SKILL.md` is read for metadata — never every `*.md` in the
 * directory, because several packages also carry an `example.md` or
 * `README.md` that isn't meant to be parsed as a skill (see fixtures in the
 * test file). Frontmatter parsing reuses `@ligma/core`'s `parseFrontmatter`
 * (the same inline YAML parser `packages/core/src/skills/loader.ts` already
 * uses to load skills) rather than re-deriving one — we only need `name` and
 * `description`, so `SkillFrontmatterV1`'s stricter zod schema (trigger
 * arrays, tool allowlists, etc.) is not applied here.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SkillCatalogDetail, SkillCatalogEntry, SkillCatalogResponse } from '@ligma/api';
import { parseFrontmatter } from '@ligma/core/skills';
import { type NextRequest, NextResponse } from '../../http';
import { REPO_ROOT, dataRootInfo } from '../../paths';
import { isSafeSegment } from '../verification-runs/_lib';

/** The vendored catalog root. Overridable so tests can point at a fixture. */
export function skillCatalogRoot(): string {
  return process.env.LIGMA_SKILLS_DIR
    ? path.resolve(process.env.LIGMA_SKILLS_DIR)
    : path.join(REPO_ROOT, 'skills');
}

/**
 * Where user-authored skills are written (`store/sync-commands.ts`).
 *
 * Store data, so it follows DATA_DIR and gets no knob of its own — the same
 * split `design-systems/route.ts` already makes between the vendored catalog
 * and `authoredDesignSystemsRoot()`. The vendored tree is read-only, tracked
 * content of the checkout; a skill the user authors is theirs and belongs in
 * their store.
 */
export function authoredSkillsRoot(): string {
  return path.join(dataRootInfo().path, 'skills');
}

/**
 * Both roots, lowest priority first — authored shadows vendored on a shared id,
 * matching `loadAllSkills()`'s project > user > builtin merge.
 */
export function skillRoots(): string[] {
  return [skillCatalogRoot(), authoredSkillsRoot()];
}

/** Which root holds `<id>`, authored first. null when neither does. */
export async function rootForSkill(id: string): Promise<string | null> {
  for (const root of [...skillRoots()].reverse()) {
    if (await isDirectory(path.join(root, id))) return root;
  }
  return null;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function readSkillMd(dir: string): Promise<string | null> {
  try {
    return await readFile(path.join(dir, 'SKILL.md'), 'utf-8');
  } catch {
    return null;
  }
}

function summarise(id: string, raw: string): SkillCatalogEntry {
  const { frontmatter } = parseFrontmatter(raw);
  const name =
    typeof frontmatter.name === 'string' && frontmatter.name.trim() ? frontmatter.name.trim() : id;
  const description =
    typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  return { id, title: name, description };
}

/** Every other file the package ships, relative to its own directory. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(sub: string, prefix: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(sub);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (prefix === '' && name === 'SKILL.md') continue;
      const full = path.join(sub, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (await isDirectory(full)) {
        await walk(full, rel);
      } else {
        out.push(rel);
      }
    }
  }
  await walk(dir, '');
  return out;
}

async function listRoot(root: string, into: Map<string, SkillCatalogEntry>): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const id of entries.sort()) {
    // `LICENSE`, `README.md`, `AGENTS.md` sit beside the packages, not inside
    // one; `_`/`.`-prefixed entries mirror the schema-directory convention the
    // other catalogs already exclude.
    if (id.startsWith('_') || id.startsWith('.')) continue;
    if (!isSafeSegment(id)) continue;
    const dir = path.join(root, id);
    if (!(await isDirectory(dir))) continue;
    const raw = await readSkillMd(dir);
    if (raw === null) continue;
    into.set(id, summarise(id, raw));
  }
}

/** Vendored ∪ authored, by id — later root wins, so authored shadows vendored. */
async function list(): Promise<SkillCatalogResponse> {
  const merged = new Map<string, SkillCatalogEntry>();
  for (const root of skillRoots()) await listRoot(root, merged);
  return { skills: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

async function detail(root: string, id: string): Promise<SkillCatalogDetail | null> {
  const dir = path.join(root, id);
  const raw = await readSkillMd(dir);
  if (raw === null) return null;
  const { body } = parseFrontmatter(raw);
  return { ...summarise(id, raw), body: body.trim(), files: await listFiles(dir) };
}

export async function GET(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get('id');
  const headers = { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' };

  if (id === null) {
    return NextResponse.json(await list(), { headers });
  }
  // A traversal attempt is rejected before it ever reaches the filesystem —
  // ids are bare directory names, so anything with a separator is invalid.
  if (!isSafeSegment(id)) {
    return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 });
  }
  const root = await rootForSkill(id);
  const found = root === null ? null : await detail(root, id);
  if (!found) {
    return NextResponse.json({ error: `Skill not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(found, { headers });
}
