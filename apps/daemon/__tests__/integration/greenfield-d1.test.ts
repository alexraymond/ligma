/**
 * Integration: D1 headless greenfield, from promote to signed verdict.
 *
 * This is the middle of build brief §7 D1 — the part that did not exist before:
 * a project with no repo is promoted, ligma provisions the product's own git
 * repo, the builder is pointed at THAT repo, the build owes it a README and a
 * `.ligma/boot.json`, and the task's verification boots the PRODUCT from that
 * recipe instead of the dogfood adapter.
 *
 * What is stubbed is exactly the two things that cost a subscription session:
 * the builder agent (this test writes the files a builder would have written)
 * and the persona/judge model spawns. Everything else runs for real —
 * provisioning, the promote route, contract compilation and Ed25519 signing,
 * `git worktree`, the boot adapter spawning the product, the HTTP bridge, the
 * judge's own parsing and fail-default, `applyVerdict`. So every claim below is
 * about code that ran, not code that was described.
 *
 * Load-bearing assertions:
 *   - promote provisions ~/ligma-products/<slug> with a seed commit, records it
 *     on the project, and the journeys land in THAT repo's `.ligma/`;
 *   - the builder's cwd is the product repo, and its prompt demands the recipe;
 *   - a finished build with no `.ligma/boot.json` is blocked in the
 *     env-preflight failure class, not parked in awaiting-verification;
 *   - the verification env is the product, booted from its own recipe, and the
 *     panel is the consumer panel (HTTP), not a browser;
 *   - the verdict is signed, verifies, and the task's green check has a run to
 *     link to.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AcceptanceContract,
  PersonaReport,
  PromotePreview,
  VerificationVerdict,
} from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTaskPrompt } from '../../src/engine/prompt-builder';
import type { AgentRunner } from '../../src/engine/runner';
import { bootGateFailure, builderCwd, productRepo } from '../../src/engine/task-env';
import { getLatestContract, verifyContract } from '../../src/harness/contract-store';
import { runJudge } from '../../src/harness/judge';
import { runVerification } from '../../src/harness/run-verification';
import { verify } from '../../src/harness/signing';
import { handleBuilderCompletion } from '../../src/harness/verdict';
import { DATA_DIR } from '../../src/paths';
import { POST as promotePost } from '../../src/routes/projects/_id/promote/route';
import { getAgents, getProjects, getTasks, saveAgents, saveProjects } from '../../src/store/data';
import { listJourneys, readBoot } from '../../src/store/ligma-dir';
import { productsRoot } from '../../src/store/product-repo';

const PROJECT_ID = 'proj_d1_greenfield';
const AGENT_ID = 'agent_d1_builder';

/** The product a builder would have written: a URL shortener with a health path. */
const SERVER_JS = `const http = require("http");
const links = new Map();
http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok"); }
  if (req.url === "/api/links" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += String(c)));
    req.on("end", () => {
      const { url } = JSON.parse(raw || "{}");
      const id = "s" + (links.size + 1);
      links.set(id, url);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, short: "/" + id, url }));
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}).listen(Number(process.env.PORT) || 3000, "127.0.0.1");
`;

const README = `# URL Shortener

## Quickstart

    PORT=8080 node server.js
    curl -X POST localhost:8080/api/links -d '{"url":"https://example.com"}'
`;

const BOOT = {
  appDir: '.',
  install: null,
  dev: ['node', 'server.js'],
  portStrategy: { kind: 'env' as const, var: 'PORT' },
  healthPath: '/health',
  healthMarker: 'ok',
  seed: null,
};

const preview = (): PromotePreview => ({
  projectId: PROJECT_ID,
  source: 'brief',
  designId: null,
  tasks: [
    {
      tempId: 't1',
      title: 'Shorten a URL over HTTP',
      description: 'Accept a long URL and hand back a short one',
      acceptanceCriteria: [
        'POST /api/links returns a short link',
        'the README quickstart works as written',
      ],
      dependsOn: [],
      designFilePaths: [],
    },
  ],
  criteria: [
    {
      taskTempId: 't1',
      text: 'POST /api/links returns a short link',
      kind: 'criterion',
      holdout: false,
      quote: 'POST /api/links returns a short link',
    },
    {
      taskTempId: 't1',
      text: 'the README quickstart works as written',
      kind: 'criterion',
      holdout: false,
      quote: 'the README quickstart works as written',
    },
  ],
  holdoutNote: 'the builder will see 2 of 2',
  journeys: [
    {
      tempId: 'j1',
      title: 'Shorten a link from the quickstart',
      goal: 'Turn a long URL into a short one by following the README',
      steps: ['read the quickstart', 'POST a URL to /api/links'],
    },
  ],
  governor: {
    estimatedSpawns: 3,
    windowHours: 5,
    used: 0,
    max: 50,
    reserveFloor: 5,
    remainingForAutonomy: 45,
    willDefer: false,
    killSwitch: false,
  },
  designBaseline: null,
  error: null,
});

let productsDir: string;
let repoPath: string;
let taskId: string;
const runDirs: string[] = [];

beforeAll(async () => {
  productsDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-d1-products-'));
  process.env.LIGMA_PRODUCTS_DIR = productsDir;

  const projects = await getProjects();
  projects.projects.push({
    id: PROJECT_ID,
    name: 'URL Shortener',
    description: 'Build a REST API that shortens URLs, with rate limiting.',
    status: 'active',
    color: '#000000',
    teamMembers: [],
    createdAt: new Date().toISOString(),
    tags: [],
    deletedAt: null,
    // The whole point: a greenfield project has nowhere to be built yet.
    repoPath: null,
    shape: 'headless',
  });
  await saveProjects(projects);

  const agents = await getAgents();
  agents.agents.push({
    id: AGENT_ID,
    name: 'Developer',
    description: 'builds things',
    instructions: '',
    capabilities: [],
    skillIds: [],
    status: 'active',
  } as unknown as (typeof agents.agents)[number]);
  await saveAgents(agents);
});

afterAll(() => {
  rmSync(productsDir, { recursive: true, force: true });
  for (const dir of runDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(path.join(DATA_DIR, 'projects', PROJECT_ID), { recursive: true, force: true });
  if (taskId) rmSync(path.join(DATA_DIR, 'contracts', `${taskId}.jsonl`), { force: true });
});

describe('D1 — promote a headless greenfield project', () => {
  it("provisions the product's own git repo and records it on the project", async () => {
    const response = await promotePost(
      new Request('http://localhost/api/projects/x/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preview: preview() }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) },
    );
    expect(response.status).toBe(201);

    expect(productsRoot()).toBe(productsDir);
    repoPath = path.join(productsDir, 'url-shortener');
    expect(existsSync(path.join(repoPath, '.git'))).toBe(true);
    expect(readFileSync(path.join(repoPath, 'README.md'), 'utf-8')).toContain('# URL Shortener');
    expect(
      execFileSync('git', ['log', '--oneline'], { cwd: repoPath, encoding: 'utf-8' }),
    ).toContain('seed product repo');

    const projects = await getProjects();
    expect(projects.projects.find((p) => p.id === PROJECT_ID)?.repoPath).toBe(repoPath);
  });

  it('lands the tasks with a signed contract and the journeys inside the PRODUCT repo', async () => {
    const tasks = await getTasks();
    const task = tasks.tasks.find((t) => t.projectId === PROJECT_ID);
    expect(task).toBeTruthy();
    taskId = task!.id;

    // Dispatchable, not decorative: getPendingTasks() requires not-started AND
    // a real assignee — a backlog/null task would never build (live-D1 finding).
    expect(task!.kanban).toBe('not-started');
    expect(task!.assignedTo).toBeTruthy();
    expect(task!.assignedTo).not.toBe('me');

    // Buildable, not just dispatchable: the prompt builder reads the raw task
    // off disk with no read-normalizer, so a promote that writes a partial
    // Task shape crashes here, not in review (live-D2 attempt-4 finding).
    expect(() => buildTaskPrompt(task!.assignedTo as string, task as never)).not.toThrow();

    const contract = getLatestContract(taskId);
    expect(contract).not.toBeNull();
    expect(verifyContract(contract!)).toBe(true);

    // The journeys are repo knowledge, so they live with the product — not in ligma.
    const journeys = listJourneys(repoPath).journeys;
    expect(journeys.map((j) => j.title)).toContain('Shorten a link from the quickstart');
    expect(existsSync(path.join(repoPath, '.ligma', 'journeys'))).toBe(true);
  });
});

describe('D1 — the build happens in the product repo', () => {
  it("points the builder's cwd at the product, not at ligma", () => {
    expect(productRepo(PROJECT_ID)).toBe(repoPath);
    expect(builderCwd(PROJECT_ID)).toBe(repoPath);
  });

  it('tells the builder it owes a README quickstart and a boot recipe', async () => {
    const tasks = await getTasks();
    const task = tasks.tasks.find((t) => t.id === taskId)!;
    const prompt = buildTaskPrompt(AGENT_ID, {
      ...(task as unknown as Parameters<typeof buildTaskPrompt>[1]),
      subtasks: [],
      collaborators: [],
      notes: '',
      estimatedMinutes: null,
    });
    expect(prompt).toContain(repoPath);
    expect(prompt).toContain('A working README with a quickstart');
    expect(prompt).toContain('.ligma/boot.json');
    // The stub is already on disk, so the instruction is REPLACE, not create —
    // told to create a file that exists, a builder reads it and leaves it (P12).
    expect(prompt).toContain('You MUST overwrite it');
  });

  it('refuses to settle a build that left the provisioned stub recipe in place', () => {
    // The builder has written the product but not its recipe. Provisioning
    // seeded a stub so the repo is never recipe-LESS (P12) — but the stub boots
    // the README, not the product, so this must not reach
    // awaiting-verification either. Absence and stub-left-behind fail alike.
    writeFileSync(path.join(repoPath, 'server.js'), SERVER_JS, 'utf-8');
    writeFileSync(path.join(repoPath, 'README.md'), README, 'utf-8');

    expect(bootGateFailure(taskId)).toContain('builder left the stub boot recipe in place');
  });

  it('settles into awaiting-verification once the recipe is there', async () => {
    mkdirSync(path.join(repoPath, '.ligma'), { recursive: true });
    writeFileSync(
      path.join(repoPath, '.ligma', 'boot.json'),
      `${JSON.stringify(BOOT, null, 2)}\n`,
      'utf-8',
    );
    expect(readBoot(repoPath).status).toBe('ready');
    expect(bootGateFailure(taskId)).toBeNull();

    expect(await handleBuilderCompletion(taskId, AGENT_ID, 'built the shortener')).toBe(
      'awaiting-verification',
    );
    const tasks = await getTasks();
    expect(tasks.tasks.find((t) => t.id === taskId)?.kanban).toBe('awaiting-verification');
  });
});

describe('D1 — task verification boots the product, not the dogfood app', () => {
  let verdict: VerificationVerdict;
  let runDir: string;
  let judgeArgs: Parameters<typeof runJudge>[0];
  const bridgeUrls: string[] = [];

  /**
   * The persona, minus the model. It is handed the real bridge session the run
   * created and drives it exactly as a consumer persona's curl would, so the
   * evidence below is evidence a bridge really wrote.
   */
  const persona = async (args: {
    spec: { charter: string; name: string; personaSeed: string | null };
    bridgeUrl: string;
    runDir: string;
    contract: AcceptanceContract;
  }): Promise<PersonaReport> => {
    bridgeUrls.push(args.bridgeUrl);
    const post = async (action: string, body: unknown): Promise<Record<string, unknown>> => {
      const res = await fetch(`${args.bridgeUrl}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as Record<string, unknown>;
    };

    const created = await post('request', {
      method: 'POST',
      path: '/api/links',
      json: { url: 'https://example.com/a/very/long/path' },
    });

    const dir = path.join(args.runDir, 'personas', args.spec.name);
    mkdirSync(dir, { recursive: true });
    const report: PersonaReport = {
      charter: args.spec.charter as PersonaReport['charter'],
      runId: path.basename(args.runDir),
      personaSeed: args.spec.personaSeed,
      goalAchieved: true,
      stepCount: 1,
      wrongTurns: 0,
      elapsedMs: 1000,
      findings: [],
      criterionResults:
        args.spec.charter === 'spec-auditor'
          ? args.contract.criteria.map((c) => ({
              criterionId: c.id,
              status: 'met' as const,
              evidence: [String(created.record)],
            }))
          : null,
      transcriptPath: path.posix.join('personas', args.spec.name, 'transcript.jsonl'),
      invalid: false,
    };
    writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');
    return report;
  };

  /** The REAL judge — only its model spawn is replaced. */
  const judge = (args: Parameters<typeof runJudge>[0]): Promise<VerificationVerdict> => {
    judgeArgs = args;
    const runner = {
      spawnAgent: async () => ({
        exitCode: 0,
        timedOut: false,
        stderr: '',
        pid: 0,
        stdout: JSON.stringify({
          type: 'result',
          result: `\`\`\`json\n${JSON.stringify({
            criterionVerdicts: args.contract.criteria.map((c) => ({
              criterionId: c.id,
              status: 'met',
              reasoning: "the bridge's own record shows it",
              evidence: [
                args.reports.find((r) => r.criterionResults)?.criterionResults?.[0].evidence[0] ??
                  '',
              ],
            })),
            humanDecisions: [],
          })}\n\`\`\``,
        }),
      }),
    } as unknown as AgentRunner;
    return runJudge({ ...args, runner });
  };

  it("runs the whole pipeline against the product's own boot recipe", async () => {
    const result = await runVerification({
      taskId,
      smoke: true,
      stub: { persona: persona as never, judge },
    });
    runDirs.push(result.runDir);
    runDir = result.runDir;
    verdict = result.verdict!;

    expect(result.manifest.status).toBe('complete');
    expect(result.manifest.taskId).toBe(taskId);
    // The env was cut from the PRODUCT repo: its base commit is a commit there.
    expect(() =>
      execFileSync('git', ['cat-file', '-e', result.manifest.baseCommit], { cwd: repoPath }),
    ).not.toThrow();
    // …and torn down again, from that same repo.
    const worktrees = execFileSync('git', ['worktree', 'list'], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    // ENVS_DIR, not ".envs": worktrees live outside every checkout now, so the
    // literal would pass whether or not teardown ran.
    expect(worktrees).not.toContain(process.env.LIGMA_ENVS_DIR!);
  }, 120_000);

  it("passes the daemon's configured workerModel as the judge's builderModel", () => {
    // Real assertJudgeModel runs inside runJudge — this is the value that has to
    // differ from harness.judgeModel ("opus") for judge/builder separation to hold.
    expect(judgeArgs.builderModel).toBe('sonnet');
  });

  it('used the consumer panel — an HTTP bridge, no browser', () => {
    expect(bridgeUrls.length).toBeGreaterThan(0);
    const files = walk(runDir).map((f) => path.relative(runDir, f).split(path.sep).join('/'));
    expect(files.filter((f) => f.endsWith('.png'))).toEqual([]);

    const records = files.filter((f) => f.includes('/records/'));
    expect(records.length).toBeGreaterThan(0);
    const record = JSON.parse(readFileSync(path.join(runDir, records[0]), 'utf-8')) as {
      status: number;
      schema: string;
    };
    // Evidence the PRODUCT answered — the dogfood app has no /api/links.
    expect(record.status).toBe(201);
    expect(record.schema).toContain('id:string');
  });

  it('signs the verdict, and the signature verifies', () => {
    const onDisk = JSON.parse(
      readFileSync(path.join(runDir, 'verdict.json'), 'utf-8'),
    ) as VerificationVerdict;
    expect(onDisk.outcome).toBe('passed');
    expect(onDisk.signature).not.toBeNull();
    const { signature, ...payload } = onDisk;
    expect(verify(payload, signature!)).toBe(true);
  });

  it('greens the task WITH a verdict to link to', async () => {
    const tasks = await getTasks();
    const task = tasks.tasks.find((t) => t.id === taskId) as unknown as {
      kanban: string;
      verificationStatus: string;
    };
    expect(task.kanban).toBe('done');
    expect(task.verificationStatus).toBe('passed');

    // The link itself: a complete run manifest for this task, carrying its verdict.
    const manifest = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf-8')) as {
      taskId: string;
      status: string;
      verdictPath: string | null;
    };
    expect(manifest.taskId).toBe(taskId);
    expect(manifest.status).toBe('complete');
    expect(manifest.verdictPath).toBe('verdict.json');
    expect(verdict.taskId).toBe(taskId);
  });
});

function walk(dir: string): string[] {
  return require('node:fs')
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e: { name: string; isDirectory(): boolean }) =>
      e.name === '.git'
        ? []
        : e.isDirectory()
          ? walk(path.join(dir, e.name))
          : [path.join(dir, e.name)],
    );
}
