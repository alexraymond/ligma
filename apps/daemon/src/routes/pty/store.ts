/**
 * store.ts — in-memory registry of Studio terminal sessions (OD-135).
 *
 * Reuses pty-bridge.ts's own public surface — `startPtyBridge` +
 * `Bridge.session()` — rather than reimplementing spawn/timeout/credential-
 * scrubbing: one bridge per terminal tab, its `run` action called over its own
 * loopback capability URL exactly the way any bridge consumer is meant to,
 * closed (and its evidence dir wiped) on kill.
 *
 * pty-bridge was built for scripted CLI personas — run one argv to completion,
 * record it as evidence — not a human typing into a live shell: `execute()`
 * closes stdin the instant the process is spawned and only resolves once the
 * whole command has exited (or hit its 2-minute timeout), with no per-chunk
 * callback in between. So what this gives a human is a command console, not a
 * real pty: type a line, wait for it to finish, see the whole result appear at
 * once. There is no way to answer an interactive prompt mid-command. See
 * `terminal-panel.tsx`'s docblock for the user-facing consequence.
 *
 * ponytail: exporting `execute` from pty-bridge.ts (one line — it is currently
 * module-private) would let `sendInput` below skip the loopback HTTP hop and
 * call the spawn helper in-process instead. Not needed to ship this: the
 * bridge's existing public API already gets full reuse with zero edits to a
 * file this task does not own. Add the export if the loopback hop ever shows
 * up as real overhead.
 */

import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Bridge } from '../../harness/bridge-server';
import { startPtyBridge } from '../../harness/pty-bridge';
import { DATA_DIR } from '../../paths';

export interface TerminalFrame {
  event: 'data' | 'exit';
  data: string;
  seq: number;
}

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  runDir: string;
  bridge: Bridge;
  /** Capability URL for the bridge's `run` action — `.../s/shell/<token>/run`. */
  runUrl: string;
  emitter: EventEmitter;
  replay: TerminalFrame[];
  seq: number;
  killed: boolean;
}

/** Enough to cover a reconnect without keeping a whole session transcript. */
const REPLAY_LIMIT = 500;

const sessions = new Map<string, TerminalSession>();

function emit(session: TerminalSession, event: TerminalFrame['event'], data: string): void {
  session.seq += 1;
  const frame: TerminalFrame = { event, data, seq: session.seq };
  session.replay.push(frame);
  if (session.replay.length > REPLAY_LIMIT) session.replay.shift();
  session.emitter.emit('frame', frame);
}

/** Start a bridge scoped to one project's repo and register the session. */
export async function createSession(projectId: string, cwd: string): Promise<{ id: string }> {
  const id = randomBytes(8).toString('hex');
  const runDir = path.join(DATA_DIR, 'pty-sessions', id);
  const bridge = await startPtyBridge({ cwd, runDir, productUrl: null });
  const { url } = await bridge.session('shell');

  const emitter = new EventEmitter();
  // A tab can be watched by more than one open stream during a reconnect race.
  emitter.setMaxListeners(0);

  sessions.set(id, {
    id,
    projectId,
    runDir,
    bridge,
    runUrl: `${url}/run`,
    emitter,
    replay: [],
    seq: 0,
    killed: false,
  });
  return { id };
}

/** The session, scoped to the project it was created for — never leaked cross-project. */
export function findSession(id: string, projectId: string): TerminalSession | null {
  const session = sessions.get(id);
  if (!session || session.killed || session.projectId !== projectId) return null;
  return session;
}

/**
 * Run one typed line as `sh -lc <line>` (pty-bridge's own documented escape
 * hatch for a real pipeline, rather than this layer guessing at quoting) and
 * echo the prompt plus whatever the bridge returns as terminal frames.
 *
 * Blocks until the command finishes — same ceiling as the bridge's own
 * COMMAND_TIMEOUT_MS (2 minutes) — because that is genuinely how long the
 * underlying `run` action takes to answer.
 */
export async function sendInput(session: TerminalSession, line: string): Promise<void> {
  emit(session, 'data', `$ ${line}\n`);

  let result: RunResult;
  try {
    const res = await fetch(session.runUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ argv: ['sh', '-lc', line] }),
    });
    const body = (await res.json()) as Partial<RunResult> & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `bridge run failed (${res.status})`);
    result = {
      exitCode: body.exitCode ?? null,
      stdout: body.stdout ?? '',
      stderr: body.stderr ?? '',
      timedOut: body.timedOut ?? false,
      spawnError: body.spawnError ?? null,
    };
  } catch (err) {
    emit(session, 'data', `${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }

  if (result.spawnError) emit(session, 'data', `${result.spawnError}\n`);
  if (result.stdout) emit(session, 'data', result.stdout);
  if (result.stderr) emit(session, 'data', result.stderr);
  if (result.timedOut) emit(session, 'data', '(timed out)\n');
  else if (result.exitCode) emit(session, 'data', `(exit ${result.exitCode})\n`);
}

/** Replay everything after `afterSeq`, then keep delivering live frames. Returns the unsubscribe. */
export function subscribe(
  session: TerminalSession,
  afterSeq: number,
  listener: (f: TerminalFrame) => void,
): () => void {
  for (const frame of session.replay) if (frame.seq > afterSeq) listener(frame);
  session.emitter.on('frame', listener);
  return () => session.emitter.off('frame', listener);
}

/** Kill on tab close/unmount, or an explicit Close — the only paths that tear a session down. */
export async function killSession(session: TerminalSession): Promise<void> {
  session.killed = true;
  sessions.delete(session.id);
  emit(session, 'exit', '');
  await session.bridge.close().catch(() => undefined);
  await rm(session.runDir, { recursive: true, force: true }).catch(() => undefined);
}
