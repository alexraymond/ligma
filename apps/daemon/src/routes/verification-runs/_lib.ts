import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../../paths';

/** Root directory for verification run evidence. Overridable for tests. */
export function getVerificationRunsRoot(): string {
  const override = process.env.VERIFICATION_RUNS_DIR;
  return path.resolve(override || path.join(DATA_DIR, 'verification-runs'));
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** Run IDs and persona directory names are restricted to a safe charset — no path segments. */
export function isSafeSegment(id: string): boolean {
  return SAFE_ID.test(id);
}

/**
 * Whether a verification run's evidence directory is still on disk.
 *
 * The id is charset-checked first, so this doubles as the guard any caller
 * taking a run id from a request body needs before it touches a path.
 */
export function runExists(runId: string): boolean {
  return isSafeSegment(runId) && existsSync(path.join(getVerificationRunsRoot(), runId));
}

export class PathSafetyError extends Error {}

/**
 * Resolve `relPath` against `baseDir`, rejecting anything that lexically
 * escapes it (e.g. "../../tasks.json"). Throws PathSafetyError on violation.
 */
export function safeResolve(baseDir: string, relPath: string): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new PathSafetyError(`Path escapes base directory: ${relPath}`);
  }
  return target;
}

/**
 * Re-check containment via realpath once the target is known to exist —
 * defeats a symlink planted inside the run dir that points outside `baseDir`.
 * Call only after confirming the file exists (realpath throws ENOENT otherwise).
 */
export async function assertRealpathContained(baseDir: string, targetPath: string): Promise<void> {
  const [realBase, realTarget] = await Promise.all([realpath(baseDir), realpath(targetPath)]);
  if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
    throw new PathSafetyError('Path escapes base directory (resolved via realpath)');
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jsonl': 'application/x-ndjson',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
