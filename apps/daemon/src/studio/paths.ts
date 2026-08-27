/**
 * Where a design lives, and the one function that decides whether a path is
 * allowed to be touched.
 *
 * Layout (CONTRACTS-phase3 "Data model" — central, not in-repo):
 *
 *   data/projects/<projectId>/designs/<designId>/
 *     design.json        the manifest (status, versions, pins, tweaks, critique)
 *     src/               the design source — the ONLY tree the agent can write
 *     blobs/<sha256>     content-addressed snapshot bodies, deduped
 *
 * `design.json` and `blobs/` sit *outside* `src/` deliberately: the generation
 * agent's tools are scoped to `src/`, so a model cannot rewrite its own version
 * history or flip its own status to `approved`. That is the same
 * enforce-at-the-filesystem-level discipline the frozen oracle uses (build
 * brief §4 principle 2), applied to the design's own metadata.
 */

import path from 'node:path';
import { CENTRAL_PROJECTS_DIR } from '../paths';

/** Ids are interpolated into filesystem paths, so they are validated, not trusted. */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function assertSafeId(kind: string, id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${kind} "${id}" — must match /^[A-Za-z0-9_-]+$/`);
  }
  return id;
}

/**
 * A design-system slug, checked before it is stored on a manifest.
 *
 * `session.ts` interpolates `manifest.designSystem` straight into
 * `design-systems/<slug>/DESIGN.md`, so this is the same trust boundary
 * `assertSafeId` guards, applied at the two places a slug can be set (design
 * creation and the mid-session swap). `null` is a legitimate value — it means
 * no design system.
 */
export function assertSafeDesignSystem(slug: string | null): string | null {
  if (slug === null || slug === '') return null;
  return assertSafeId('designSystem', slug);
}

export function designsDir(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, assertSafeId('projectId', projectId), 'designs');
}

export function designDir(projectId: string, designId: string): string {
  return path.join(designsDir(projectId), assertSafeId('designId', designId));
}

/** The manifest file. Never inside `src/` — the agent must not be able to edit it. */
export function manifestPath(projectId: string, designId: string): string {
  return path.join(designDir(projectId, designId), 'design.json');
}

/** The agent-writable design source tree. */
export function sourceDir(projectId: string, designId: string): string {
  return path.join(designDir(projectId, designId), 'src');
}

/** Content-addressed blob store for this design's snapshots. */
export function blobsDir(projectId: string, designId: string): string {
  return path.join(designDir(projectId, designId), 'blobs');
}

/**
 * Resolve a design-relative path inside `root`, or throw.
 *
 * This is the security boundary for every agent file tool. It rejects, in
 * order: empty paths, NUL bytes (a classic truncation trick against anything
 * downstream that hits a C string), absolute paths, Windows drive letters and
 * UNC prefixes, and anything that escapes `root` after normalisation — which is
 * what catches `..`, `a/../../b`, and `./././../x` alike, without trying to
 * pattern-match the many ways to spell "up one level".
 *
 * Normalisation-then-containment is the check, not a blocklist: a blocklist of
 * traversal spellings is a thing you lose to, eventually.
 */
export function resolveInsideRoot(root: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('path is required');
  }
  if (relativePath.includes('\0')) {
    throw new Error(`path "${relativePath}" contains a NUL byte`);
  }
  if (
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.startsWith('\\\\')
  ) {
    throw new Error(`path "${relativePath}" must be relative to the design directory`);
  }

  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, relativePath);
  // The trailing separator matters: without it, "/designs/src-evil" passes a
  // naive startsWith("/designs/src") check.
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`path "${relativePath}" escapes the design directory`);
  }
  return target;
}

/** The design-relative, POSIX-separated form of an absolute path under `root`. */
export function toDesignRelative(root: string, absolutePath: string): string {
  return path.relative(path.resolve(root), absolutePath).split(path.sep).join('/');
}
