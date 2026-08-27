/**
 * run-changes.ts — what a run was standing on, and what it left behind.
 *
 * A run's output tells you what the agent SAID. These two functions record what
 * it was actually pointed at (`headSha`, read at spawn) and what actually
 * changed (`captureChanges`, at the end) — the pair that lets the Verify surface
 * bind a claim to a commit and a diff instead of to prose.
 *
 * Everything here is best-effort by construction. A repo-less cwd, a git that
 * is not installed, a detached worktree mid-rebase: all of them return null or
 * write nothing. NONE of them may fail a run — losing the evidence of a build is
 * bad, losing the build to a bookkeeping error is worse.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger';
import { scrubCredentials } from './security';

import { DATA_DIR } from '../paths';

/** Same convention (and same env escape hatch) as OutputWriter's own directory. */
export function runOutputsDir(): string {
  return process.env.MC_RUN_OUTPUTS_DIR ?? path.join(DATA_DIR, 'run-outputs');
}

/** A run id as a filename stem, sanitized so it can never traverse out. */
export function runArtifactPath(runId: string, suffix: string): string {
  const dir = runOutputsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, `${runId.replace(/[^a-zA-Z0-9_-]/g, '_')}${suffix}`);
}

/** Bound on the captured diff. Past this the file says so rather than lying by omission. */
const MAX_DIFF_BYTES = 512 * 1024;

function git(args: string[], cwd: string, maxBuffer = 16 * 1024 * 1024): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer,
  });
}

/**
 * `git rev-parse HEAD` in `cwd`, or null.
 *
 * Null covers every not-a-repo case there is — empty path, missing directory, a
 * directory git does not consider a repo, a repo with no commits yet, git not on
 * PATH. The caller cannot tell them apart and does not need to: all of them mean
 * "there is no commit to point at", which is a fact worth recording as null.
 */
export function headSha(cwd: string | null | undefined): string | null {
  if (!cwd || !existsSync(cwd)) return null;
  try {
    return git(['rev-parse', 'HEAD'], cwd).trim() || null;
  } catch {
    return null;
  }
}

/**
 * What a run left behind, as the route serves it.
 *
 * Stored as JSON rather than as a formatted report because
 * `GET /api/runs/:id/changes` has to hand back these fields separately, and the
 * alternative — write prose, then pattern-match the sections back out — is
 * exactly the "parse structured data out of free text" the house rules forbid.
 * A diff can contain any text at all, section headers included, so any such
 * parser would be wrong on the first diff that touched this file.
 */
export interface RunChanges {
  /** The commit the run started from — what `diff` and `stat` are relative to. */
  commitSha: string;
  capturedAt: string;
  /** `git diff --stat` — what was touched. */
  stat: string;
  /** `git diff` — what changed, capped at 512KB. */
  diff: string;
  /** `git status --short` — what is still uncommitted. */
  status: string;
  /** True when `diff` stops short of the real end. Never silent. */
  truncated: boolean;
}

/**
 * Everything that changed in `cwd` since `sinceSha`, written to
 * `data/run-outputs/<runId>.changes.json`. Returns the path, or null if nothing
 * could be captured.
 *
 * Three questions, three answers: `--stat` (what was touched, always small), the
 * full diff (what changed, capped), and `status --short` (what is uncommitted —
 * a builder that never commits leaves ALL its work there, so omitting it would
 * report a productive run as a no-op).
 */
export function captureChanges(runId: string, cwd: string, sinceSha: string): string | null {
  try {
    const stat = git(['diff', '--stat', sinceSha], cwd);
    const status = git(['status', '--short'], cwd);
    let diff = git(['diff', sinceSha], cwd);
    let truncated = false;
    if (Buffer.byteLength(diff, 'utf-8') > MAX_DIFF_BYTES) {
      // Cut on a byte boundary, then let the decoder drop a split multi-byte
      // character rather than emit a replacement one.
      diff = Buffer.from(diff, 'utf-8').subarray(0, MAX_DIFF_BYTES).toString('utf-8');
      truncated = true;
    }

    // A diff can quote a .env the builder read; the same scrubber the output log
    // uses runs here, for the same reason.
    const changes: RunChanges = {
      commitSha: sinceSha,
      capturedAt: new Date().toISOString(),
      stat: scrubCredentials(stat.trimEnd()),
      diff: scrubCredentials(diff.trimEnd()),
      status: scrubCredentials(status.trimEnd()),
      truncated,
    };

    const file = runArtifactPath(runId, '.changes.json');
    writeFileSync(file, JSON.stringify(changes, null, 2), 'utf-8');
    return file;
  } catch (err) {
    logger.warn(
      'run-changes',
      `Could not capture changes for ${runId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Persist the prompt a run was actually given, so the Verify surface can show
 * what was asked rather than what someone remembers asking.
 */
export function writePromptFile(runId: string, prompt: string): string | null {
  try {
    const file = runArtifactPath(runId, '.prompt.txt');
    writeFileSync(file, scrubCredentials(prompt), 'utf-8');
    return file;
  } catch (err) {
    logger.warn(
      'run-changes',
      `Could not persist prompt for ${runId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
