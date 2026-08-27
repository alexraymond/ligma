import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TaskOutcome } from '@ligma/api';
/**
 * GET /api/tasks/:id/outcome, against a throwaway data dir.
 *
 * The two claims under test are the two the live incident broke: a builder that
 * produced files must SHOW them, and a builder that produced no summary must be
 * said to have produced none (never "no additional notes"); a verification the
 * quota governor is holding back must be visible as held back, with the time it
 * resumes, instead of living only in the daemon log.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-task-outcome-route-'));
process.env.LIGMA_DATA_DIR = dataDir;
process.env.MC_GOVERNOR_DATA_DIR = dataDir;
delete process.env.MC_RUN_OUTPUTS_DIR;

const outputs = path.join(dataDir, 'run-outputs');
mkdirSync(outputs, { recursive: true });
const vruns = path.join(dataDir, 'verification-runs');
mkdirSync(path.join(vruns, 'vrun_2'), { recursive: true });

const write = (file: string, value: unknown): void =>
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf-8');

write(path.join(dataDir, 'tasks.json'), {
  tasks: [
    {
      id: 'task_reported',
      title: 'Write the paper',
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
      verificationAttempts: 2,
      acceptanceCriteria: ['It builds'],
    },
    {
      id: 'task_silent',
      title: 'Silent build',
      kanban: 'done',
      verificationStatus: 'waived',
      verificationAttempts: 0,
      acceptanceCriteria: [],
    },
  ],
});

write(path.join(dataDir, 'active-runs.json'), {
  runs: [
    {
      id: 'run_old',
      taskId: 'task_reported',
      agentId: 'developer',
      projectId: null,
      pid: 1,
      status: 'completed',
      startedAt: '2026-08-20T09:00:00.000Z',
      completedAt: '2026-08-20T09:30:00.000Z',
      exitCode: 0,
      error: null,
      outputFile: null,
    },
    {
      id: 'run_new',
      taskId: 'task_reported',
      agentId: 'developer',
      projectId: null,
      pid: 2,
      status: 'completed',
      startedAt: '2026-08-21T09:00:00.000Z',
      completedAt: '2026-08-21T10:00:00.000Z',
      exitCode: 0,
      error: null,
      outputFile: path.join(outputs, 'run_new.jsonl'),
    },
    {
      id: 'run_silent',
      taskId: 'task_silent',
      agentId: 'developer',
      projectId: null,
      pid: 3,
      status: 'completed',
      startedAt: '2026-08-21T09:00:00.000Z',
      completedAt: '2026-08-21T09:20:00.000Z',
      exitCode: 0,
      error: null,
      outputFile: path.join(outputs, 'run_silent.jsonl'),
    },
  ],
});

write(path.join(outputs, 'run_new.report.json'), {
  summary: 'Wrote the paper and the training code.',
  artifacts: ['paper/draft.md', 'code/train.py'],
  completedSubtaskIds: [],
  reportedAt: '2026-08-21T10:00:00.000Z',
  outputLogPath: path.join(outputs, 'run_new.jsonl'),
});
// The no-summary case, exactly as recordBuilderReport persists it.
write(path.join(outputs, 'run_silent.report.json'), {
  summary: '',
  artifacts: [],
  completedSubtaskIds: [],
  reportedAt: '2026-08-21T09:20:00.000Z',
  outputLogPath: path.join(outputs, 'run_silent.jsonl'),
});

write(
  path.join(outputs, 'run_new.jsonl'),
  `${['{"ts":"2026-08-21T09:00:00.000Z","stream":"stdout","text":"first line"}', '{"ts":"2026-08-21T10:00:00.000Z","stream":"stdout","text":"wrote paper/draft.md"}'].join('\n')}\n`,
);
write(
  path.join(outputs, 'run_silent.jsonl'),
  '{"ts":"2026-08-21T09:20:00.000Z","stream":"stderr","text":"boom"}\n',
);

write(path.join(dataDir, 'inbox.json'), {
  messages: [
    {
      id: 'msg_1',
      from: 'developer',
      to: 'me',
      type: 'report',
      taskId: 'task_reported',
      subject: 'Ready for verification: Write the paper',
      body: 'Wrote the paper and the training code.\n\nArtifacts written:\n- paper/draft.md\n- code/train.py',
      status: 'unread',
      createdAt: '2026-08-21T10:00:00.000Z',
      readAt: null,
    },
  ],
});

write(path.join(vruns, 'vrun_2', 'run.json'), {
  id: 'vrun_2',
  taskId: 'task_reported',
  contractId: 'ct_1',
  contractVersion: 1,
  envId: null,
  baseCommit: '',
  status: 'error',
  pid: null,
  personaReports: [],
  verdictPath: null,
  startedAt: '2026-08-21T11:00:00.000Z',
  finishedAt: '2026-08-21T11:05:00.000Z',
  error: 'all 3 persona run(s) invalidated by an API-level fault',
  errorKind: 'governor-denied',
  causeKind: 'rate-limit',
});
write(path.join(vruns, 'vrun_2', 'verdict.json'), {
  runId: 'vrun_2',
  taskId: 'task_reported',
  contractId: 'ct_1',
  contractVersion: 1,
  outcome: 'failed',
  criterionVerdicts: [
    {
      criterionId: 'c1',
      status: 'unmet',
      reasoning: 'The export button does nothing.',
      evidence: ['shot.png'],
    },
  ],
  humanDecisions: [],
  judgeModel: 'sonnet',
  createdAt: '2026-08-21T11:05:00.000Z',
});

const { GET } = await import('./route');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.MC_GOVERNOR_DATA_DIR;
});

const get = async (
  id: string,
): Promise<{ status: number; body: TaskOutcome & { error?: string } }> => {
  const res = await GET(new Request(`http://x/api/tasks/${id}/outcome`), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: (await res.json()) as TaskOutcome & { error?: string } };
};

describe('GET /api/tasks/:id/outcome', () => {
  it('404s an unknown task', async () => {
    const { status, body } = await get('task_nope');
    expect(status).toBe(404);
    expect(body.error).toBe('Task not found');
  });

  it("serves the newest run's summary and the files it says it wrote", async () => {
    const { status, body } = await get('task_reported');
    expect(status).toBe(200);
    expect(body.builder.runId).toBe('run_new');
    expect(body.builder.summary).toBe('Wrote the paper and the training code.');
    expect(body.builder.artifacts).toEqual(['paper/draft.md', 'code/train.py']);
    expect(body.builder.inboxBody).toContain('paper/draft.md');
  });

  it('says the summary is missing rather than serving a polite blank', async () => {
    const { body } = await get('task_silent');
    // null, not "" — "the builder returned none" is a fact the UI must be able
    // to state, and it is not the same as "no run has reported yet".
    expect(body.builder.summary).toBeNull();
    expect(body.builder.artifacts).toEqual([]);
    expect(body.builder.outputLogPath).toContain('run_silent.jsonl');
    expect(body.builder.outputTail).toEqual(['boom']);
  });

  it("carries the task's own verification state and the attempt cap", async () => {
    const { body } = await get('task_reported');
    expect(body.kanban).toBe('awaiting-verification');
    expect(body.verificationStatus).toBe('unverified');
    expect(body.verificationAttempts).toBe(2);
    expect(body.maxVerificationAttempts).toBeGreaterThan(0);
  });

  it('lists verification runs with their error and its class', async () => {
    const { body } = await get('task_reported');
    expect(body.verificationRuns).toHaveLength(1);
    expect(body.verificationRuns[0]).toMatchObject({
      id: 'vrun_2',
      status: 'error',
      errorKind: 'governor-denied',
      causeKind: 'rate-limit',
    });
    expect(body.verificationRuns[0].error).toContain('API-level fault');
  });

  it("includes the latest verdict's criterion verdicts", async () => {
    const { body } = await get('task_reported');
    expect(body.latestVerdict?.outcome).toBe('failed');
    expect(body.latestVerdict?.criterionVerdicts[0]).toMatchObject({
      criterionId: 'c1',
      status: 'unmet',
      reasoning: 'The export button does nothing.',
    });
  });

  it('reports no deferral while the governor is letting work through', async () => {
    const { body } = await get('task_reported');
    expect(body.deferred).toBeNull();
  });

  it('surfaces a governor deferral with the time it resumes', async () => {
    // A full window: the same denial the dispatcher logs and nothing else showed.
    const now = Date.now();
    write(path.join(dataDir, 'quota-ledger.json'), {
      spawns: Array.from({ length: 40 }, (_, i) => ({
        ts: new Date(now - i * 1000).toISOString(),
        backend: 'claude',
        role: 'builder',
        ref: null,
      })),
      backends: {},
    });

    const { body } = await get('task_reported');
    expect(body.deferred).not.toBeNull();
    expect(body.deferred?.reason).toBe('window-exhausted');
    expect(Date.parse(body.deferred?.resumesAt ?? '')).toBeGreaterThan(now);

    // A finished task is not "waiting on quota", however full the window is.
    expect((await get('task_silent')).body.deferred).toBeNull();

    unlinkSync(path.join(dataDir, 'quota-ledger.json'));
  });
});
