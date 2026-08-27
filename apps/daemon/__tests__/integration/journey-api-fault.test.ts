/**
 * Integration: error ≠ failed when a panel dies on an API-level fault.
 *
 * Regression for docs/evidence/campaign/d2-attempt-3/journeys/vrun_1786554039301:
 * all 5 persona runs there ended in a structured 429 (`api_error_status: 429`,
 * `rateLimitType: "seven_day_overage_included"`), yet the fail-default judge
 * ran on the empty evidence and the run was reported `failed` — a harness/
 * backend malfunction dressed up as a product defect (core principle 12).
 *
 * `allInvalidByApiFault` (harness/personas.ts) is the shared classifier; this
 * exercises it through the real `runJourney` pipeline via the stub seam
 * twin-primitives.test.ts also uses, so what's asserted is the actual run
 * manifest a reader would see, not just the pure function in isolation.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PersonaReport, VerificationVerdict } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CENTRAL_PROJECTS_DIR } from '../../src/harness/baselines';
import { journeyScope, runJourney } from '../../src/harness/run-journey';
import { RUNS_DIR } from '../../src/harness/verdict';
import { DATA_DIR } from '../../src/paths';
import { getProjects, saveProjects } from '../../src/store/data';
import { writeBoot, writeJourney } from '../../src/store/ligma-dir';

const PROJECT_ID = 'proj_apifault_test';
const JOURNEY_ID = 'jrn_apifault';

let repo: string;
const createdRunDirs: string[] = [];

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'apifault-repo-'));
  writeFileSync(path.join(dir, 'README.md'), '# Fixture product\n', 'utf-8');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: dir,
  });
  return dir;
}

function baseReport(over: Partial<PersonaReport>): PersonaReport {
  return {
    charter: 'naive-user',
    runId: 'stub',
    personaSeed: 'seeded',
    goalAchieved: null,
    stepCount: 0,
    wrongTurns: 0,
    elapsedMs: 4_800,
    findings: [],
    criterionResults: null,
    transcriptPath: 'personas/naive-user-1/transcript.jsonl',
    invalid: true,
    ...over,
  };
}

const rateLimited = (resumesAt?: string): PersonaReport =>
  baseReport({ causeKind: 'rate-limit', ...(resumesAt ? { resumesAt } : {}) });
const authFailed = (): PersonaReport => baseReport({ causeKind: 'auth' });
const validReport = (): PersonaReport => ({
  charter: 'spec-auditor',
  runId: 'stub',
  personaSeed: null,
  goalAchieved: true,
  stepCount: 6,
  wrongTurns: 0,
  elapsedMs: 30_000,
  findings: [],
  criterionResults: [
    { criterionId: 'crit_1', status: 'met', evidence: ['personas/spec-auditor/shots/01.png'] },
    { criterionId: 'crit_2', status: 'met', evidence: ['personas/spec-auditor/shots/02.png'] },
  ],
  transcriptPath: 'personas/spec-auditor/transcript.jsonl',
  invalid: false,
});

async function fakeJudge(): Promise<VerificationVerdict> {
  return {
    runId: '',
    taskId: null,
    contractId: 'ctr_stub',
    contractVersion: 1,
    outcome: 'passed',
    criterionVerdicts: [],
    humanDecisions: [],
    judgeModel: 'stub-judge',
    createdAt: new Date().toISOString(),
    signature: null,
  };
}

/** Finds the run directory a rejected `runJourney` call still wrote to disk. */
function findNewRunDir(before: Set<string>): string {
  const runId = readdirSync(RUNS_DIR).find((d) => !before.has(d));
  if (!runId) throw new Error('no new run dir appeared under RUNS_DIR');
  const dir = path.join(RUNS_DIR, runId);
  createdRunDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  repo = initRepo();
  writeBoot(repo, {
    appDir: '.',
    install: null,
    dev: ['node', 'server.js'],
    portStrategy: { kind: 'flag', flag: '-p' },
    healthPath: '/',
    healthMarker: 'Fixture product',
    seed: null,
  });
  writeJourney(repo, {
    id: JOURNEY_ID,
    title: 'API fault fixture',
    goal: 'Exercise the all-invalid short-circuit',
    steps: ['do the thing', 'see it worked'],
    tags: ['core'],
    origin: 'human',
    schedule: null,
  });

  const projects = await getProjects();
  projects.projects.push({
    id: PROJECT_ID,
    name: 'API fault fixture',
    description: '',
    status: 'active',
    color: '#000000',
    teamMembers: [],
    createdAt: new Date().toISOString(),
    tags: [],
    deletedAt: null,
    repoPath: repo,
    shape: 'ui',
  });
  await saveProjects(projects);
});

afterAll(async () => {
  rmSync(repo, { recursive: true, force: true });
  for (const dir of createdRunDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(path.join(CENTRAL_PROJECTS_DIR, PROJECT_ID), { recursive: true, force: true });
  rmSync(path.join(DATA_DIR, 'contracts', `${journeyScope(PROJECT_ID, JOURNEY_ID)}.jsonl`), {
    force: true,
  });

  const projects = await getProjects();
  projects.projects = projects.projects.filter((p) => p.id !== PROJECT_ID);
  await saveProjects(projects);
});

describe('a panel invalidated entirely by an API-level fault', () => {
  it('short-circuits to run status error, causeKind rate-limit, and never calls the judge', async () => {
    const judgeSpy = vi.fn(fakeJudge);
    const before = new Set(readdirSync(RUNS_DIR));

    await expect(
      runJourney({
        projectId: PROJECT_ID,
        journeyId: JOURNEY_ID,
        smoke: true,
        stub: {
          productUrl: 'http://localhost:1',
          reports: [rateLimited('2026-08-13T05:00:00.000Z'), rateLimited()],
          judge: judgeSpy,
        },
      }),
    ).rejects.toThrow(/API-level fault \(rate-limit\)/);

    expect(judgeSpy).not.toHaveBeenCalled();

    const runDir = findNewRunDir(before);
    const manifest = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf-8')) as {
      status: string;
      causeKind: string;
      resumesAt?: string;
      error: string | null;
    };
    expect(manifest.status).toBe('error');
    expect(manifest.causeKind).toBe('rate-limit');
    // The earliest of the two resumesAt hints — the run recovers as soon as any of them do.
    expect(manifest.resumesAt).toBe('2026-08-13T05:00:00.000Z');
    expect(manifest.error).toMatch(/nothing to judge/);
  });

  it('classifies an all-auth panel as causeKind auth', async () => {
    const judgeSpy = vi.fn(fakeJudge);
    const before = new Set(readdirSync(RUNS_DIR));

    await expect(
      runJourney({
        projectId: PROJECT_ID,
        journeyId: JOURNEY_ID,
        smoke: true,
        stub: {
          productUrl: 'http://localhost:1',
          reports: [authFailed(), authFailed()],
          judge: judgeSpy,
        },
      }),
    ).rejects.toThrow(/API-level fault \(auth\)/);

    expect(judgeSpy).not.toHaveBeenCalled();
    const runDir = findNewRunDir(before);
    const manifest = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf-8')) as {
      causeKind: string;
    };
    expect(manifest.causeKind).toBe('auth');
  });
});

describe('a mixed panel', () => {
  it('still reaches the judge when at least one run has usable evidence', async () => {
    const judgeSpy = vi.fn(fakeJudge);

    const result = await runJourney({
      projectId: PROJECT_ID,
      journeyId: JOURNEY_ID,
      smoke: true,
      stub: {
        productUrl: 'http://localhost:1',
        reports: [rateLimited(), validReport()],
        judge: judgeSpy,
      },
    });
    createdRunDirs.push(result.runDir);

    expect(judgeSpy).toHaveBeenCalledTimes(1);
    expect(result.manifest.status).toBe('complete');
    expect(result.verdict?.outcome).toBe('passed');
  });

  it('still reaches the judge when every invalid run has a non-API cause (unparseable output)', async () => {
    const judgeSpy = vi.fn(fakeJudge);
    const unparseable = baseReport({ causeKind: undefined });

    const result = await runJourney({
      projectId: PROJECT_ID,
      journeyId: JOURNEY_ID,
      smoke: true,
      stub: {
        productUrl: 'http://localhost:1',
        reports: [unparseable, unparseable],
        judge: judgeSpy,
      },
    });
    createdRunDirs.push(result.runDir);

    expect(judgeSpy).toHaveBeenCalledTimes(1);
    expect(result.manifest.status).toBe('complete');
  });
});
