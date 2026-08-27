/**
 * The contracts↔verdicts join that Home's portfolio health and the Overview's
 * criterion board are both built on.
 *
 * Runs entirely against throwaway directories: both roots are env-overridable,
 * so nothing here touches the real locker.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AcceptanceContract, Task, VerificationVerdict } from '@ligma/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let root: string;
let previous: { runs: string | undefined; contracts: string | undefined };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ligma-health-'));
  previous = { runs: process.env.VERIFICATION_RUNS_DIR, contracts: process.env.CONTRACTS_DIR };
  process.env.VERIFICATION_RUNS_DIR = path.join(root, 'verification-runs');
  process.env.CONTRACTS_DIR = path.join(root, 'contracts');
});

afterEach(() => {
  if (previous.runs === undefined) delete process.env.VERIFICATION_RUNS_DIR;
  else process.env.VERIFICATION_RUNS_DIR = previous.runs;
  if (previous.contracts === undefined) delete process.env.CONTRACTS_DIR;
  else process.env.CONTRACTS_DIR = previous.contracts;
  rmSync(root, { recursive: true, force: true });
});

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'done',
    verificationStatus: 'unverified',
    projectId: 'proj_a',
    milestoneId: null,
    assignedTo: null,
    collaborators: [],
    dailyActions: [],
    subtasks: [],
    blockedBy: [],
    estimatedMinutes: null,
    actualMinutes: null,
    acceptanceCriteria: ['it works'],
    comments: [],
    tags: [],
    notes: '',
    dueDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    ...over,
  };
}

/** Write a run directory. `mtimeMs` decides the newest-first order. */
function writeRun(
  id: string,
  manifest: Record<string, unknown>,
  verdict: VerificationVerdict | null,
  mtimeSeconds: number,
): void {
  const dir = path.join(process.env.VERIFICATION_RUNS_DIR as string, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id, ...manifest }), 'utf-8');
  if (verdict) writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify(verdict), 'utf-8');
  utimesSync(dir, mtimeSeconds, mtimeSeconds);
}

function writeContract(scope: string, contract: AcceptanceContract): void {
  const dir = process.env.CONTRACTS_DIR as string;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${scope}.jsonl`), `${JSON.stringify(contract)}\n`, 'utf-8');
}

const contract = (over: Partial<AcceptanceContract>): AcceptanceContract => ({
  id: 'ctr_1',
  version: 1,
  taskId: 'task_1',
  productId: null,
  title: 'Shorten a URL',
  baselineRunId: null,
  criteria: [
    {
      id: 'crit_1',
      kind: 'criterion',
      text: 'returns a short code',
      holdout: false,
      provenance: null,
    },
    { id: 'inv_1', kind: 'invariant', text: 'never 500s', holdout: true, provenance: null },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  signature: null,
  ...over,
});

const verdict = (over: Partial<VerificationVerdict>): VerificationVerdict => ({
  runId: 'vrun_1',
  taskId: 'task_1',
  contractId: 'ctr_1',
  contractVersion: 1,
  outcome: 'failed',
  criterionVerdicts: [],
  humanDecisions: [],
  judgeModel: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  signature: null,
  ...over,
});

describe('portfolio health', () => {
  it('counts only tasks that could ever be verified', async () => {
    const { projectHealthFor } = await import('../src/harness/health-board');
    const health = projectHealthFor('proj_a', [
      task({ id: 't1', verificationStatus: 'passed' }),
      task({ id: 't2', verificationStatus: 'failed' }),
      // No criteria: nothing about it can ever be proven, so it is not part of
      // the denominator — otherwise every project looks permanently unproven.
      task({ id: 't3', acceptanceCriteria: [] }),
      task({ id: 't4', projectId: 'proj_b', verificationStatus: 'passed' }),
    ]);
    expect(health.verifiable).toBe(2);
    expect(health.verified).toBe(1);
    expect(health.percent).toBe(50);
  });

  it('is zero, not NaN, for a project with nothing verifiable', async () => {
    const { projectHealthFor } = await import('../src/harness/health-board');
    expect(projectHealthFor('proj_a', [task({ id: 't1', acceptanceCriteria: [] })]).percent).toBe(
      0,
    );
  });

  it('carries the newest verdict behind the passing tasks, so the client can decay it', async () => {
    writeRun('vrun_old', { taskId: 't1', finishedAt: '2026-01-01T00:00:00.000Z' }, null, 1_000);
    writeRun('vrun_new', { taskId: 't2', finishedAt: '2026-03-01T00:00:00.000Z' }, null, 2_000);
    const { projectHealthFor } = await import('../src/harness/health-board');
    const health = projectHealthFor('proj_a', [
      task({ id: 't1', verificationStatus: 'passed' }),
      task({ id: 't2', verificationStatus: 'passed' }),
    ]);
    expect(health.lastVerifiedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('has no verified-at when nothing has passed — never an invented timestamp', async () => {
    writeRun('vrun_1', { taskId: 't1', finishedAt: '2026-03-01T00:00:00.000Z' }, null, 1_000);
    const { projectHealthFor } = await import('../src/harness/health-board');
    expect(
      projectHealthFor('proj_a', [task({ id: 't1', verificationStatus: 'failed' })]).lastVerifiedAt,
    ).toBeNull();
  });
});

describe('latest run per task', () => {
  it('keeps the newest run only, so a board card needs no second fetch', async () => {
    writeRun('vrun_a', { taskId: 't1', finishedAt: '2026-01-01T00:00:00.000Z' }, null, 1_000);
    writeRun('vrun_b', { taskId: 't1', finishedAt: '2026-02-01T00:00:00.000Z' }, null, 2_000);
    const { latestRunByTask } = await import('../src/harness/health-board');
    expect(latestRunByTask().get('t1')?.id).toBe('vrun_b');
  });
});

describe('criterion health board', () => {
  it("renders every criterion of the project's contracts, holdout included", async () => {
    writeContract('task_1', contract({}));
    const { criteriaHealthFor } = await import('../src/harness/health-board');
    const rows = criteriaHealthFor('proj_a', [task({ id: 'task_1' })], []);
    expect(rows.map((r) => r.criterionId)).toEqual(['crit_1', 'inv_1']);
    expect(rows.find((r) => r.criterionId === 'inv_1')?.holdout).toBe(true);
  });

  it('says unverified — never a silent pass — when no verdict has ruled', async () => {
    writeContract('task_1', contract({}));
    const { criteriaHealthFor } = await import('../src/harness/health-board');
    const rows = criteriaHealthFor('proj_a', [task({ id: 'task_1' })], []);
    expect(rows.every((r) => r.status === 'unverified')).toBe(true);
    expect(rows.every((r) => r.runId === null)).toBe(true);
  });

  it("joins the latest verdict's ruling and the run that made it", async () => {
    writeContract('task_1', contract({}));
    writeRun(
      'vrun_1',
      { taskId: 'task_1', finishedAt: '2026-02-01T00:00:00.000Z' },
      verdict({
        criterionVerdicts: [
          {
            criterionId: 'crit_1',
            status: 'not-met',
            reasoning: '404 on the short code',
            evidence: [],
          },
        ],
      }),
      1_000,
    );
    const { criteriaHealthFor } = await import('../src/harness/health-board');
    const rows = criteriaHealthFor('proj_a', [task({ id: 'task_1' })], []);
    const ruled = rows.find((r) => r.criterionId === 'crit_1');
    expect(ruled?.status).toBe('not-met');
    expect(ruled?.reasoning).toBe('404 on the short code');
    expect(ruled?.runId).toBe('vrun_1');
    expect(ruled?.verifiedAt).toBe('2026-02-01T00:00:00.000Z');
    // Untouched by that verdict, so still honestly unverified.
    expect(rows.find((r) => r.criterionId === 'inv_1')?.status).toBe('unverified');
  });

  it('leaves a criterion unverified when the harness errored — an error is not a defect', async () => {
    writeContract('task_1', contract({}));
    writeRun(
      'vrun_1',
      { taskId: 'task_1', finishedAt: '2026-02-01T00:00:00.000Z' },
      verdict({
        outcome: 'error',
        criterionVerdicts: [
          { criterionId: 'crit_1', status: 'not-met', reasoning: 'judge crashed', evidence: [] },
        ],
      }),
      1_000,
    );
    const { criteriaHealthFor } = await import('../src/harness/health-board');
    expect(criteriaHealthFor('proj_a', [task({ id: 'task_1' })], [])[0].status).toBe('unverified');
  });

  it('includes journey contracts, scoped project__journey', async () => {
    writeContract(
      'proj_a__jrn_checkout',
      contract({ taskId: null, productId: 'proj_a__jrn_checkout', title: 'Check out' }),
    );
    const { criteriaHealthFor } = await import('../src/harness/health-board');
    const rows = criteriaHealthFor('proj_a', [], ['jrn_checkout']);
    expect(rows).toHaveLength(2);
    expect(rows[0].journeyId).toBe('jrn_checkout');
    expect(rows[0].taskId).toBeNull();
  });

  it('reads the highest contract version — an edited oracle is the current one', async () => {
    const dir = process.env.CONTRACTS_DIR as string;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'task_1.jsonl'),
      `${JSON.stringify(contract({ version: 1 }))}\n${JSON.stringify(
        contract({
          version: 2,
          criteria: [
            { id: 'crit_9', kind: 'criterion', text: 'v2 rule', holdout: false, provenance: null },
          ],
        }),
      )}\n`,
      'utf-8',
    );
    const { criteriaHealthFor } = await import('../src/harness/health-board');
    expect(
      criteriaHealthFor('proj_a', [task({ id: 'task_1' })], []).map((r) => r.criterionId),
    ).toEqual(['crit_9']);
  });
});
