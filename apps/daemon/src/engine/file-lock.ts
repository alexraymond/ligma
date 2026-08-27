/**
 * file-lock.ts — Cross-process file locking using atomic mkdir.
 *
 * Multiple run-task.ts / run-inbox-respond.ts instances run concurrently
 * and read-modify-write the same JSON files (tasks.json, inbox.json, etc.).
 * Without locking, concurrent writes clobber each other's changes.
 *
 * This uses mkdir as an atomic lock primitive — it either succeeds (lock
 * acquired) or throws EEXIST (already locked). No external dependencies.
 *
 * Two things the first version got wrong, both fixed here (E3):
 *
 *  1. **Stealing.** After 15s *any* waiter deleted the lock dir with no liveness
 *     check, so two stealers could interleave into the critical section and the
 *     first one's `finally` then deleted the second one's fresh lock. Now the dir
 *     carries an owner stamp (pid + a per-acquisition token): a lock is broken
 *     only when its holder is provably dead, release only removes a lock whose
 *     token still matches, and a live holder that outstays the timeout raises an
 *     error instead of being silently robbed.
 *  2. **Waiting.** The wait was a synchronous CPU spin, so a leaked lock froze
 *     the whole daemon (HTTP API included) for up to 15s per acquisition. The
 *     sync path now sleeps with `Atomics.wait` (no CPU burn), and store writers
 *     that can afford to yield use `withFileLockAsync`, which does not block the
 *     event loop at all.
 */

import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from '../paths';
const LOCKS_DIR = path.join(DATA_DIR, '.locks');

// Ensure the .locks directory exists
try {
  mkdirSync(LOCKS_DIR, { recursive: true });
} catch {
  // Already exists
}

/** Who holds a lock, written into the lock dir right after mkdir wins it. */
interface LockOwner {
  pid: number;
  /** Unique per acquisition, so a stolen lock is never released by its victim. */
  token: string;
  at: number;
}

/**
 * How long an unstamped lock dir is presumed to be mid-creation.
 *
 * There is an unavoidable gap between `mkdir` winning and the owner stamp
 * landing. Inside the gap the lock is real and must be respected; past it the
 * dir is a leftover (a stamp write that failed, or a lock from an older build)
 * and may be broken.
 */
const UNSTAMPED_GRACE_MS = 5_000;

/** Give up rather than fight forever over a lock everyone keeps breaking. */
const MAX_STEALS = 5;

function ownerPath(lockPath: string): string {
  return path.join(lockPath, 'owner.json');
}

function readOwner(lockPath: string): LockOwner | null {
  try {
    const owner = JSON.parse(readFileSync(ownerPath(lockPath), 'utf-8')) as LockOwner;
    return typeof owner?.pid === 'number' && typeof owner?.token === 'string' ? owner : null;
  } catch {
    return null;
  }
}

/** EPERM means the pid exists and belongs to somebody else — alive, not free. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

type Acquisition = 'acquired' | 'held-alive' | 'held-dead' | 'held-by-us';

function tryAcquire(lockPath: string, token: string): Acquisition {
  try {
    mkdirSync(lockPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const owner = readOwner(lockPath);
    if (!owner) {
      try {
        return Date.now() - statSync(lockPath).mtimeMs > UNSTAMPED_GRACE_MS
          ? 'held-dead'
          : 'held-alive';
      } catch {
        // It vanished between our mkdir and our stat — just go round again.
        return 'held-alive';
      }
    }
    if (owner.pid === process.pid) return 'held-by-us';
    return processAlive(owner.pid) ? 'held-alive' : 'held-dead';
  }

  writeFileSync(
    ownerPath(lockPath),
    JSON.stringify({ pid: process.pid, token, at: Date.now() } satisfies LockOwner),
    'utf-8',
  );
  return 'acquired';
}

function breakLock(lockPath: string): void {
  try {
    unlinkSync(ownerPath(lockPath));
  } catch {
    /* ignore */
  }
  try {
    rmdirSync(lockPath);
  } catch {
    /* ignore */
  }
}

function release(lockPath: string, token: string): void {
  const owner = readOwner(lockPath);
  // Somebody broke ours and took it: it is theirs to delete now, not ours.
  if (owner && owner.token !== token) return;
  breakLock(lockPath);
}

function waitMs(): number {
  return 20 + Math.floor(Math.random() * 80);
}

/** Sleep without burning CPU and without yielding the event loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function timedOut(filename: string, timeoutMs: number): Error {
  return new Error(
    `Timed out after ${timeoutMs}ms waiting for the "${filename}" lock — its holder is alive and still working. Nothing was written; retry, or investigate the holder.`,
  );
}

function selfHeld(filename: string): Error {
  return new Error(
    `Deadlock: this process already holds the "${filename}" lock and is asking for it again from synchronous code. Move the inner write outside the outer lock (or use withFileLockAsync for both).`,
  );
}

/**
 * Execute `fn` while holding an exclusive lock on `filename`.
 * Uses mkdir as an atomic cross-process mutex.
 *
 * Synchronous: it blocks this process (event loop included) until the lock is
 * free. Prefer `withFileLockAsync` anywhere that can await.
 *
 * @param filename - Logical name for the lock (e.g. "tasks", "inbox")
 * @param fn - Function to execute while lock is held
 * @param timeoutMs - Max time to wait for a LIVE holder (default 15s). A dead
 *   holder's lock is broken immediately, whatever the timeout says.
 */
export function withFileLock<T>(filename: string, fn: () => T, timeoutMs = 15000): T {
  const lockPath = path.join(LOCKS_DIR, `${filename}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  let steals = 0;

  for (;;) {
    const state = tryAcquire(lockPath, token);
    if (state === 'acquired') break;
    // A holder in THIS process can only be an async lock holder (or a nested
    // sync one) — neither can make progress while this call blocks the loop.
    if (state === 'held-by-us') throw selfHeld(filename);
    if (state === 'held-dead') {
      if (steals++ >= MAX_STEALS) throw timedOut(filename, timeoutMs);
      breakLock(lockPath);
      continue;
    }
    if (Date.now() > deadline) throw timedOut(filename, timeoutMs);
    sleepSync(waitMs());
  }

  try {
    return fn();
  } finally {
    release(lockPath, token);
  }
}

/**
 * Write a JSON store the way `store/data.ts` does: to a per-process temp file,
 * then `rename` over the target. Rename is atomic within a filesystem, so a
 * crash (or an OOM kill) mid-write leaves the previous file intact instead of a
 * truncated one.
 *
 * The engine's own write sites — dispatcher, run-task, lifecycle, harness —
 * used a plain `writeFileSync` and could leave a torn `tasks.json` that every
 * reader then treats as an empty board (R3). They all already import the lock
 * from here, so the second half of the same discipline lives here too rather
 * than being copy-pasted into four files.
 *
 * Locking is the CALLER's job: this is the write, not the critical section.
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, file);
}

/**
 * `withFileLock` for callers that can await — the same cross-process lock,
 * without blocking the event loop while waiting for it.
 *
 * This is what `store/data.ts` uses, so the HTTP routes and the engine's
 * detached children finally serialize against each other (R1) without the API
 * freezing behind a busy daemon.
 *
 * A lock held by this process is waited on normally here (unlike the sync path):
 * the holder is another awaiting caller, and it will release.
 */
export async function withFileLockAsync<T>(
  filename: string,
  fn: () => Promise<T>,
  timeoutMs = 15000,
): Promise<T> {
  const lockPath = path.join(LOCKS_DIR, `${filename}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  let steals = 0;

  for (;;) {
    const state = tryAcquire(lockPath, token);
    if (state === 'acquired') break;
    if (state === 'held-dead') {
      if (steals++ >= MAX_STEALS) throw timedOut(filename, timeoutMs);
      breakLock(lockPath);
      continue;
    }
    if (Date.now() > deadline) throw timedOut(filename, timeoutMs);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs()));
  }

  try {
    return await fn();
  } finally {
    release(lockPath, token);
  }
}
