import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../src/http';

// Spying on a live fs/promises.readFile call count (to prove the route stops
// reading early) requires intercepting the module before the route imports
// it — native ESM exports aren't spy-able after the fact. vi.mock's factory
// is hoisted above this file's top-level code, so the spy itself has to be
// created inside vi.hoisted() to avoid a temporal-dead-zone reference.
const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  readFileMock.mockImplementation(actual.readFile);
  return { ...actual, readFile: readFileMock };
});

// Isolated fixture root — doesn't touch __tests__/fixtures/verification-run,
// which other suites (verification-api.test.ts) rely on.
let root: string;
let originalEnv: string | undefined;

async function makeRun(
  id: string,
  taskId: string,
  startedAt: string,
  projectId: string | null = null,
) {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'run.json'),
    JSON.stringify({ id, taskId, projectId, startedAt, status: 'complete' }),
    'utf-8',
  );
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mc-vruns-'));
  originalEnv = process.env.VERIFICATION_RUNS_DIR;
  process.env.VERIFICATION_RUNS_DIR = root;

  // Directory names are timestamp-ordered (vrun_<ms>), oldest to newest.
  // task_a/task_c live in proj_x, task_b in proj_y — exercises the projectId
  // filter independently of the taskId one (F1).
  await makeRun('vrun_1000000000000', 'task_a', '2001-09-09T01:46:40.000Z', 'proj_x');
  await makeRun('vrun_2000000000000', 'task_b', '2033-05-18T03:33:20.000Z', 'proj_y');
  await makeRun('vrun_3000000000000', 'task_a', '2065-01-24T05:20:00.000Z', 'proj_x');
  await makeRun('vrun_4000000000000', 'task_c', '2096-10-01T07:06:40.000Z', 'proj_x');
});

afterAll(async () => {
  process.env.VERIFICATION_RUNS_DIR = originalEnv;
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  readFileMock.mockClear();
});

// Route module reads process.env.VERIFICATION_RUNS_DIR at request time.
import { GET } from '../src/routes/verification-runs/route';

function list(query = ''): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/verification-runs${query}`));
}

describe('GET /api/verification-runs — taskId filter', () => {
  it('returns only runs for the given task, newest first', async () => {
    const res = await list('?taskId=task_a');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual([
      'vrun_3000000000000',
      'vrun_1000000000000',
    ]);
  });

  it('returns an empty list for a task with no runs', async () => {
    const res = await list('?taskId=task_nonexistent');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs).toEqual([]);
  });
});

describe('GET /api/verification-runs — projectId filter', () => {
  it('returns only runs for the given project, newest first', async () => {
    const res = await list('?projectId=proj_x');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual([
      'vrun_4000000000000',
      'vrun_3000000000000',
      'vrun_1000000000000',
    ]);
  });

  it("does not silently truncate a project's evidence once other projects' runs exceed the default limit", async () => {
    // Regression for F1: an unfiltered/client-filtered list truncated at the
    // default limit before a project's older runs were ever inspected. A
    // limit of 1 with the filter server-side still finds proj_y's one run
    // even though newer runs belong to other projects.
    const res = await list('?projectId=proj_y&limit=1');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual(['vrun_2000000000000']);
  });

  it('combines with taskId — both filters narrow the same list', async () => {
    const res = await list('?projectId=proj_x&taskId=task_a');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual([
      'vrun_3000000000000',
      'vrun_1000000000000',
    ]);
  });

  it('returns an empty list for a project with no runs', async () => {
    const res = await list('?projectId=proj_nonexistent');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs).toEqual([]);
  });
});

describe('GET /api/verification-runs — newest-first via directory-name order', () => {
  it('orders the default (unfiltered) listing newest first', async () => {
    const res = await list();
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual([
      'vrun_4000000000000',
      'vrun_3000000000000',
      'vrun_2000000000000',
      'vrun_1000000000000',
    ]);
  });
});

describe('GET /api/verification-runs — bounded reads', () => {
  it('?limit=1 reads at most one run.json instead of the whole directory', async () => {
    const res = await list('?limit=1');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe('vrun_4000000000000'); // newest
    expect(readFileMock).toHaveBeenCalledTimes(1); // did not open the other 3 run.json files
  });

  it('a taskId filter stops reading as soon as the limit is satisfied, not at the end of history', async () => {
    // task_b's only run is the 2nd-newest directory — a limit=1 match should
    // stop there without reading vrun_1000000000000 too.
    const res = await list('?taskId=task_b&limit=1');
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual(['vrun_2000000000000']);
    expect(readFileMock).toHaveBeenCalledTimes(3); // 4000..(no match), 3000..(no match), 2000..(match) — stops before 1000..
  });
});
