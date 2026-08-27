/**
 * fs-bridge.ts — the artifact transport of the persona bridge.
 *
 * Some projects are not running programs: a research paper, a spec, a document
 * repo, a library with no UI. Demanding a dev server from those is what made a
 * markdown+python repo fabricate an HTTP endpoint and then face thirteen
 * browser personas (execution-flow review H5). Here the product IS the files,
 * so the persona reads them and cites what it read.
 *
 * Evidence is `records/NN-<name>.json` — the file it read, or the run of the
 * command the repo declared. Citations are what screenshots are to a browser
 * run: the persona never writes one, so it cannot claim a passage that is not
 * there.
 *
 * Unlike the terminal transport, which serves documents only ("the tester never
 * sees source"), this one serves every file in the worktree. That principle is
 * about not spoiling a consumer's first run; here the source IS a deliverable —
 * a paper's analysis script is part of what is under review — so withholding it
 * would withhold the product.
 *
 * Two rules specific to this transport:
 *   - Nothing outside the worktree is readable. A climbing path is refused, and
 *     so is a symlink inside the worktree that resolves out of it.
 *   - `run` executes ONLY the command `.ligma/boot.json` declared, and never a
 *     caller-supplied one. The persona chooses whether to run it, not what it is.
 */

import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSafeEnv, scrubCredentials } from '../engine/security';
import {
  type Bridge,
  type BridgeHandler,
  SessionRecorder,
  type StepEvidence,
  serveBridge,
  str,
} from './bridge-server';
import { COMMAND_TIMEOUT_MS, type PtyRecord, execute } from './pty-bridge';

/** A file body is evidence, not an archive. */
const READ_LIMIT = 40_000;
/** Enough to see a repo whole; a checkout with more files has a listing problem, not a paper. */
const FILE_LIMIT = 2_000;
/** Machinery, not deliverables. Walking these is how a listing becomes useless. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.venv',
  '__pycache__',
  '.next',
  'dist',
  'build',
]);

export interface FsBridgeOptions {
  /** The ephemeral env's worktree, at the recipe's appDir. The only readable tree. */
  root: string;
  /** Verification run root: <data>/verification-runs/<runId>. */
  runDir: string;
  /** The globs boot.json declared. Shown to the persona; matching is its job, not ours. */
  artifacts: string[];
  /** The ONE command `run` may execute, from boot.json. null = the repo declared none. */
  check: string[] | null;
}

/** One file read, exactly as the bridge saw it. The unit of evidence. */
export interface FsReadRecord {
  index: number;
  /** Worktree-relative posix path. */
  path: string;
  bytes: number;
  text: string;
  truncated: boolean;
  at: string;
}

/** Every file under `root`, worktree-relative, capped. Machinery pruned. */
export function listFiles(
  root: string,
  limit = FILE_LIMIT,
): { files: Array<{ path: string; bytes: number }>; truncated: boolean } {
  const files: Array<{ path: string; bytes: number }> = [];
  let truncated = false;

  const walk = (dir: string, rel: string): void => {
    if (truncated) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const child = path.join(dir, entry.name);
      const childRel = rel ? path.posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(child, childRel);
      } else if (entry.isFile()) {
        // A symlink is not isFile(); it is left out rather than followed.
        files.push({ path: childRel, bytes: statSync(child).size });
      }
    }
  };

  walk(root, '');
  return { files, truncated };
}

class FsSession extends SessionRecorder {
  readonly records: Array<{ index: number; kind: 'read' | 'run'; name: string }> = [];
  private readonly recordsDir = this.subdir('records');
  lastRecord: string | null = null;

  /** Persist one record and return its run-relative path. */
  write(kind: 'read' | 'run', name: string, body: unknown): string {
    const index = this.records.length + 1;
    const slug = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || kind;
    const file = `${String(index).padStart(2, '0')}-${slug}.json`;
    writeFileSync(path.join(this.recordsDir, file), `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
    this.records.push({ index, kind, name });
    return this.rel('records', file);
  }
}

/** Both actions produce a citation, so both become evidence steps. */
const MUTATING = new Set(['read', 'run']);

export async function startFsBridge(opts: FsBridgeOptions): Promise<Bridge> {
  // realpath once: on macOS the worktree's own parent (/tmp) is a symlink, and a
  // containment check against the unresolved root refuses every legitimate read.
  const root = realpathSync(path.resolve(opts.root));

  /** Resolve a persona-supplied path, refusing anything that leaves the worktree. */
  const resolveInside = (raw: string): string => {
    const refuse = (): never => {
      throw Object.assign(new Error(`Refusing to read outside the worktree: ${raw}`), {
        statusCode: 403,
      });
    };
    const target = path.resolve(root, raw);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) refuse();
    // A symlink inside the worktree pointing out of it is the same escape by
    // another route, so containment is re-checked after resolution.
    let real: string;
    try {
      real = realpathSync(target);
    } catch {
      return target; // does not exist — the read below reports that, honestly
    }
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) refuse();
    return real;
  };

  const handler: BridgeHandler<FsSession> = {
    mutating: MUTATING,

    async newSession(name) {
      return new FsSession(name, opts.runDir);
    },

    async stepEvidence(session): Promise<StepEvidence> {
      return { record: session.lastRecord, url: '' };
    },

    async close() {
      // Nothing is held open: every read and every command is awaited.
    },

    async perform(session, action, body) {
      switch (action) {
        case 'list': {
          const { files, truncated } = listFiles(root);
          return { artifacts: opts.artifacts, check: opts.check, files, truncated };
        }

        case 'read': {
          session.lastRecord = null;
          const asked = str(body.path) ?? str(body.file);
          if (!asked)
            throw new Error('read needs { path: "docs/paper.md" } — a path inside the repo');
          const full = resolveInside(asked);

          let raw: string;
          let bytes: number;
          try {
            bytes = statSync(full).size;
            raw = readFileSync(full, 'utf-8');
          } catch (err) {
            // A declared artifact that is not there is the finding, so this is
            // recorded as a failed step rather than swallowed.
            throw new Error(
              `Cannot read ${asked}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          const text = scrubCredentials(raw).slice(0, READ_LIMIT);
          const rel = path.relative(root, full).split(path.sep).join('/');
          const record: FsReadRecord = {
            index: session.records.length + 1,
            path: rel,
            bytes,
            text,
            truncated: raw.length > text.length,
            at: new Date().toISOString(),
          };
          session.lastRecord = session.write('read', rel, record);
          return { path: rel, bytes, text, truncated: record.truncated };
        }

        case 'run': {
          session.lastRecord = null;
          // The persona chooses WHETHER to run the check, never what it is. An
          // argv from the caller is refused outright — a repo that did not
          // declare a command does not acquire one by being asked nicely.
          if (body.argv !== undefined || body.command !== undefined) {
            throw new Error(
              `run takes no arguments here: this transport executes only the command declared in boot.json (${
                opts.check ? opts.check.join(' ') : 'none'
              })`,
            );
          }
          if (!opts.check) {
            throw new Error(
              'This project declares no check command in .ligma/boot.json — there is nothing to run',
            );
          }

          // buildSafeEnv, not process.env — see pty-bridge's baseEnv (E16).
          const result = await execute(
            opts.check,
            root,
            { ...buildSafeEnv(), CI: '1', NO_COLOR: '1' },
            null,
            COMMAND_TIMEOUT_MS,
          );
          const record: PtyRecord = {
            index: session.records.length + 1,
            at: new Date().toISOString(),
            ...result,
          };
          session.lastRecord = session.write('run', opts.check[0], record);

          return {
            argv: record.argv,
            exitCode: record.exitCode,
            timedOut: record.timedOut,
            stdout: record.stdout,
            stderr: record.stderr,
            outputTruncated: record.outputTruncated,
            durationMs: record.durationMs,
            spawnError: record.error,
          };
        }

        case 'records':
          return { records: session.records };

        default:
          throw Object.assign(new Error(`Unknown action "${action}"`), { statusCode: 404 });
      }
    },
  };

  return serveBridge(handler);
}
