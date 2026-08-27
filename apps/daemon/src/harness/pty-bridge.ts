/**
 * pty-bridge.ts — the terminal transport of the persona bridge.
 *
 * For a CLI or a library the product IS the command line, so the persona runs
 * commands in the clean ephemeral env and the bridge keeps the transcript. Every
 * command is recorded to `records/NN-<argv0>.json` — argv, cwd, exit code,
 * signal, stdout and stderr. Exit codes are what a browser run would call
 * screenshots: the thing the baseline compares.
 *
 * Two rules specific to this transport:
 *   - Commands are ARGV ARRAYS, never shell strings. A persona that genuinely
 *     needs a pipeline asks for `["sh","-lc","…"]` and that intent is recorded,
 *     rather than us splitting a string and guessing at quoting.
 *   - `docs` is the ONLY way the persona reads the repo. For a library the README
 *     is the UI (UX spec §3), so the harness serves it and nothing else — the
 *     tester never sees source, enforced by not having it rather than by asking.
 *
 * ponytail: pipes, not a real tty. Everything the evidence contract needs
 * (transcript + exit code) survives without one; a CLI that changes behaviour
 * under `isatty()` needs node-pty here, which is a native dependency we do not
 * pay for until a product under test actually demands it.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSafeEnv, scrubCredentials } from '../engine/security';
import {
  type Bridge,
  type BridgeHandler,
  SessionRecorder,
  type StepEvidence,
  serveBridge,
} from './bridge-server';

/** A command that has not finished in two minutes is hung, and that is a finding. */
export const COMMAND_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 16_000;
const DOC_LIMIT = 40_000;

/** Documentation a persona may read. Everything else in the repo is source. */
const DOC_PATTERN =
  /^(readme|quickstart|getting[-_]?started|install|usage|contributing|changelog)(\.(md|markdown|rst|txt))?$/i;

export interface PtyBridgeOptions {
  /** Working directory inside the ephemeral env — where the product was built. */
  cwd: string;
  /** Verification run root: <data>/verification-runs/<runId>. */
  runDir: string;
  /** The env's product URL, when it also serves one. Handed to commands as BASE_URL. */
  productUrl?: string | null;
}

/** One command execution, exactly as the bridge ran it. The unit of evidence. */
export interface PtyRecord {
  index: number;
  argv: string[];
  cwd: string;
  /** null when the process was killed rather than exiting on its own. */
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMs: number;
  /** Set only when the command could not be started at all (no such binary). */
  error: string | null;
  at: string;
}

/** The docs the naive-developer is allowed to read, newest-shallowest first. */
export function findDocs(root: string): string[] {
  const out: string[] = [];
  const scan = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isFile()) continue;
      const base = entry.name.replace(/\.[^.]+$/, '');
      if (DOC_PATTERN.test(entry.name) || DOC_PATTERN.test(base))
        out.push(path.posix.join(rel, entry.name));
    }
  };
  scan(root, '');
  scan(path.join(root, 'docs'), 'docs');
  return out;
}

class PtySession extends SessionRecorder {
  readonly records: PtyRecord[] = [];
  private readonly recordsDir = this.subdir('records');
  lastRecord: string | null = null;

  write(record: PtyRecord): string {
    const slug =
      (record.argv[0] ?? 'command').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'command';
    const file = `${String(record.index).padStart(2, '0')}-${slug}.json`;
    writeFileSync(
      path.join(this.recordsDir, file),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf-8',
    );
    this.records.push(record);
    return this.rel('records', file);
  }
}

function argvOf(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v) => typeof v === 'string' && v.length > 0)
  ) {
    throw new Error(
      'run needs { argv: ["cmd", "arg", …] } — an array of strings, never a shell string',
    );
  }
  return value as string[];
}

/**
 * Run one command to completion. Never rejects: a crash is evidence.
 *
 * Exported for the fs transport, which runs the ONE command boot.json declared
 * and keeps the same record shape — so a command's evidence looks identical
 * whether a CLI persona chose it or an artifact recipe committed to it.
 */
export function execute(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input: string | null,
  timeoutMs: number,
): Promise<Omit<PtyRecord, 'index' | 'at'>> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const done = (over: Partial<Omit<PtyRecord, 'index' | 'at'>>): void =>
      resolve({
        argv,
        cwd,
        exitCode: null,
        signal: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        outputTruncated: false,
        durationMs: Date.now() - t0,
        error: null,
        ...over,
      });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return done({ error: err instanceof Error ? err.message : String(err) });
    }

    let stdout = '';
    let stderr = '';
    let truncated = false;
    const collect = (into: 'out' | 'err') => (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (into === 'out') {
        if (stdout.length >= OUTPUT_LIMIT) truncated = true;
        else stdout += text;
      } else if (stderr.length >= OUTPUT_LIMIT) truncated = true;
      else stderr += text;
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      done({
        error: err.message,
        stdout: scrubCredentials(stdout),
        stderr: scrubCredentials(stderr),
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({
        exitCode: code,
        signal,
        timedOut,
        stdout: scrubCredentials(stdout).slice(0, OUTPUT_LIMIT),
        stderr: scrubCredentials(stderr).slice(0, OUTPUT_LIMIT),
        outputTruncated: truncated || stdout.length > OUTPUT_LIMIT || stderr.length > OUTPUT_LIMIT,
      });
    });

    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

const MUTATING = new Set(['run']);

export async function startPtyBridge(opts: PtyBridgeOptions): Promise<Bridge> {
  const cwd = path.resolve(opts.cwd);
  const baseEnv: NodeJS.ProcessEnv = {
    // buildSafeEnv, not process.env: this transport runs persona-chosen commands,
    // and every CLI spawn in the product already strips the ANTHROPIC_API_KEY
    // class of vars before handing an env to an agent-driven child. The
    // pattern-based scrub on the way back is a second line, not the first
    // (codebase audit E16).
    ...buildSafeEnv(),
    CI: '1',
    TERM: 'dumb',
    NO_COLOR: '1',
    ...(opts.productUrl ? { BASE_URL: opts.productUrl } : {}),
  };

  const handler: BridgeHandler<PtySession> = {
    mutating: MUTATING,

    async newSession(name) {
      return new PtySession(name, opts.runDir);
    },

    async stepEvidence(session): Promise<StepEvidence> {
      return { record: session.lastRecord, url: opts.productUrl ?? '' };
    },

    async close() {
      // Every command is awaited to completion; nothing outlives a run.
    },

    async perform(session, action, body) {
      switch (action) {
        case 'run': {
          session.lastRecord = null;
          const argv = argvOf(body.argv ?? body.command);
          const input = typeof body.input === 'string' ? body.input : null;
          const timeoutMs = Math.min(
            Number(body.timeoutMs) || COMMAND_TIMEOUT_MS,
            COMMAND_TIMEOUT_MS,
          );

          const result = await execute(argv, cwd, baseEnv, input, timeoutMs);
          const record: PtyRecord = {
            index: session.records.length + 1,
            at: new Date().toISOString(),
            ...result,
          };
          session.lastRecord = session.write(record);

          return {
            exitCode: record.exitCode,
            signal: record.signal,
            timedOut: record.timedOut,
            stdout: record.stdout,
            stderr: record.stderr,
            outputTruncated: record.outputTruncated,
            durationMs: record.durationMs,
            spawnError: record.error,
          };
        }

        case 'docs': {
          // The naive-developer's whole world. Doc files only, by name — a repo
          // that hides its quickstart inside source does not have a quickstart.
          const files = findDocs(cwd);
          const asked = typeof body.file === 'string' ? body.file : null;
          const chosen = asked ? files.filter((f) => f === asked) : files;
          if (asked && chosen.length === 0) {
            throw new Error(`No such doc "${asked}". Available: ${files.join(', ') || '(none)'}`);
          }
          let budget = DOC_LIMIT;
          const contents = chosen.map((file) => {
            const full = path.join(cwd, file);
            const text = budget <= 0 ? '' : readFileSync(full, 'utf-8').slice(0, budget);
            budget -= text.length;
            return {
              file,
              bytes: statSync(full).size,
              text,
              truncated: text.length < statSync(full).size,
            };
          });
          return { cwd, files, docs: contents };
        }

        case 'records':
          return {
            records: session.records.map((r) => ({
              index: r.index,
              argv: r.argv,
              exitCode: r.exitCode,
              timedOut: r.timedOut,
            })),
          };

        default:
          throw Object.assign(new Error(`Unknown action "${action}"`), { statusCode: 404 });
      }
    },
  };

  return serveBridge(handler);
}
