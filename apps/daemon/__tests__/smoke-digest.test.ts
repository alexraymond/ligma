/**
 * Smoke schedules, the morning digest, and the staleness fields the health
 * board reads.
 *
 * The properties worth holding:
 *   - a journey's cron reaches the EXISTING scheduler, and a firing goes through
 *     the governor — a denial defers it calmly instead of failing anything;
 *   - the digest is composed from manifests and signed verdicts, never prose,
 *     and `error` survives as its own outcome all the way to the message;
 *   - no runs in the window ⇒ no message at all (silence is fine).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InboxMessage } from '@ligma/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-smoke-'));
process.env.LIGMA_DATA_DIR = dataDir;
process.env.MC_GOVERNOR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'ligma-smoke-gov-'));

const RUNS_DIR = path.join(dataDir, 'verification-runs');
const INBOX_FILE = path.join(dataDir, 'inbox.json');
const PROJECTS_FILE = path.join(dataDir, 'projects.json');

const repo = mkdtempSync(path.join(os.tmpdir(), 'ligma-smoke-repo-'));

const {
  composeDigest,
  digestBody,
  digestHeadline,
  journeyRunRows,
  journeyStatuses,
  lastDigestAt,
  smokeSchedules,
  writeSmokeDigest,
} = await import('../src/engine/smoke');
const { Scheduler } = await import('../src/engine/scheduler');

// ─── Fixtures ────────────────────────────────────────────────────────────────

function project(id: string, repoPath: string | null, deletedAt: string | null = null) {
  return {
    id,
    name: id,
    description: '',
    status: 'active',
    color: '#000',
    teamMembers: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    tags: [],
    deletedAt,
    repoPath,
    shape: 'ui',
  };
}

function writeJourney(id: string, schedule: string | null): void {
  const dir = path.join(repo, '.ligma', 'journeys');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      title: `Journey ${id}`,
      goal: 'do the thing',
      steps: ['one'],
      tags: [],
      origin: 'human',
      schedule,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }),
    'utf-8',
  );
}

/** A finished journey run on disk: manifest plus (optionally) a verdict. */
function writeRun(opts: {
  runId: string;
  projectId: string;
  journeyId: string;
  outcome?: 'passed' | 'failed' | 'error';
  status?: 'complete' | 'error' | 'running';
  startedAt: string;
  finishedAt?: string | null;
  /** Skip verdict.json entirely — a run that died before writing one. */
  noVerdict?: boolean;
}): void {
  const dir = path.join(RUNS_DIR, opts.runId);
  mkdirSync(dir, { recursive: true });
  const hasVerdict = !opts.noVerdict;
  writeFileSync(
    path.join(dir, 'run.json'),
    JSON.stringify({
      id: opts.runId,
      taskId: null,
      journeyId: opts.journeyId,
      projectId: opts.projectId,
      contractId: 'ctr_1',
      contractVersion: 1,
      envId: null,
      baseCommit: '',
      status: opts.status ?? 'complete',
      pid: 1,
      personaReports: [],
      verdictPath: hasVerdict ? 'verdict.json' : null,
      startedAt: opts.startedAt,
      finishedAt: opts.finishedAt === undefined ? opts.startedAt : opts.finishedAt,
      error: null,
    }),
    'utf-8',
  );
  if (hasVerdict) {
    writeFileSync(
      path.join(dir, 'verdict.json'),
      JSON.stringify({
        runId: opts.runId,
        taskId: null,
        journeyId: opts.journeyId,
        projectId: opts.projectId,
        contractId: 'ctr_1',
        contractVersion: 1,
        outcome: opts.outcome ?? 'passed',
        criterionVerdicts: [],
        humanDecisions: [],
        judgeModel: 'test',
        createdAt: opts.finishedAt ?? opts.startedAt,
        signature: null,
      }),
      'utf-8',
    );
  }
}

beforeEach(() => {
  rmSync(RUNS_DIR, { recursive: true, force: true });
  rmSync(path.join(repo, '.ligma'), { recursive: true, force: true });
  writeFileSync(INBOX_FILE, JSON.stringify({ messages: [] }), 'utf-8');
  writeFileSync(PROJECTS_FILE, JSON.stringify({ projects: [project('proj_1', repo)] }), 'utf-8');
});

// ─── Schedules ───────────────────────────────────────────────────────────────

describe('smokeSchedules', () => {
  it('collects only journeys that carry a schedule', () => {
    writeJourney('jrn_scheduled', '0 6 * * *');
    writeJourney('jrn_ondemand', null);

    expect(smokeSchedules()).toEqual([
      {
        projectId: 'proj_1',
        journeyId: 'jrn_scheduled',
        title: 'Journey jrn_scheduled',
        cron: '0 6 * * *',
      },
    ]);
  });

  it('skips deleted projects and projects with no repo', () => {
    writeJourney('jrn_scheduled', '0 6 * * *');
    writeFileSync(
      PROJECTS_FILE,
      JSON.stringify({
        projects: [
          project('proj_gone', repo, '2026-08-05T00:00:00.000Z'),
          project('proj_bare', null),
        ],
      }),
      'utf-8',
    );
    expect(smokeSchedules()).toEqual([]);
  });
});

describe('Scheduler', () => {
  const config = {
    polling: { enabled: false, intervalMinutes: 5 },
    concurrency: { maxParallelAgents: 2 },
    schedule: {},
  } as never;

  function harness() {
    const dispatcher = {
      runJourneySmoke: vi.fn(),
      runSmokeDigest: vi.fn(),
      pollAndDispatch: vi.fn(),
      runScheduledCommand: vi.fn(),
      updateConfig: vi.fn(),
    };
    const health = { setNextScheduledRun: vi.fn(), flush: vi.fn() };
    return { dispatcher, health };
  }

  it('registers one cron job per scheduled journey, plus the digest', () => {
    writeJourney('jrn_a', '0 6 * * *');
    writeJourney('jrn_b', '0 7 * * *');
    const { dispatcher, health } = harness();

    const scheduler = new Scheduler(config, dispatcher as never, health as never);
    scheduler.start();

    const names = (health.setNextScheduledRun.mock.calls as string[][]).map((c) => c[0]);
    expect(names).toContain('smoke:proj_1:jrn_a');
    expect(names).toContain('smoke:proj_1:jrn_b');
    expect(names).toContain('smoke-digest');

    scheduler.stop();
  });

  it('fires a journey run through the dispatcher when its cron comes due', async () => {
    vi.useFakeTimers();
    // Local time, deliberately: cron expressions are matched in the daemon's
    // own timezone, so a UTC literal here would test a different minute.
    vi.setSystemTime(new Date(2026, 7, 11, 5, 59, 50));
    writeJourney('jrn_a', '0 6 * * *');
    const { dispatcher, health } = harness();

    const scheduler = new Scheduler(config, dispatcher as never, health as never);
    scheduler.start();

    // Async: node-cron awaits its own hooks, so the tick lands a microtask later.
    await vi.advanceTimersByTimeAsync(30_000); // past 06:00
    expect(dispatcher.runJourneySmoke).toHaveBeenCalledWith('proj_1', 'jrn_a');
    expect(dispatcher.runSmokeDigest).not.toHaveBeenCalled();

    scheduler.stop();
    vi.useRealTimers();
  });

  it('refuses an invalid cron rather than throwing the whole scheduler over', () => {
    writeJourney('jrn_bad', 'not a cron');
    const { dispatcher, health } = harness();

    const scheduler = new Scheduler(config, dispatcher as never, health as never);
    expect(() => scheduler.start()).not.toThrow();
    const names = (health.setNextScheduledRun.mock.calls as string[][]).map((c) => c[0]);
    expect(names).not.toContain('smoke:proj_1:jrn_bad');
    expect(names).toContain('smoke-digest');

    scheduler.stop();
  });
});

describe('Dispatcher.runJourneySmoke', () => {
  async function fixture(allowed: boolean) {
    const { Dispatcher } = await import('../src/engine/dispatcher');
    const governor = await import('../src/engine/quota-governor');
    const verdict = await import('../src/harness/verdict');

    const spawn = vi
      .spyOn(verdict, 'spawnJourneyRun')
      .mockReturnValue({ pid: 4242, on: vi.fn() } as never);
    vi.spyOn(governor, 'canSpawn').mockReturnValue(
      allowed
        ? { allowed: true, backend: 'claude' }
        : { allowed: false, reason: 'window-exhausted', retryInMs: 60_000, backend: 'claude' },
    );

    const health = {
      activeCount: () => 0,
      startSession: vi.fn(() => 'sess_1'),
      updateSessionPid: vi.fn(),
      endSession: vi.fn(),
    };
    const dispatcher = new Dispatcher(
      { concurrency: { maxParallelAgents: 2 } } as never,
      {} as never,
      health as never,
    );
    return { dispatcher, spawn, health };
  }

  it('defers instead of spawning when the governor says no', async () => {
    const { dispatcher, spawn, health } = await fixture(false);
    dispatcher.runJourneySmoke('proj_1', 'jrn_a');

    // Deferred: nothing spawned, nothing started, nothing marked failed.
    expect(spawn).not.toHaveBeenCalled();
    expect(health.startSession).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('runs the journey as a smoke run when the governor allows it', async () => {
    const { dispatcher, spawn, health } = await fixture(true);
    dispatcher.runJourneySmoke('proj_1', 'jrn_a');

    expect(spawn).toHaveBeenCalledWith('proj_1', 'jrn_a', { smoke: true });
    expect(health.updateSessionPid).toHaveBeenCalledWith('sess_1', 4242);
    vi.restoreAllMocks();
  });
});

// ─── Digest composition ──────────────────────────────────────────────────────

describe('journeyRunRows', () => {
  it('reads outcome off the signed verdict, and calls a verdict-less run an error', () => {
    writeRun({
      runId: 'vrun_1',
      projectId: 'proj_1',
      journeyId: 'jrn_a',
      outcome: 'passed',
      startedAt: '2026-08-11T06:00:00.000Z',
    });
    writeRun({
      runId: 'vrun_2',
      projectId: 'proj_1',
      journeyId: 'jrn_b',
      outcome: 'failed',
      startedAt: '2026-08-11T06:05:00.000Z',
    });
    writeRun({
      runId: 'vrun_3',
      projectId: 'proj_1',
      journeyId: 'jrn_c',
      noVerdict: true,
      status: 'error',
      startedAt: '2026-08-11T06:10:00.000Z',
    });

    const rows = journeyRunRows({ since: '2026-08-11T00:00:00.000Z' });
    expect(rows.map((r) => [r.runId, r.outcome]).sort()).toEqual(
      [
        ['vrun_1', 'passed'],
        ['vrun_2', 'failed'],
        ['vrun_3', 'error'],
      ].sort(),
    );
  });

  it('ignores task runs, in-flight runs, and anything older than the window', () => {
    writeRun({
      runId: 'vrun_old',
      projectId: 'proj_1',
      journeyId: 'jrn_a',
      startedAt: '2026-08-01T00:00:00.000Z',
    });
    writeRun({
      runId: 'vrun_live',
      projectId: 'proj_1',
      journeyId: 'jrn_b',
      status: 'running',
      startedAt: '2026-08-11T06:00:00.000Z',
      finishedAt: null,
    });

    // A task run: no journeyId at all.
    mkdirSync(path.join(RUNS_DIR, 'vrun_task'), { recursive: true });
    writeFileSync(
      path.join(RUNS_DIR, 'vrun_task', 'run.json'),
      JSON.stringify({
        id: 'vrun_task',
        taskId: 'task_1',
        status: 'complete',
        startedAt: '2026-08-11T06:00:00.000Z',
      }),
      'utf-8',
    );

    expect(journeyRunRows({ since: '2026-08-10T00:00:00.000Z' })).toEqual([]);
  });
});

describe('composeDigest', () => {
  const rows = () => journeyRunRows({ since: '2026-08-11T00:00:00.000Z' });

  it('tallies a passed/failed/error mix and keeps error its own count', () => {
    writeRun({
      runId: 'vrun_1',
      projectId: 'proj_1',
      journeyId: 'jrn_a',
      outcome: 'passed',
      startedAt: '2026-08-11T06:00:00.000Z',
    });
    writeRun({
      runId: 'vrun_2',
      projectId: 'proj_1',
      journeyId: 'jrn_b',
      outcome: 'passed',
      startedAt: '2026-08-11T06:01:00.000Z',
    });
    writeRun({
      runId: 'vrun_3',
      projectId: 'proj_1',
      journeyId: 'jrn_c',
      outcome: 'failed',
      startedAt: '2026-08-11T06:02:00.000Z',
    });
    writeRun({
      runId: 'vrun_4',
      projectId: 'proj_1',
      journeyId: 'jrn_d',
      noVerdict: true,
      status: 'error',
      startedAt: '2026-08-11T06:03:00.000Z',
    });

    const digest = composeDigest(rows(), '2026-08-11T00:00:00.000Z', '2026-08-11T08:00:00.000Z')!;
    expect([digest.passed, digest.failed, digest.errors]).toEqual([2, 1, 1]);
    expect(digestHeadline(digest)).toBe('2 passed · 1 failed · 1 error');

    // Every row carries its own evidence link material.
    expect(digest.rows.map((r) => r.runId)).toEqual(['vrun_1', 'vrun_2', 'vrun_3', 'vrun_4']);
    for (const row of digest.rows) expect(row.projectId).toBe('proj_1');
    expect(digest.rows.find((r) => r.runId === 'vrun_1')!.verdictPath).toBe('verdict.json');
    expect(digest.rows.find((r) => r.runId === 'vrun_4')!.verdictPath).toBeNull();

    // The prose half says the same thing, and never calls an error a failure.
    const body = digestBody(digest);
    expect(body).toContain('2 passed · 1 failed · 1 error');
    expect(body).toContain('[ERROR (harness)] proj_1/jrn_d');
    expect(body).toContain('data/verification-runs/vrun_1/');
  });

  it('is null when nothing ran — an empty digest is noise', () => {
    expect(composeDigest([], '2026-08-11T00:00:00.000Z', '2026-08-11T08:00:00.000Z')).toBeNull();
  });
});

describe('writeSmokeDigest', () => {
  const inbox = (): InboxMessage[] =>
    (JSON.parse(readFileSync(INBOX_FILE, 'utf-8')) as { messages: InboxMessage[] }).messages;

  it('files exactly one message carrying the digest as data', async () => {
    writeRun({
      runId: 'vrun_1',
      projectId: 'proj_1',
      journeyId: 'jrn_a',
      outcome: 'passed',
      startedAt: '2026-08-11T06:00:00.000Z',
    });
    writeRun({
      runId: 'vrun_2',
      projectId: 'proj_1',
      journeyId: 'jrn_b',
      outcome: 'failed',
      startedAt: '2026-08-11T06:01:00.000Z',
    });

    const digest = await writeSmokeDigest(new Date('2026-08-11T08:00:00.000Z'));
    expect(digest).not.toBeNull();

    const messages = inbox();
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe('Smoke digest — 1 passed · 1 failed · 0 errors');
    expect(messages[0].to).toBe('me');
    expect(messages[0].type).toBe('report');
    expect(messages[0].smokeDigest!.rows).toHaveLength(2);
    expect(messages[0].smokeDigest!.until).toBe('2026-08-11T08:00:00.000Z');
  });

  it('writes nothing at all when no journey ran in the window', async () => {
    await expect(writeSmokeDigest(new Date('2026-08-11T08:00:00.000Z'))).resolves.toBeNull();
    expect(inbox()).toEqual([]);
  });

  it('starts the next window where the last digest ended, so no run is counted twice', async () => {
    writeRun({
      runId: 'vrun_1',
      projectId: 'proj_1',
      journeyId: 'jrn_a',
      outcome: 'passed',
      startedAt: '2026-08-11T06:00:00.000Z',
    });
    await writeSmokeDigest(new Date('2026-08-11T08:00:00.000Z'));
    expect(lastDigestAt()).toBe('2026-08-11T08:00:00.000Z');

    // A second digest with nothing new says nothing.
    await expect(writeSmokeDigest(new Date('2026-08-11T09:00:00.000Z'))).resolves.toBeNull();
    expect(inbox()).toHaveLength(1);

    // A run after the first digest lands in the second.
    writeRun({
      runId: 'vrun_2',
      projectId: 'proj_1',
      journeyId: 'jrn_b',
      outcome: 'failed',
      startedAt: '2026-08-11T08:30:00.000Z',
    });
    const second = (await writeSmokeDigest(new Date('2026-08-11T10:00:00.000Z')))!;
    expect(second.rows.map((r) => r.runId)).toEqual(['vrun_2']);
    expect(inbox()).toHaveLength(2);
  });
});

// ─── Staleness ───────────────────────────────────────────────────────────────

describe('journeyStatuses', () => {
  it('reports the newest run per journey, keeping error distinct from failed', () => {
    writeRun({
      runId: 'vrun_1',
      projectId: 'proj_1',
      journeyId: 'jrn_a',
      outcome: 'failed',
      startedAt: '2026-08-11T06:00:00.000Z',
      finishedAt: '2026-08-11T06:02:00.000Z',
    });
    writeRun({
      runId: 'vrun_2',
      projectId: 'proj_1',
      journeyId: 'jrn_a',
      outcome: 'passed',
      startedAt: '2026-08-11T07:00:00.000Z',
      finishedAt: '2026-08-11T07:02:00.000Z',
    });
    writeRun({
      runId: 'vrun_3',
      projectId: 'proj_1',
      journeyId: 'jrn_b',
      noVerdict: true,
      status: 'error',
      startedAt: '2026-08-11T07:30:00.000Z',
      finishedAt: '2026-08-11T07:31:00.000Z',
    });
    writeRun({
      runId: 'vrun_4',
      projectId: 'proj_other',
      journeyId: 'jrn_a',
      outcome: 'passed',
      startedAt: '2026-08-11T07:45:00.000Z',
    });

    const statuses = journeyStatuses('proj_1');
    expect(statuses.get('jrn_a')).toEqual({
      lastRunAt: '2026-08-11T07:00:00.000Z',
      lastVerdictAt: '2026-08-11T07:02:00.000Z',
      lastOutcome: 'passed',
      lastRunId: 'vrun_2',
    });
    // No verdict ⇒ no last-verified time, and the outcome is `error`, not `failed`.
    expect(statuses.get('jrn_b')).toEqual({
      lastRunAt: '2026-08-11T07:30:00.000Z',
      lastVerdictAt: null,
      lastOutcome: 'error',
      lastRunId: 'vrun_3',
    });
    // Another project's run never leaks in.
    expect(statuses.size).toBe(2);
  });

  it('has nothing to say about a journey that never ran', () => {
    expect(journeyStatuses('proj_1').get('jrn_never')).toBeUndefined();
  });
});
