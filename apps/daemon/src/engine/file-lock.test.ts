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
 * `writeJsonAtomic` — the engine's half of the store-write discipline (R3).
 *
 * The dispatcher, run-task, lifecycle and the harness all used a plain
 * `writeFileSync`, which truncates the target first: a process killed between
 * the truncate and the last byte leaves a tasks.json that every reader parses
 * as an empty board, and the daemon then re-dispatches the lot. The property
 * under test is the one rename buys — a write that cannot complete leaves the
 * PREVIOUS file exactly as it was.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-atomic-write-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { writeJsonAtomic } = await import('./file-lock');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('writeJsonAtomic', () => {
  it('writes the store and leaves no temp file behind', () => {
    const file = path.join(dataDir, 'tasks.json');
    writeJsonAtomic(file, { tasks: [{ id: 'task_1' }] });

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ tasks: [{ id: 'task_1' }] });
    expect(readdirSync(dataDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves the previous contents intact when the write cannot complete', () => {
    const file = path.join(dataDir, 'survivor.json');
    const good = { tasks: [{ id: 'task_keep' }] };
    writeJsonAtomic(file, good);

    // Block the temp path with a directory: the staged write fails, so the
    // rename never happens. A plain writeFileSync would already have truncated
    // the real file by this point.
    const tmp = `${file}.${process.pid}.tmp`;
    mkdirSync(tmp, { recursive: true });
    try {
      expect(() => writeJsonAtomic(file, { tasks: [{ id: 'task_lost' }] })).toThrow();
      expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(good);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('replaces an existing store in one step rather than growing into it', () => {
    const file = path.join(dataDir, 'replace.json');
    writeFileSync(
      file,
      JSON.stringify({ tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
      'utf-8',
    );
    writeJsonAtomic(file, { tasks: [] });

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ tasks: [] });
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});
