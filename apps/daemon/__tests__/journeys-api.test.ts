import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Journey, JourneyListResponse, ProjectKnowledge } from '@ligma/api';
/**
 * The Phase 3 project routes over real HTTP, against a throwaway data dir.
 *
 * This is the wiring proof: `routes/index.ts` mounts by descending path length,
 * so `/api/projects/adopt` must not be eaten by `/api/projects/:id`, and
 * `/api/projects/:id/journeys/:jid/run` must not be eaten by its parents. A
 * route that exists but is unreachable is exactly the seam defect the product
 * exists to kill (UX spec §8.1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-journeys-api-'));
process.env.LIGMA_DATA_DIR = dataDir;

const PROJECT_ID = 'proj_api_test';
const BARE_ID = 'proj_no_repo';

const repo = mkdtempSync(path.join(os.tmpdir(), 'ligma-journeys-repo-'));
execFileSync('git', ['init', '-q'], { cwd: repo });

mkdirSync(dataDir, { recursive: true });
const project = (id: string, repoPath: string | null) => ({
  id,
  name: id,
  description: '',
  status: 'active',
  color: '#000',
  teamMembers: [],
  createdAt: '2026-08-11T00:00:00.000Z',
  tags: [],
  deletedAt: null,
  repoPath,
  shape: 'ui',
});
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({ projects: [project(PROJECT_ID, repo), project(BARE_ID, null)] }),
  'utf-8',
);
for (const f of ['tasks.json', 'goals.json']) {
  writeFileSync(
    path.join(dataDir, f),
    JSON.stringify(f === 'tasks.json' ? { tasks: [] } : { goals: [] }),
    'utf-8',
  );
}

const { createApp } = await import('../src/server');

let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

const get = (p: string) => fetch(`${base}${p}`);
const send = (method: string, p: string, body: unknown) =>
  fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('PATCH /api/projects/:id', () => {
  it('sets shape and repoPath, and rejects an unknown shape', async () => {
    const ok = await send('PATCH', `/api/projects/${PROJECT_ID}`, { shape: 'mixed' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { shape: string }).shape).toBe('mixed');

    expect((await send('PATCH', `/api/projects/${PROJECT_ID}`, { shape: 'sideways' })).status).toBe(
      400,
    );
    expect((await send('PATCH', '/api/projects/proj_nope', { shape: 'ui' })).status).toBe(404);

    await send('PATCH', `/api/projects/${PROJECT_ID}`, { shape: 'ui' });
  });

  it('does not shadow the collection route', async () => {
    expect((await get('/api/projects')).status).toBe(200);
  });
});

describe('journeys', () => {
  let created: Journey;

  it("creates one in the repo's .ligma/journeys/", async () => {
    const res = await send('POST', `/api/projects/${PROJECT_ID}/journeys`, {
      title: 'Capture a thought',
      goal: 'Get an idea into the product',
      steps: ['write it down'],
      tags: ['core'],
      origin: 'human',
      schedule: null,
    });
    expect(res.status).toBe(201);
    created = (await res.json()) as Journey;
    expect(existsSync(path.join(repo, '.ligma', 'journeys', `${created.id}.json`))).toBe(true);
  });

  it('lists and patches it', async () => {
    const list = (await (await get(`/api/projects/${PROJECT_ID}/journeys`)).json()) as {
      journeys: Journey[];
    };
    expect(list.journeys.map((j) => j.id)).toEqual([created.id]);

    const patched = await send('PATCH', `/api/projects/${PROJECT_ID}/journeys/${created.id}`, {
      title: 'Renamed',
    });
    expect(patched.status).toBe(200);
    const after = (await patched.json()) as Journey;
    expect(after.title).toBe('Renamed');
    // A partial patch must not drop the rest of the journey.
    expect(after.steps).toEqual(['write it down']);
  });

  it('404s a journey that is not there', async () => {
    expect((await get(`/api/projects/${PROJECT_ID}/journeys/jrn_nope`)).status).toBe(404);
    expect(
      (await send('PATCH', `/api/projects/${PROJECT_ID}/journeys/jrn_nope`, { title: 'x' })).status,
    ).toBe(404);
  });

  it('409s a project with no repoPath instead of pretending it has none', async () => {
    const res = await get(`/api/projects/${BARE_ID}/journeys`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('repoPath');
  });

  it('refuses to run a journey with no boot recipe — before booting anything', async () => {
    const res = await send('POST', `/api/projects/${PROJECT_ID}/journeys/${created.id}/run`, {});
    expect(res.status).toBe(409);
    expect((await res.json()) as { bootStatus: string }).toMatchObject({ bootStatus: 'missing' });
  });

  it('deletes it', async () => {
    expect(
      (
        await fetch(`${base}/api/projects/${PROJECT_ID}/journeys/${created.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/api/projects/${PROJECT_ID}/journeys/${created.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);
  });
});

describe('knowledge', () => {
  it('renders .ligma/ and appends to project.md', async () => {
    const appended = await send('POST', `/api/projects/${PROJECT_ID}/knowledge/append`, {
      note: 'The dev server needs PORT set.',
      source: 'vrun_1',
    });
    expect(appended.status).toBe(200);

    const knowledge = (await (
      await get(`/api/projects/${PROJECT_ID}/knowledge`)
    ).json()) as ProjectKnowledge;
    expect(knowledge.bootStatus).toBe('missing');
    expect(knowledge.projectMd).toContain('PORT set');
    expect(knowledge.repoPath).toBe(repo);
  });

  it('answers for a project with no repo rather than erroring', async () => {
    const knowledge = (await (
      await get(`/api/projects/${BARE_ID}/knowledge`)
    ).json()) as ProjectKnowledge;
    expect(knowledge).toMatchObject({ repoPath: null, bootStatus: 'missing', journeys: [] });
  });
});

describe('baselines', () => {
  it('is read-only and says so when nothing has been characterized yet', async () => {
    const list = await get(`/api/projects/${PROJECT_ID}/baselines`);
    expect(list.status).toBe(200);
    expect((await list.json()) as { baselines: unknown[] }).toEqual({
      projectId: PROJECT_ID,
      baselines: [],
    });

    const one = await get(`/api/projects/${PROJECT_ID}/baselines/jrn_nope`);
    expect(one.status).toBe(404);
    expect(((await one.json()) as { error: string }).error).toContain('first journey run');

    // No write verb exists on the central store.
    expect((await send('POST', `/api/projects/${PROJECT_ID}/baselines`, {})).status).toBe(405);
  });
});

describe('staleness fields on the journeys list', () => {
  it('carries the last run, the last verdict and the last outcome per journey', async () => {
    const created = (await (
      await send('POST', `/api/projects/${PROJECT_ID}/journeys`, {
        title: 'Prove the thing',
        goal: 'prove it',
        steps: [],
        tags: [],
        origin: 'human',
        schedule: null,
      })
    ).json()) as Journey;

    // Nothing has run yet: the fields exist and are honestly null.
    const before = (await (
      await get(`/api/projects/${PROJECT_ID}/journeys`)
    ).json()) as JourneyListResponse;
    expect(before.journeys.find((j) => j.id === created.id)).toMatchObject({
      lastRunAt: null,
      lastVerdictAt: null,
      lastOutcome: null,
      lastRunId: null,
    });

    const runDir = path.join(dataDir, 'verification-runs', 'vrun_stale');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        id: 'vrun_stale',
        taskId: null,
        journeyId: created.id,
        projectId: PROJECT_ID,
        status: 'complete',
        verdictPath: 'verdict.json',
        startedAt: '2026-08-11T06:00:00.000Z',
        finishedAt: '2026-08-11T06:04:00.000Z',
      }),
      'utf-8',
    );
    writeFileSync(
      path.join(runDir, 'verdict.json'),
      JSON.stringify({
        runId: 'vrun_stale',
        outcome: 'failed',
        createdAt: '2026-08-11T06:04:00.000Z',
      }),
      'utf-8',
    );

    const after = (await (
      await get(`/api/projects/${PROJECT_ID}/journeys`)
    ).json()) as JourneyListResponse;
    expect(after.journeys.find((j) => j.id === created.id)).toMatchObject({
      lastRunAt: '2026-08-11T06:00:00.000Z',
      lastVerdictAt: '2026-08-11T06:04:00.000Z',
      lastOutcome: 'failed',
      lastRunId: 'vrun_stale',
    });

    await fetch(`${base}/api/projects/${PROJECT_ID}/journeys/${created.id}`, { method: 'DELETE' });
  });
});

describe('DELETE /api/projects?hard=true', () => {
  it("clears the project's central data and leaves the product repo alone", async () => {
    const central = path.join(dataDir, 'projects', PROJECT_ID);
    mkdirSync(path.join(central, 'baselines'), { recursive: true });
    writeFileSync(path.join(central, 'baselines', 'jrn_x.json'), '{}', 'utf-8');

    const res = await fetch(`${base}/api/projects?id=${PROJECT_ID}&hard=true`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, hard: true, productRepoPath: repo });

    // The central directory is gone; the repo — Alex's code — is untouched.
    expect(existsSync(central)).toBe(false);
    expect(existsSync(path.join(repo, '.ligma'))).toBe(true);

    expect(
      (await fetch(`${base}/api/projects?id=proj_nope&hard=true`, { method: 'DELETE' })).status,
    ).toBe(404);
  });
});

describe('adoption', () => {
  it('mounts /api/projects/adopt without being shadowed by /api/projects/:id', async () => {
    const res = await send('POST', '/api/projects/adopt', {
      repoPath: path.join(repo, 'does-not-exist'),
    });
    // 400 (bad path) proves the adopt handler ran; a 404/405 would mean the
    // route was swallowed by a sibling.
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('No such directory');
  });

  it('404s an unknown adoption run and its review sibling', async () => {
    expect((await get('/api/adoption/arun_nope')).status).toBe(404);
    expect((await send('POST', '/api/adoption/arun_nope/review', { journeys: [] })).status).toBe(
      400,
    );
  });
});
