/**
 * `GET /api/craft-rules` — the vendored `craft/` rulebooks.
 *
 * Same read-only contract as the design-system catalog: GET only, no
 * caller-supplied string reaches a path unchecked. `?id=<slug>` narrows to one
 * rule; the slug is a bare `*.md` basename, so anything with a separator is
 * rejected before the filesystem is touched.
 *
 * Bodies ride along in the list response. The whole corpus is ~136 KB of
 * markdown over localhost, and shipping it once means selecting a rule in the
 * Library is instant instead of a round trip. ponytail: if `craft/` ever grows
 * past a megabyte, drop `body` from the list and let the detail pane fetch
 * `?id=`.
 *
 * README.md and FUTURE_SECTIONS.md are excluded for the same reason the studio
 * critic excludes them (`studio/critic.ts` → `craftRules`): they are the
 * directory's own documentation, not rules a design can be scored against.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CraftRule, CraftRulesResponse } from '@ligma/api';
import { type NextRequest, NextResponse } from '../../http';
import { craftDir } from '../../studio/craft';
import { isSafeSegment } from '../verification-runs/_lib';

/** The vendored rules root — one definition site, shared with the studio. */
export const craftRulesRoot = craftDir;

function isRuleFile(name: string): boolean {
  return name.endsWith('.md') && !name.startsWith('README') && !name.startsWith('FUTURE');
}

/**
 * Title and blurb from a rulebook's opening: the `# ` heading, then the first
 * paragraph under it. The list pane clamps the blurb with CSS rather than the
 * daemon guessing a length.
 */
export function parseRuleHeader(markdown: string): { title: string | null; blurb: string } {
  const lines = markdown.split('\n');
  let title: string | null = null;
  const paragraph: string[] = [];
  for (const line of lines) {
    if (title === null) {
      const heading = /^#\s+(.+)$/.exec(line);
      if (heading) title = heading[1].trim();
      continue;
    }
    const trimmed = line.trim();
    if (paragraph.length === 0) {
      // Skip the blank line(s) between heading and body; stop at any structure
      // that is not prose (a second heading, a list, a quote, a fence).
      if (trimmed === '') continue;
      if (/^[#>\-*`|]/.test(trimmed)) break;
      paragraph.push(trimmed);
      continue;
    }
    if (trimmed === '') break;
    paragraph.push(trimmed);
  }
  return { title, blurb: paragraph.join(' ') };
}

async function readRule(root: string, id: string): Promise<CraftRule | null> {
  let body: string;
  try {
    body = await readFile(path.join(root, `${id}.md`), 'utf-8');
  } catch {
    return null;
  }
  const header = parseRuleHeader(body);
  return { id, title: header.title ?? id, blurb: header.blurb, body };
}

async function list(root: string): Promise<CraftRulesResponse> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return { rules: [] };
  }
  const rules: CraftRule[] = [];
  // Sorted by id, not by filename: `.` sorts after `-`, so filename order puts
  // `typography.md` behind `typography-hierarchy.md` and the list pane reads
  // backwards.
  const ids = entries
    .filter(isRuleFile)
    .map((name) => name.replace(/\.md$/, ''))
    .sort();
  for (const id of ids) {
    const rule = await readRule(root, id);
    if (rule) rules.push(rule);
  }
  return { rules };
}

export async function GET(request: NextRequest): Promise<Response> {
  const root = craftRulesRoot();
  const id = request.nextUrl.searchParams.get('id');
  const headers = { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' };

  if (id === null) {
    return NextResponse.json(await list(root), { headers });
  }
  if (!isSafeSegment(id) || !isRuleFile(`${id}.md`)) {
    return NextResponse.json({ error: 'Invalid craft rule id' }, { status: 400 });
  }
  const rule = await readRule(root, id);
  if (!rule) {
    return NextResponse.json({ error: `Craft rule not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(rule, { headers });
}
