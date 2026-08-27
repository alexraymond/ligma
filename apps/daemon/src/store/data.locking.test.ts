import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * The store's write discipline: fresh-install tolerance, cross-process locking,
 * atomic writes.
 *
 * Covers the three findings that shared one root (P1, P3/R1, R3):
 *  - the six strict `mutate*` helpers used a raw `readFile` and threw on a fresh
 *    data root, so a brand-new install's FIRST write 500'd with a raw ENOENT;
 *  - mutations held only an in-process mutex, so a second process over the same
 *    store lost writes and the daemon's own detached children (which take the
 *    `withFileLock` mkdir lock) were never excluded;
 *  - writes were plain overwrites, so a crash mid-write left torn JSON.
 *
 * Throwaway data dir pattern — LIGMA_DATA_DIR set BEFORE importing modules that
 * read DATA_DIR.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-store-locking-'));
process.env.LIGMA_DATA_DIR = dataDir;

const {
  mutateTasks,
  mutateGoals,
  mutateProjects,
  mutateBrainDump,
  mutateInbox,
  mutateDecisions,
  getTasks,
  saveTasks,
} = await import('./data');
const { withFileLock } = await import('../engine/file-lock');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const read = (name: string): unknown => JSON.parse(readFileSync(path.join(dataDir, name), 'utf-8'));

describe('a fresh data root (P1)', () => {
  it('lets the six strict mutate helpers create their store instead of throwing ENOENT', async () => {
    // Nothing has ever written any of these — exactly the state of a default
    // ~/.ligma/data install at the moment the composer submits for the first time.
    expect(existsSync(path.join(dataDir, 'projects.json'))).toBe(false);

    await mutateProjects(async (data) => {
      data.projects.push({ id: 'proj_1' } as never);
    });
    await mutateTasks(async (data) => {
      data.tasks.push({ id: 'task_1' } as never);
    });
    await mutateGoals(async (data) => {
      data.goals.push({ id: 'goal_1' } as never);
    });
    await mutateBrainDump(async (data) => {
      data.entries.push({ id: 'bd_1' } as never);
    });
    await mutateInbox(async (data) => {
      data.messages.push({ id: 'msg_1' } as never);
    });
    await mutateDecisions(async (data) => {
      data.decisions.push({ id: 'dec_1' } as never);
    });

    expect(read('projects.json')).toEqual({ projects: [{ id: 'proj_1' }] });
    expect(read('tasks.json')).toEqual({ tasks: [{ id: 'task_1' }] });
    expect(read('goals.json')).toEqual({ goals: [{ id: 'goal_1' }] });
    expect(read('brain-dump.json')).toEqual({ entries: [{ id: 'bd_1' }] });
    expect(read('inbox.json')).toEqual({ messages: [{ id: 'msg_1' }] });
    expect(read('decisions.json')).toEqual({ decisions: [{ id: 'dec_1' }] });
  });
});

describe('write discipline', () => {
  it('writes atomically — no torn file, and no temp file left behind (R3)', async () => {
    await saveTasks({ tasks: [] } as never);
    await mutateTasks(async (data) => {
      data.tasks.push({ id: 'task_atomic' } as never);
    });

    // A rename-based write leaves the target valid at every instant and leaves
    // no `.tmp` residue once it lands.
    expect(readdirSync(dataDir).filter((f) => f.includes('.tmp'))).toEqual([]);
    expect(await getTasks()).toEqual({ tasks: [{ id: 'task_atomic' }] });
  });

  it("takes the engine's cross-process lock, under the engine's own lock name (R1/P3)", async () => {
    // `withFileLock("tasks", …)` is what dispatcher.ts, run-task.ts, lifecycle.ts
    // and harness/verdict.ts take. If the store used a different name — or no
    // file lock at all — the two disciplines would not exclude each other, which
    // is the whole finding.
    let sawLockHeld = false;
    await mutateTasks(async () => {
      const lockDir = path.join(dataDir, '.locks', 'tasks.lock');
      sawLockHeld = existsSync(lockDir);
      const owner = JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf-8')) as {
        pid: number;
      };
      expect(owner.pid).toBe(process.pid);
    });
    expect(sawLockHeld).toBe(true);

    // And it is released afterwards: the engine's synchronous holder can take it.
    expect(withFileLock('tasks', () => 'engine got it')).toBe('engine got it');
  });

  it('does not write when the callback throws (implicit rollback)', async () => {
    const before = await getTasks();
    await expect(
      mutateTasks(async (data) => {
        data.tasks.push({ id: 'task_never' } as never);
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(await getTasks()).toEqual(before);
  });
});

describe('withFileLock (E3)', () => {
  const lockName = 'test-e3';
  const lockDir = path.join(dataDir, '.locks', `${lockName}.lock`);

  it('breaks a lock whose holder is dead, and only that kind', () => {
    // A holder that crashed before its `finally` ran: pid 0 is never a live
    // process this can signal.
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, 'owner.json'),
      JSON.stringify({ pid: 2147483646, token: 'ghost', at: Date.now() }),
      'utf-8',
    );

    // No 15s wait: a dead holder is broken on the first attempt.
    const started = Date.now();
    expect(withFileLock(lockName, () => 'taken', 30_000)).toBe('taken');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(existsSync(lockDir)).toBe(false);
  });

  it('refuses rather than silently steals from a live holder', () => {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, 'owner.json'),
      // A live pid that is NOT us — our own parent will do; it outlives this test.
      JSON.stringify({ pid: process.ppid, token: 'someone-else', at: Date.now() }),
      'utf-8',
    );

    expect(() => withFileLock(lockName, () => 'stolen', 200)).toThrow(/Timed out/);
    // The victim's lock is still theirs.
    expect(existsSync(lockDir)).toBe(true);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('names a same-process re-entry as the deadlock it is', () => {
    expect(() =>
      withFileLock(lockName, () => withFileLock(lockName, () => 'never', 200), 200),
    ).toThrow(/Deadlock/);
    expect(existsSync(lockDir)).toBe(false);
  });
});
