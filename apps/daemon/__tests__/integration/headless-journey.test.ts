/**
 * Integration: a HEADLESS journey run, end to end.
 *
 * The browser panel proves nothing about an API or a CLI, so this is the same
 * pipeline with the transport swapped: real HTTP and PTY bridges driven against
 * a fixture API and a fixture CLI, the real contract compiler and Ed25519
 * signing, the real judge (with only its LLM spawn stubbed), the real verdict
 * and the real central baseline store.
 *
 * The persona AGENTS are what a test cannot afford, so the panel hook stands in
 * for them — but it drives the bridges over HTTP exactly as a persona's curl
 * would, so every record the baseline quotes is a record a bridge really wrote.
 * That is the point: the evidence is never a literal in this file.
 *
 * Load-bearing assertions:
 *   - the panel's evidence is request/response records and command transcripts,
 *     with status codes and exit codes, where a UI run would have screenshots;
 *   - the baseline characterizes the RESPONSE SCHEMA and the EXIT CODE, so the
 *     next run is judged comparatively against them;
 *   - the verdict is signed and verifies;
 *   - the baseline lands centrally and never in the repo.
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
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AcceptanceContract, PersonaReport, VerificationVerdict } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentRunner } from '../../src/engine/runner';
import { CENTRAL_PROJECTS_DIR, baselinePath, readBaseline } from '../../src/harness/baselines';
import { verifyContract } from '../../src/harness/contract-store';
import { startHttpBridge } from '../../src/harness/http-bridge';
import type { HttpRecord } from '../../src/harness/http-bridge';
import { runJudge } from '../../src/harness/judge';
import { panelTransports } from '../../src/harness/panel';
import { type PtyRecord, startPtyBridge } from '../../src/harness/pty-bridge';
import { journeyScope, runJourney } from '../../src/harness/run-journey';
import { verify } from '../../src/harness/signing';
import { DATA_DIR } from '../../src/paths';
import { getProjects, saveProjects } from '../../src/store/data';
import { writeBoot, writeJourney } from '../../src/store/ligma-dir';

const PROJECT_ID = 'proj_headless_test';
const JOURNEY_ID = 'jrn_create-and-list';

const CLI = `#!/usr/bin/env node
const [, , cmd] = process.argv;
if (cmd === "list") { console.log("t1\\tBuy milk"); process.exit(0); }
console.error("unknown command: " + cmd);
process.exit(127);
`;

let repo: string;
let api: http.Server;
let apiUrl: string;
const createdRunDirs: string[] = [];

/** The fixture API the journey's first step goes through. */
function startApi(): Promise<void> {
  const tasks: Array<{ id: string; title: string }> = [];
  api = http.createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/tasks' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += String(c)));
      req.on('end', () => {
        const { title } = JSON.parse(raw) as { title: string };
        const task = { id: `t${tasks.length + 1}`, title };
        tasks.push(task);
        send(201, task);
      });
      return;
    }
    send(404, { error: 'not found' });
  });
  return new Promise((resolve) => {
    api.listen(0, '127.0.0.1', () => {
      const addr = api.address();
      apiUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'headless-repo-'));
  mkdirSync(path.join(dir, 'bin'), { recursive: true });
  writeFileSync(path.join(dir, 'bin', 'cli.js'), CLI, 'utf-8');
  writeFileSync(path.join(dir, 'README.md'), '# Fixture\n\n    node bin/cli.js list\n', 'utf-8');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: dir,
  });
  return dir;
}

/** Curl one bridge action the way a persona would. */
async function drive(
  sessionUrl: string,
  action: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${sessionUrl}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

function report(over: Partial<PersonaReport>): PersonaReport {
  return {
    charter: 'naive-developer',
    runId: 'stub',
    personaSeed: 'seeded',
    goalAchieved: true,
    stepCount: 2,
    wrongTurns: 0,
    elapsedMs: 12_000,
    findings: [],
    criterionResults: null,
    transcriptPath: 'personas/naive-developer-1/transcript.jsonl',
    invalid: false,
    ...over,
  };
}

/**
 * The panel, minus the model. Drives the real bridges over their real HTTP API
 * and reports what they recorded — so the evidence paths below are paths the
 * bridges minted, not strings this test made up.
 */
async function headlessPanel(runDir: string): Promise<PersonaReport[]> {
  const httpBridge = await startHttpBridge({ baseUrl: apiUrl, runDir });
  const ptyBridge = await startPtyBridge({ cwd: repo, runDir, productUrl: apiUrl });
  try {
    const dev = (await httpBridge.session('naive-developer-1')).url;
    const auditorHttp = (await httpBridge.session('spec-auditor')).url;
    const auditorPty = (await ptyBridge.session('spec-auditor-cli')).url;

    // Step 1 — create a task over the API. The naive developer walks it first.
    await drive(dev, 'request', {
      method: 'POST',
      path: '/api/tasks',
      json: { title: 'Buy milk' },
    });
    const created = await drive(auditorHttp, 'request', {
      method: 'POST',
      path: '/api/tasks',
      json: { title: 'Buy milk' },
    });
    // Step 2 — see it from the CLI.
    const listed = await drive(auditorPty, 'run', { argv: ['node', 'bin/cli.js', 'list'] });

    return [
      report({}),
      report({
        charter: 'spec-auditor',
        personaSeed: null,
        goalAchieved: null,
        elapsedMs: 3_000,
        transcriptPath: 'personas/spec-auditor/transcript.jsonl',
        criterionResults: [
          { criterionId: 'crit_goal', status: 'met', evidence: [String(created.record)] },
          { criterionId: 'crit_1', status: 'met', evidence: [String(created.record)] },
          { criterionId: 'crit_2', status: 'met', evidence: [String(listed.record)] },
        ],
      }),
    ];
  } finally {
    await httpBridge.close();
    await ptyBridge.close();
  }
}

/** The real judge with only its LLM spawn replaced. */
async function stubJudge(
  contract: AcceptanceContract,
  reports: PersonaReport[],
  runDir: string,
  scope: { journeyId: string; projectId: string },
): Promise<VerificationVerdict> {
  expect(verifyContract(contract)).toBe(true);
  const runner = {
    spawnAgent: async () => ({
      exitCode: 0,
      timedOut: false,
      stderr: '',
      stdout: JSON.stringify({
        type: 'result',
        result: `\`\`\`json\n${JSON.stringify({
          criterionVerdicts: contract.criteria.map((c) => ({
            criterionId: c.id,
            status: 'met',
            reasoning: 'the bridge records show it',
            evidence: reports[1].criterionResults?.map((r) => r.evidence[0]) ?? [],
          })),
          humanDecisions: [],
        })}\n\`\`\``,
      }),
    }),
  } as unknown as AgentRunner;

  return runJudge({
    contract,
    reports,
    runId: path.basename(runDir),
    taskId: null,
    // E8: scope belongs INSIDE the signed payload. This stub replaces the LLM
    // spawn, not the signing, so it signs for real and must sign what the real
    // journey path signs.
    ...scope,
    runDir,
    evidenceIndex: [],
    judgeModel: 'opus',
    builderModel: null,
    maxTurns: 4,
    timeoutMinutes: 5,
    runner,
  });
}

beforeAll(async () => {
  repo = initRepo();
  await startApi();

  writeBoot(repo, {
    appDir: '.',
    install: null,
    dev: ['node', 'bin/cli.js', 'serve'],
    portStrategy: { kind: 'flag', flag: '-p' },
    healthPath: '/api/tasks',
    healthMarker: 'tasks',
    seed: null,
  });
  writeJourney(repo, {
    id: JOURNEY_ID,
    title: 'Create a task and see it from the CLI',
    goal: 'Get a task into the service and confirm the command line agrees',
    steps: ['create a task through the API', 'list it from the command line'],
    tags: ['api', 'cli'],
    origin: 'human',
    schedule: null,
  });

  const projects = await getProjects();
  projects.projects.push({
    id: PROJECT_ID,
    name: 'Headless fixture',
    description: '',
    status: 'active',
    color: '#000000',
    teamMembers: [],
    createdAt: new Date().toISOString(),
    tags: [],
    deletedAt: null,
    repoPath: repo,
    shape: 'headless',
  });
  await saveProjects(projects);
});

afterAll(async () => {
  await new Promise<void>((resolve) => api.close(() => resolve()));
  rmSync(repo, { recursive: true, force: true });
  for (const dir of createdRunDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(path.join(CENTRAL_PROJECTS_DIR, PROJECT_ID), { recursive: true, force: true });
  rmSync(path.join(DATA_DIR, 'contracts', `${journeyScope(PROJECT_ID, JOURNEY_ID)}.jsonl`), {
    force: true,
  });
});

describe('a headless journey run', () => {
  let runDir: string;
  let verdict: VerificationVerdict;

  it('runs the whole pipeline over HTTP and a terminal', async () => {
    const result = await runJourney({
      projectId: PROJECT_ID,
      journeyId: JOURNEY_ID,
      smoke: true,
      stub: { productUrl: apiUrl, panel: headlessPanel, judge: stubJudge },
    });
    createdRunDirs.push(result.runDir);
    runDir = result.runDir;
    verdict = result.verdict!;

    expect(result.manifest.status).toBe('complete');
    expect(result.manifest.taskId).toBeNull();
    expect(result.manifest.journeyId).toBe(JOURNEY_ID);
  });

  it("picks the consumer panel from the project's shape and the journey's tags", () => {
    expect(panelTransports('headless', ['api', 'cli'], true)).toEqual(['http', 'pty']);
  });

  it('recorded request/response evidence, not screenshots', () => {
    const files = walk(runDir).map((f) => path.relative(runDir, f).split(path.sep).join('/'));
    expect(files.filter((f) => f.endsWith('.png'))).toEqual([]);

    const httpRecords = files.filter((f) => f.includes('/records/') && f.includes('POST'));
    expect(httpRecords.length).toBeGreaterThan(0);
    const record = JSON.parse(
      readFileSync(path.join(runDir, httpRecords[0]), 'utf-8'),
    ) as HttpRecord;
    expect(record.status).toBe(201);
    expect(record.schema).toBe('{id:string,title:string}');
    expect(record.requestBody).toBe('{"title":"Buy milk"}');
  });

  it('recorded a command transcript with its exit code', () => {
    const files = walk(runDir).map((f) => path.relative(runDir, f).split(path.sep).join('/'));
    const cliRecord = files.find((f) => f.includes('spec-auditor-cli/records/'));
    expect(cliRecord).toBeTruthy();
    const record = JSON.parse(readFileSync(path.join(runDir, cliRecord!), 'utf-8')) as PtyRecord;
    expect(record.argv).toEqual(['node', 'bin/cli.js', 'list']);
    expect(record.exitCode).toBe(0);
    expect(record.stdout).toContain('Buy milk');
  });

  it('produced a SIGNED verdict that verifies', () => {
    const onDisk = JSON.parse(
      readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'),
    ) as VerificationVerdict;
    expect(onDisk.outcome).toBe('passed');
    expect(onDisk.journeyId).toBe(JOURNEY_ID);
    expect(onDisk.signature).not.toBeNull();

    // E8: the signed payload is the WHOLE verdict minus the signature —
    // journeyId/projectId included. Nothing stamps fields on afterwards any
    // more, so nothing has to be stripped back off to make verify() pass.
    const { signature, ...payload } = onDisk;
    expect(verify(payload, signature!)).toBe(true);
  });

  it('refuses a tampered verdict', () => {
    const forged = { ...verdict, outcome: 'failed' as const };
    const { signature, ...payload } = forged;
    expect(verify(payload, signature!)).toBe(false);
  });

  it('characterizes the baseline with response schemas and exit codes, not screenshots', () => {
    const baseline = readBaseline(PROJECT_ID, JOURNEY_ID);
    expect(baseline).not.toBeNull();
    expect(baseline!.screenshots).toEqual([]);
    expect(baseline!.steps.map((s) => s.outcome)).toEqual(['reached', 'reached']);

    // Step 0 went over HTTP: the note quotes the status AND the response schema.
    expect(baseline!.steps[0].note).toContain('POST /api/tasks → 201');
    expect(baseline!.steps[0].note).toContain('body {id:string,title:string}');
    expect(baseline!.steps[0].screenshot).toMatch(/\/records\/.*\.json$/);

    // Step 1 went over the terminal: the note quotes the command and its exit code.
    expect(baseline!.steps[1].note).toContain('`node bin/cli.js list` → exit 0');
  });

  it('makes the recorded schema and exit code comparative for the next run', async () => {
    const { journeyCriteria } = await import('../../src/harness/run-journey');
    const { listJourneys } = await import('../../src/store/ligma-dir');
    const journey = listJourneys(repo).journeys[0];
    const criteria = journeyCriteria(journey, readBaseline(PROJECT_ID, JOURNEY_ID));
    // "This used to answer 201 with this shape" is now something the judge can
    // fail on, with the record that proves it.
    expect(criteria[1].text).toContain('body {id:string,title:string}');
    expect(criteria[2].text).toContain('exit 0');
    expect(criteria[1].text).toContain('a regression here is a failure');
  });

  it('NEVER writes a baseline into the target repo', () => {
    expect(walk(repo).filter((f) => f.includes('baseline'))).toEqual([]);
    expect(existsSync(baselinePath(PROJECT_ID, JOURNEY_ID))).toBe(true);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === '.git'
      ? []
      : e.isDirectory()
        ? walk(path.join(dir, e.name))
        : [path.join(dir, e.name)],
  );
}
