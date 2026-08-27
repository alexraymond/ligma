import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from '../src/http';

const FIXTURE_ROOT = path.join(process.cwd(), '__tests__/fixtures/verification-run');
const CONTRACTS_FIXTURE_ROOT = path.join(process.cwd(), '__tests__/fixtures/contracts');

beforeAll(() => {
  process.env.VERIFICATION_RUNS_DIR = FIXTURE_ROOT;
  process.env.CONTRACTS_DIR = CONTRACTS_FIXTURE_ROOT;
});

import { GET as getContracts } from '../src/routes/contracts/_scope/route';
import { GET as getArtifacts } from '../src/routes/verification-runs/_id/artifacts/route';
import { GET as getFile } from '../src/routes/verification-runs/_id/file/route';
import { GET as getRun } from '../src/routes/verification-runs/_id/route';
// Route modules read process.env.VERIFICATION_RUNS_DIR at request time, so a
// single import after the env var is set works for every test below.
import { GET as listRuns } from '../src/routes/verification-runs/route';

type RunsListBody = { runs: Array<{ id: string; status: string }> };
type RunDetailBody = {
  run: { id: string };
  verdict: { outcome: string; criterionVerdicts: unknown[] };
  personaReports: Array<{ charter: string }>;
};
type ArtifactsBody = { artifacts: unknown; truncated: boolean };
type ContractsBody = { scope: string; contracts: Array<{ version: number; criteria: unknown }> };

describe('GET /api/verification-runs (list)', () => {
  it('lists the fixture run, newest first', async () => {
    const res = await listRuns(new NextRequest('http://localhost/api/verification-runs'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunsListBody;
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe('vrun_fixture');
    expect(body.runs[0].status).toBe('complete');
  });

  it('respects the limit param', async () => {
    const res = await listRuns(new NextRequest('http://localhost/api/verification-runs?limit=0'));
    const body = (await res.json()) as RunsListBody;
    // limit is clamped to a minimum of 1, so a run still comes back
    expect(body.runs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/verification-runs/[id] (detail)', () => {
  it('inlines run, verdict, and all persona reports', async () => {
    const res = await getRun(
      new NextRequest('http://localhost/api/verification-runs/vrun_fixture'),
      {
        params: Promise.resolve({ id: 'vrun_fixture' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunDetailBody;
    expect(body.run.id).toBe('vrun_fixture');
    expect(body.verdict.outcome).toBe('failed');
    expect(body.verdict.criterionVerdicts).toHaveLength(5);
    expect(body.personaReports).toHaveLength(4);
    const charters = body.personaReports.map((p: { charter: string }) => p.charter).sort();
    expect(charters).toEqual(['naive-user', 'naive-user', 'saboteur', 'spec-auditor']);
  });

  it('404s for an unknown run id', async () => {
    const res = await getRun(new NextRequest('http://localhost/api/verification-runs/vrun_nope'), {
      params: Promise.resolve({ id: 'vrun_nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s for a run id containing path segments', async () => {
    const res = await getRun(
      new NextRequest('http://localhost/api/verification-runs/..%2F..%2Fdata'),
      {
        params: Promise.resolve({ id: '../../data' }),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/verification-runs/[id]/file (evidence streaming)', () => {
  it('streams a PNG with the correct content-type and valid magic bytes', async () => {
    const relPath = 'personas/spec-auditor/shots/01-criterion-crit_1.png';
    const res = await getFile(
      new NextRequest(
        `http://localhost/api/verification-runs/vrun_fixture/file?path=${encodeURIComponent(relPath)}`,
      ),
      { params: Promise.resolve({ id: 'vrun_fixture' }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(buf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('streams a jsonl file with the correct content-type', async () => {
    const relPath = 'personas/naive-user-1/steps.jsonl';
    const res = await getFile(
      new NextRequest(
        `http://localhost/api/verification-runs/vrun_fixture/file?path=${encodeURIComponent(relPath)}`,
      ),
      { params: Promise.resolve({ id: 'vrun_fixture' }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
  });

  it('404s for a missing file within a valid run', async () => {
    const res = await getFile(
      new NextRequest(
        'http://localhost/api/verification-runs/vrun_fixture/file?path=personas/nope.json',
      ),
      { params: Promise.resolve({ id: 'vrun_fixture' }) },
    );
    expect(res.status).toBe(404);
  });

  it('400s on path traversal (../../tasks.json)', async () => {
    const res = await getFile(
      new NextRequest(
        'http://localhost/api/verification-runs/vrun_fixture/file?path=../../tasks.json',
      ),
      { params: Promise.resolve({ id: 'vrun_fixture' }) },
    );
    expect(res.status).toBe(400);
  });

  it('400s on an absolute path escape attempt', async () => {
    const res = await getFile(
      new NextRequest('http://localhost/api/verification-runs/vrun_fixture/file?path=/etc/passwd'),
      { params: Promise.resolve({ id: 'vrun_fixture' }) },
    );
    expect(res.status).toBe(400);
  });

  it('400s when path query param is missing', async () => {
    const res = await getFile(
      new NextRequest('http://localhost/api/verification-runs/vrun_fixture/file'),
      {
        params: Promise.resolve({ id: 'vrun_fixture' }),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/verification-runs/[id]/artifacts (evidence listing)', () => {
  async function list(id: string) {
    const res = await getArtifacts(
      new NextRequest(`http://localhost/api/verification-runs/${id}/artifacts`),
      {
        params: Promise.resolve({ id }),
      },
    );
    return { res, body: (await res.json()) as ArtifactsBody };
  }

  it('lists every file in the run dir with a size and a kind', async () => {
    const { res, body } = await list('vrun_fixture');
    expect(res.status).toBe(200);
    const artifacts = body.artifacts as Array<{ path: string; size: number; kind: string }>;
    expect(body.truncated).toBe(false);

    const byPath = new Map(artifacts.map((a) => [a.path, a]));
    expect(byPath.get('run.json')?.kind).toBe('report');
    expect(byPath.get('verdict.json')?.kind).toBe('report');
    expect(byPath.get('personas/naive-user-1/steps.jsonl')?.kind).toBe('steps');
    expect(byPath.get('personas/naive-user-1/transcript.jsonl')?.kind).toBe('transcript');
    expect(byPath.get('personas/naive-user-1/shots/01-landing.png')?.kind).toBe('screenshot');
    for (const a of artifacts) expect(a.size).toBeGreaterThan(0);
  });

  it('surfaces screenshots that nothing in the verdict cites', async () => {
    const { body } = await list('vrun_fixture');
    const shots = (body.artifacts as Array<{ path: string; kind: string }>)
      .filter((a) => a.kind === 'screenshot')
      .map((a) => a.path);

    const verdict = JSON.parse(
      await readFile(path.join(FIXTURE_ROOT, 'vrun_fixture/verdict.json'), 'utf-8'),
    ) as { criterionVerdicts: Array<{ evidence: string[] }> };
    const cited = new Set(verdict.criterionVerdicts.flatMap((c) => c.evidence));

    const uncited = shots.filter((s) => !cited.has(s));
    // The bridge shoots every step; the judge cites a handful. The listing is
    // the only place the rest of the evidence exists.
    expect(uncited.length).toBeGreaterThan(0);
    expect(shots.length).toBeGreaterThan(cited.size);
  });

  it('404s for an unknown run id', async () => {
    const { res } = await list('vrun_nope');
    expect(res.status).toBe(404);
  });

  it('400s for a run id containing path segments', async () => {
    const { res } = await list('../../data');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/contracts/[scope]', () => {
  async function get(scope: string, query = '') {
    const res = await getContracts(
      new NextRequest(`http://localhost/api/contracts/${scope}${query}`),
      {
        params: Promise.resolve({ scope }),
      },
    );
    return { res, body: (await res.json()) as ContractsBody };
  }

  it('returns every version for the scope, ascending', async () => {
    const { res, body } = await get('task_sf001');
    expect(res.status).toBe(200);
    expect(body.scope).toBe('task_sf001');
    expect(body.contracts.map((c: { version: number }) => c.version)).toEqual([1, 2]);
  });

  it('returns criterion text, kind, and holdout flags — the verdict only has ids', async () => {
    const { body } = await get('task_sf001', '?version=1');
    expect(body.contracts).toHaveLength(1);
    const criteria = body.contracts[0].criteria as Array<{
      id: string;
      kind: string;
      text: string;
      holdout: boolean;
    }>;
    expect(criteria.map((c) => c.id)).toEqual(['crit_1', 'crit_2', 'crit_3', 'crit_4', 'crit_5']);
    expect(criteria[0].text).toContain('character sheet');
    expect(criteria.find((c) => c.id === 'crit_4')?.kind).toBe('invariant');
    expect(criteria.filter((c) => c.holdout).map((c) => c.id)).toEqual(['crit_3', 'crit_5']);
  });

  it('404s for an unknown version of a known scope', async () => {
    const { res } = await get('task_sf001', '?version=99');
    expect(res.status).toBe(404);
  });

  it('404s for a scope with no contract on disk', async () => {
    const { res } = await get('task_nope');
    expect(res.status).toBe(404);
  });

  it('400s on a traversal scope', async () => {
    const { res } = await get('../../data/tasks');
    expect(res.status).toBe(400);
  });

  it('400s on an absolute-path scope', async () => {
    const { res } = await get('/etc/passwd');
    expect(res.status).toBe(400);
  });
});
