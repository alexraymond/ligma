/**
 * `@skill-name` in the composer, staged as a frozen copy the turn can read.
 *
 * Two decisions worth the words:
 *
 * **Why a copy at all.** The vendored `skills/` tree is shared by every design
 * in every project and is edited by whoever maintains it. A turn that read it
 * live would be reading a moving target — the same prompt on Monday and Friday
 * would be two different turns with no record of why. Copying the mentioned
 * skills into the design's own directory when the turn starts makes the input
 * a snapshot, the same reason `blobs/` exists for the output.
 *
 * **Why not inside `src/`.** Same rule as `attachments.ts`: `snapshots.ts`
 * walks `src/` and everything it finds becomes a version file and a card on the
 * Wall. The staging dir is a sibling, and the generation agent reaches it
 * through one read-only tool (`read_staged_skill` in `tools.ts`) rather than
 * through `read_file`, so the design source and the reference material cannot
 * be confused for one another in either direction.
 *
 * A mention that names nothing is inert — no error, no prompt line. People type
 * `@` at each other all day and the composer is a text box, not a form.
 */

import type { Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { skillCatalogRoot } from '../routes/skill-catalog/route';
import { designDir, resolveInsideRoot } from './paths';

/**
 * Total bytes copied per turn, across every mentioned skill.
 *
 * A skill package can carry reference PDFs and sample corpora; the SKILL.md
 * that carries the actual instruction is a few kilobytes. The cap is generous
 * for the latter and refuses to be a file-copy service for the former.
 */
export const MAX_STAGED_BYTES = 256_000;

/** Mentions honoured per turn. Beyond a handful the prompt is the problem. */
export const MAX_MENTIONS = 5;

/**
 * `@` followed by a skill-id-shaped token, at a word boundary.
 *
 * This is parsing a formal mention syntax the composer itself inserts, not
 * fishing meaning out of prose — the id either names a directory in the
 * catalog or it does not, and nothing is inferred either way. The leading
 * `[^\w@/]` guard is what keeps `alex@tyrell.global` and `s/foo/@bar` out.
 */
const MENTION = /(?:^|[^\w@/])@([A-Za-z0-9][A-Za-z0-9_-]{0,63})/g;

/** Catalog directory names. Same shape `isSafeSegment` allows, checked here too. */
const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface StagedSkill {
  id: string;
  /** Files copied, relative to the skill's own directory. `SKILL.md` first. */
  files: string[];
  /** The package had more files than the byte budget allowed. */
  truncated: boolean;
}

/** The `@`-mentions in composer text, in order, deduped, capped. */
export function parseSkillMentions(text: string): string[] {
  const seen: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const id = match[1];
    if (!seen.includes(id)) seen.push(id);
    if (seen.length >= MAX_MENTIONS) break;
  }
  return seen;
}

export function stagedSkillsDir(projectId: string, designId: string): string {
  return path.join(designDir(projectId, designId), 'staged-skills');
}

/** Every regular file under `dir`, relative and sorted, `SKILL.md` hoisted. */
async function skillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (sub: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(sub, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Directories are followed, symlinks are not: following one would copy
      // bytes from outside the catalog into the design's own directory.
      if (entry.isDirectory()) await walk(path.join(sub, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  await walk(dir, '');
  return out.sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)));
}

/**
 * Copy the mentioned skills into the design's staging dir, replacing whatever
 * the previous turn staged.
 *
 * Replacing rather than accumulating is what keeps the prompt line honest: the
 * paths it names are exactly the files that are there.
 */
export async function stageSkills(
  projectId: string,
  designId: string,
  ids: string[],
): Promise<StagedSkill[]> {
  const root = stagedSkillsDir(projectId, designId);
  await rm(root, { recursive: true, force: true });
  if (ids.length === 0) return [];

  const catalog = skillCatalogRoot();
  const staged: StagedSkill[] = [];
  let budget = MAX_STAGED_BYTES;

  for (const id of ids.slice(0, MAX_MENTIONS)) {
    if (!SKILL_ID.test(id)) continue;
    const from = path.join(catalog, id);
    const files = await skillFiles(from);
    // No SKILL.md, no skill — an `@` that happens to match a stray directory
    // is as inert as one that matches nothing.
    if (!files.includes('SKILL.md')) continue;

    const copied: string[] = [];
    let truncated = false;
    for (const file of files) {
      const size = await stat(path.join(from, file)).then(
        (s) => s.size,
        () => -1,
      );
      if (size < 0) continue;
      if (size > budget) {
        truncated = true;
        break;
      }
      // Containment on the *destination* as well as the source: the relative
      // paths come off the filesystem, and a name that normalises upward would
      // otherwise write outside the design directory.
      const target = resolveInsideRoot(root, `${id}/${file}`);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(from, file), target);
      copied.push(file);
      budget -= size;
    }
    if (copied.length > 0) staged.push({ id, files: copied, truncated });
  }

  return staged;
}

/** The line appended to the turn's instruction. `""` when nothing staged. */
export function skillStagingPromptLine(staged: StagedSkill[]): string {
  if (staged.length === 0) return '';
  const lines = [
    '',
    'Skills mentioned in this instruction have been staged as a frozen copy for this turn.',
    'Read them with `read_staged_skill` before you design; they are reference material, not design source.',
  ];
  for (const skill of staged) {
    const paths = skill.files.map((file) => `${skill.id}/${file}`).join(', ');
    lines.push(
      `- @${skill.id}: ${paths}${skill.truncated ? ' (larger files were left out at the staging size cap)' : ''}`,
    );
  }
  return lines.join('\n');
}
