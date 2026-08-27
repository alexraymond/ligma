/**
 * Integration: the twin primitives, end to end (twin-primitives §7).
 *
 * Seeds a fake git repo containing a `.ligma/` (boot recipe + one journey),
 * registers it as a project, and runs a journey through the real pipeline with
 * the LLM layer stubbed — the same shape as the other acceptance suites: the
 * agents are replaced, everything else (contract compile + Ed25519 signing,
 * verdict signing, baseline write, run manifest) is the real code path.
 *
 * The load-bearing assertion: the baseline lands CENTRALLY and NEVER in-repo.
 * A baseline the builder can read is a baseline the builder can build to.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PersonaReport, VerificationVerdict } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CENTRAL_PROJECTS_DIR, baselinePath, readBaseline } from '../../src/harness/baselines';
import { verifyContract } from '../../src/harness/contract-store';
import { getContract } from '../../src/harness/contract-store';
import {
  buildBaseline,
  journeyCriteria,
  journeyScope,
  runJourney,
} from '../../src/harness/run-journey';
import { RUNS_DIR } from '../../src/harness/verdict';
import { DATA_DIR } from '../../src/paths';
import { getProjects, saveProjects } from '../../src/store/data';
import { listJourneys, readBoot, writeBoot, writeJourney } from '../../src/store/ligma-dir';

const PROJECT_ID = 'proj_twinprim_test';
const JOURNEY_ID = 'jrn_capture-a-thought';

let repo: string;
const createdRunDirs: string[] = [];

/** A real git repo — an ephemeral env is cut from a worktree, so .git must exist. */
function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'twinprim-repo-'));
  writeFileSync(path.join(dir, 'README.md'), '# Fixture product\n', 'utf-8');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: dir,
  });
  return dir;
}

function report(over: Partial<PersonaReport> = {}): PersonaReport {
  return {
    charter: 'naive-user',
    runId: 'stub',
    personaSeed: 'seeded',
    goalAchieved: true,
    stepCount: 7,
    wrongTurns: 2,
    elapsedMs: 42_000,
    findings: [
      {
        severity: 'minor',
        summary: 'the save button is below the fold',
        evidence: [],
        criterionId: null,
      },
    ],
    criterionResults: null,
    transcriptPath: 'personas/naive-user-1/transcript.jsonl',
    invalid: false,
    ...over,
  };
}

/** What the panel would produce for the fixture journey. */
function stubReports(): PersonaReport[] {
  return [
    report(),
    report({
      charter: 'spec-auditor',
      personaSeed: null,
      goalAchieved: null,
      elapsedMs: 9_000,
      findings: [],
      criterionResults: [
        {
          criterionId: 'crit_goal',
          status: 'met',
          evidence: ['personas/spec-auditor/shots/01-goto.png'],
        },
        {
          criterionId: 'crit_1',
          status: 'met',
          evidence: ['personas/spec-auditor/shots/02-click.png'],
        },
        {
          criterionId: 'crit_2',
          status: 'not-met',
          evidence: ['personas/spec-auditor/shots/03-click.png'],
        },
      ],
      transcriptPath: 'personas/spec-auditor/transcript.jsonl',
    }),
  ];
}

/** Stands in for runJudge — the judge's own contract-signature gate is exercised. */
async function stubJudge(
  contract: Parameters<typeof verifyContract>[0],
): Promise<VerificationVerdict> {
  expect(verifyContract(contract)).toBe(true);
  return {
    runId: '',
    taskId: null,
    contractId: contract.id,
    contractVersion: contract.version,
    outcome: 'failed',
    criterionVerdicts: contract.criteria.map((c) => ({
      criterionId: c.id,
      status: c.id === 'crit_2' ? ('not-met' as const) : ('met' as const),
      reasoning: 'stubbed judge',
      evidence: [],
    })),
    humanDecisions: [],
    judgeModel: 'stub-judge',
    createdAt: new Date().toISOString(),
    signature: null,
  };
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
    title: 'Capture a thought',
    goal: 'Get an idea into the product and find it again afterwards',
    steps: ['write the thought down', 'find it listed where it was saved'],
    tags: ['core'],
    origin: 'human',
    schedule: null,
  });

  const projects = await getProjects();
  projects.projects.push({
    id: PROJECT_ID,
    name: 'Twin primitives fixture',
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

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  for (const dir of createdRunDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(path.join(CENTRAL_PROJECTS_DIR, PROJECT_ID), { recursive: true, force: true });
  rmSync(path.join(DATA_DIR, 'contracts', `${journeyScope(PROJECT_ID, JOURNEY_ID)}.jsonl`), {
    force: true,
  });
});

describe('a seeded repo with .ligma/', () => {
  it('is readable as project knowledge', () => {
    expect(readBoot(repo).status).toBe('ready');
    expect(listJourneys(repo).journeys.map((j) => j.id)).toEqual([JOURNEY_ID]);
  });
});

describe('journey run', () => {
  it('compiles the journey into a signed contract, judges it, and records a baseline centrally', async () => {
    const result = await runJourney({
      projectId: PROJECT_ID,
      journeyId: JOURNEY_ID,
      smoke: true,
      stub: { productUrl: 'http://localhost:1', reports: stubReports(), judge: stubJudge },
    });
    createdRunDirs.push(result.runDir);

    // The run is a verification run with a nullable taskId (twin-primitives §4).
    expect(result.manifest.taskId).toBeNull();
    expect(result.manifest.journeyId).toBe(JOURNEY_ID);
    expect(result.manifest.projectId).toBe(PROJECT_ID);
    expect(result.manifest.status).toBe('complete');

    // The oracle is a real, signed contract on the normal store.
    const contract = getContract(
      journeyScope(PROJECT_ID, JOURNEY_ID),
      result.manifest.contractVersion,
    );
    expect(contract).not.toBeNull();
    expect(verifyContract(contract!)).toBe(true);
    expect(contract!.taskId).toBeNull();

    // The verdict is written to the evidence locker, tagged with the journey.
    const verdict = JSON.parse(
      readFileSync(path.join(result.runDir, 'verdict.json'), 'utf-8'),
    ) as VerificationVerdict;
    expect(verdict.outcome).toBe('failed');
    expect(verdict.taskId).toBeNull();
    expect(verdict.journeyId).toBe(JOURNEY_ID);

    // The baseline exists, centrally.
    expect(result.baselinePath).toBe(baselinePath(PROJECT_ID, JOURNEY_ID));
    const baseline = readBaseline(PROJECT_ID, JOURNEY_ID);
    expect(baseline?.runId).toBe(result.runId);
    expect(baseline?.metrics).toMatchObject({
      timeOnTaskMs: 42_000,
      misclicks: 2,
      goalAchieved: true,
    });
    // Step outcomes come from the auditor's structured output, not from prose.
    expect(baseline?.steps.map((s) => s.outcome)).toEqual(['reached', 'blocked']);
  });

  it('NEVER writes a baseline into the target repo', () => {
    const inRepo = (rel: string): boolean => existsSync(path.join(repo, rel));
    expect(inRepo('.ligma/baselines')).toBe(false);
    expect(inRepo('.ligma/probes')).toBe(false);
    expect(inRepo('baselines')).toBe(false);

    // Belt and braces: nothing anywhere under the repo mentions a baseline file.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.name === '.git'
          ? []
          : e.isDirectory()
            ? walk(path.join(dir, e.name))
            : [path.join(dir, e.name)],
      );
    expect(walk(repo).filter((f) => f.includes('baseline'))).toEqual([]);

    // And it IS where it belongs.
    expect(existsSync(baselinePath(PROJECT_ID, JOURNEY_ID))).toBe(true);
  });

  it('does not touch the task board — a journey run has no task', async () => {
    const runs = readdirSync(RUNS_DIR).filter((d) => createdRunDirs.some((c) => c.endsWith(d)));
    expect(runs.length).toBeGreaterThan(0);
    const manifest = JSON.parse(
      readFileSync(path.join(RUNS_DIR, runs[0], 'run.json'), 'utf-8'),
    ) as {
      taskId: string | null;
    };
    expect(manifest.taskId).toBeNull();
  });

  it('judges the second run comparatively against the recorded baseline', () => {
    const baseline = readBaseline(PROJECT_ID, JOURNEY_ID)!;
    const journey = listJourneys(repo).journeys[0];

    const first = journeyCriteria(journey, null);
    const second = journeyCriteria(journey, baseline);

    // Step 1 was reached last time — the criterion now says so, and says a
    // regression is a failure. Step 2 was blocked, so nothing is claimed for it.
    expect(first[1].text).not.toContain('baseline');
    expect(second[1].text).toContain('recorded baseline reached this step');
    expect(second[2].text).not.toContain('baseline');
    // Nothing is held out: a journey is public by design.
    expect(second.every((c) => !c.holdout)).toBe(true);
  });

  it('keeps the first characterization — a later run does not overwrite it silently', async () => {
    const before = readBaseline(PROJECT_ID, JOURNEY_ID)!;
    const result = await runJourney({
      projectId: PROJECT_ID,
      journeyId: JOURNEY_ID,
      smoke: true,
      stub: { productUrl: 'http://localhost:1', reports: stubReports(), judge: stubJudge },
    });
    createdRunDirs.push(result.runDir);

    expect(result.baselinePath).toBeNull();
    expect(readBaseline(PROJECT_ID, JOURNEY_ID)?.runId).toBe(before.runId);
  });
});

describe('a harness error keeps its cause', () => {
  it("carries the judge's classification onto the run manifest, and records no baseline", async () => {
    const before = readBaseline(PROJECT_ID, JOURNEY_ID);
    const result = await runJourney({
      projectId: PROJECT_ID,
      journeyId: JOURNEY_ID,
      smoke: true,
      stub: {
        productUrl: 'http://localhost:1',
        reports: stubReports(),
        judge: async (contract) => ({
          ...(await stubJudge(contract)),
          outcome: 'error' as const,
          causeKind: 'parse' as const,
        }),
      },
    });
    createdRunDirs.push(result.runDir);

    // The word the judge used travels; nothing re-derives it from the message.
    expect(result.manifest.status).toBe('error');
    expect(result.manifest.causeKind).toBe('parse');
    // D3: a harness malfunction characterizes nothing about the product.
    expect(readBaseline(PROJECT_ID, JOURNEY_ID)?.runId).toBe(before?.runId);
  });
});

describe('baseline construction', () => {
  it('reads every field from structured persona output', () => {
    const journey = listJourneys(repo).journeys[0];
    const baseline = buildBaseline(PROJECT_ID, journey, 'vrun_x', stubReports(), [
      'personas/spec-auditor/shots/02-click.png',
      'personas/spec-auditor/report.json',
    ]);
    expect(baseline.screenshots).toEqual(['personas/spec-auditor/shots/02-click.png']);
    expect(baseline.steps[0].screenshot).toBe('personas/spec-auditor/shots/02-click.png');
    expect(baseline.findings).toEqual([
      { severity: 'minor', summary: 'the save button is below the fold' },
    ]);
  });

  it('marks a step the panel never reported as not-attempted, never as reached', () => {
    const journey = listJourneys(repo).journeys[0];
    const baseline = buildBaseline(PROJECT_ID, journey, 'vrun_x', [report()], []);
    expect(baseline.steps.every((s) => s.outcome === 'not-attempted')).toBe(true);
  });
});

describe('a journey run refuses to start without a recipe', () => {
  it('errors when the project has no repoPath', async () => {
    const projects = await getProjects();
    const project = projects.projects.find((p) => p.id === PROJECT_ID)!;
    const saved = project.repoPath;
    project.repoPath = null;
    await saveProjects(projects);

    await expect(runJourney({ projectId: PROJECT_ID, journeyId: JOURNEY_ID })).rejects.toThrow(
      /repoPath/,
    );

    project.repoPath = saved;
    await saveProjects(projects);
  });

  it('errors when boot.json is missing', async () => {
    const bare = initRepo();
    const projects = await getProjects();
    const project = projects.projects.find((p) => p.id === PROJECT_ID)!;
    const saved = project.repoPath;
    project.repoPath = bare;
    await saveProjects(projects);

    await expect(runJourney({ projectId: PROJECT_ID, journeyId: JOURNEY_ID })).rejects.toThrow(
      /boot\.json/,
    );

    project.repoPath = saved;
    await saveProjects(projects);
    rmSync(bare, { recursive: true, force: true });
  });
});

describe('the central store is not in any repo', () => {
  it("resolves under data/, which is the daemon's store", () => {
    expect(CENTRAL_PROJECTS_DIR.startsWith(DATA_DIR)).toBe(true);
    expect(existsSync(path.join(DATA_DIR, 'projects'))).toBe(true);
    mkdirSync(path.join(CENTRAL_PROJECTS_DIR, PROJECT_ID), { recursive: true });
  });
});
