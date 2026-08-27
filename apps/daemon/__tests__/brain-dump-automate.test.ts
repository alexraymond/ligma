import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ENGINE_DIR } from '../src/paths';
import { mutateBrainDump } from '../src/store/data';
import { backupDataFiles, restoreDataFiles } from './helpers';

// D7 parity DC-6 (MC-101/102/173/264): the route used to spawn
// DAEMON_ROOT/scripts/daemon/run-brain-dump-triage.ts — the pre-monorepo
// location. The button fired, the API returned 200, and nothing ran. This
// test asserts the built argv, and that the file it names exists on disk.

const spawn = vi.hoisted(() => vi.fn(() => ({ pid: 4242, unref: vi.fn() })));
vi.mock('node:child_process', () => ({ spawn }));

import { POST } from '../src/routes/brain-dump/automate/route';

let backups: Record<string, string>;

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
});

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/brain-dump/automate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/brain-dump/automate — spawn target', () => {
  it('spawns the triage script at a path that exists', async () => {
    const id = `bd_test_automate_${Date.now()}`;
    await mutateBrainDump(async (data) => {
      data.entries.push({
        id,
        content: 'test entry',
        capturedAt: new Date().toISOString(),
        processed: false,
      } as never);
    });

    spawn.mockClear();
    const res = await post({ entryIds: [id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ entryIds: [id], count: 1, pid: 4242 });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, argv] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(bin).toBe(process.execPath);
    expect(argv.slice(0, 2)).toEqual(['--import', 'tsx']);

    const scriptPath = argv[2];
    expect(scriptPath).toBe(path.join(ENGINE_DIR, 'run-brain-dump-triage.ts'));
    expect(existsSync(scriptPath), `spawn target missing: ${scriptPath}`).toBe(true);
    expect(argv.slice(3)).toEqual([id]);
  });

  it('passes every unprocessed entry id when all:true', async () => {
    const a = `bd_test_all_a_${Date.now()}`;
    const b = `bd_test_all_b_${Date.now()}`;
    await mutateBrainDump(async (data) => {
      data.entries = [
        { id: a, content: 'a', capturedAt: new Date().toISOString(), processed: false },
        { id: b, content: 'b', capturedAt: new Date().toISOString(), processed: false },
        { id: 'done', content: 'c', capturedAt: new Date().toISOString(), processed: true },
      ] as never;
    });

    spawn.mockClear();
    const res = await post({ all: true });
    expect(res.status).toBe(200);
    const [, argv] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(argv.slice(3)).toEqual([a, b]);
    expect(existsSync(argv[2])).toBe(true);
  });
});
