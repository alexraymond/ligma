/**
 * The regression corpus: what a failed verdict files, and what the Verify tab
 * reads back.
 *
 * Probes live under `LIGMA_DATA_DIR`, so the whole suite runs against a
 * throwaway data dir and never touches the real central store.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AcceptanceContract, VerificationVerdict } from '@ligma/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previous: string | undefined;

beforeEach(() => {
  previous = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-probes-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  writeFileSync(
    path.join(dataDir, 'projects.json'),
    JSON.stringify({ projects: [PROJECT] }),
    'utf-8',
  );
  // paths.ts resolves DATA_DIR at import time, so every module under test is
  // re-imported against this run's throwaway dir.
  vi.resetModules();
});

afterEach(() => {
  if (previous === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previous;
  rmSync(dataDir, { recursive: true, force: true });
});

const PROJECT = {
  id: 'proj_a',
  name: 'A',
  description: '',
  status: 'active',
  color: '#fff',
  teamMembers: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  deletedAt: null,
};

const probes = () => import('../src/harness/probes');
const probesRoute = () => import('../src/routes/projects/_id/probes/route');

const contract: AcceptanceContract = {
  id: 'ctr_1',
  version: 1,
  taskId: null,
  productId: 'proj_a__jrn_checkout',
  title: 'Check out with a saved card',
  baselineRunId: null,
  criteria: [
    {
      id: 'crit_1',
      kind: 'criterion',
      text: 'the order confirmation names the card',
      holdout: false,
      provenance: null,
    },
    {
      id: 'crit_2',
      kind: 'criterion',
      text: 'the total matches the basket',
      holdout: true,
      provenance: null,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  signature: null,
};

const verdict = (over: Partial<VerificationVerdict> = {}): VerificationVerdict => ({
  runId: 'vrun_1',
  taskId: null,
  journeyId: 'jrn_checkout',
  projectId: 'proj_a',
  contractId: 'ctr_1',
  contractVersion: 1,
  outcome: 'failed',
  criterionVerdicts: [
    {
      criterionId: 'crit_1',
      status: 'not-met',
      reasoning: 'the confirmation page showed no card at all',
      evidence: ['personas/naive-user/records/POST-checkout.json'],
    },
    { criterionId: 'crit_2', status: 'met', reasoning: 'totals matched', evidence: [] },
  ],
  humanDecisions: [],
  judgeModel: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  signature: null,
  ...over,
});

describe('recording probes', () => {
  it('files one probe per criterion the judge ruled against, and none for the ones it met', async () => {
    const { recordProbes } = await probes();
    const written = recordProbes('proj_a', verdict(), contract);
    expect(written).toHaveLength(1);
    expect(written[0].criterionId).toBe('crit_1');
  });

  it("carries the failing step's own record, the criterion's wording and the origin verdict", async () => {
    const { recordProbes } = await probes();
    const [probe] = recordProbes('proj_a', verdict(), contract);
    expect(probe.recordPath).toBe('personas/naive-user/records/POST-checkout.json');
    expect(probe.criterionText).toBe('the order confirmation names the card');
    expect(probe.runId).toBe('vrun_1');
    expect(probe.journeyId).toBe('jrn_checkout');
    expect(probe.reasoning).toContain('no card at all');
  });

  it('files nothing for a passed verdict, and nothing for a harness error', async () => {
    const { recordProbes, listProbes } = await probes();
    expect(recordProbes('proj_a', verdict({ outcome: 'passed' }), contract)).toEqual([]);
    // An `error` proved nothing about the product — it must never enter a
    // corpus of product defects (principle 12).
    expect(recordProbes('proj_a', verdict({ outcome: 'error' }), contract)).toEqual([]);
    expect(listProbes('proj_a')).toEqual([]);
  });

  it('is idempotent: re-processing one verdict does not double the corpus', async () => {
    const { recordProbes, listProbes } = await probes();
    recordProbes('proj_a', verdict(), contract);
    recordProbes('proj_a', verdict(), contract);
    expect(listProbes('proj_a')).toHaveLength(1);
  });

  it('still records when the contract cannot be read — the id beats losing the entry', async () => {
    const { recordProbes } = await probes();
    const [probe] = recordProbes('proj_a', verdict(), null);
    expect(probe.criterionText).toBe('crit_1');
  });

  it('records an uncited failure with a null record rather than dropping it', async () => {
    const { recordProbes } = await probes();
    const [probe] = recordProbes(
      'proj_a',
      verdict({
        criterionVerdicts: [
          { criterionId: 'crit_1', status: 'unknown', reasoning: 'no evidence', evidence: [] },
        ],
      }),
      contract,
    );
    expect(probe.recordPath).toBeNull();
  });
});

describe('reading the corpus', () => {
  it('is empty for a project that has never failed', async () => {
    const { listProbes } = await probes();
    expect(listProbes('proj_never')).toEqual([]);
  });

  it('serves the corpus through the project route, newest first', async () => {
    const mod = await probes();
    mod.recordProbes('proj_a', verdict(), contract);

    const { GET } = await probesRoute();
    const res = await GET(new Request('http://localhost/api/projects/proj_a/probes'), {
      params: Promise.resolve({ id: 'proj_a' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projectId: string;
      probes: Array<{ criterionId: string }>;
    };
    expect(body.projectId).toBe('proj_a');
    expect(body.probes.map((p) => p.criterionId)).toEqual(['crit_1']);
  });

  it('404s for a project that does not exist', async () => {
    const { GET } = await probesRoute();
    const res = await GET(new Request('http://localhost/api/projects/nope/probes'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
