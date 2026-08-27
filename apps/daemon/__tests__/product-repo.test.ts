/**
 * Greenfield build-side wiring: where a product's code lives, where its builder
 * stands, and what the build owes the repo before it can be verified.
 *
 * Three behaviours, one temp data dir:
 *   - provisioning is idempotent and never writes into someone else's repo;
 *   - a task's builder cwd is its product repo, and ligma-self is still ligma;
 *   - a finished build with no boot recipe is refused, in the env-preflight
 *     failure class, instead of being parked in awaiting-verification.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-product-data-'));
const productsDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-products-'));
process.env.LIGMA_DATA_DIR = dataDir;
process.env.LIGMA_PRODUCTS_DIR = productsDir;

const PRODUCT_ID = 'proj_product';
const SELF_ID = 'proj_self';
const GREENFIELD_ID = 'proj_greenfield';

/** A repo that stands in for a built product. */
const productRepoDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-adopted-'));
execFileSync('git', ['init', '-q'], { cwd: productRepoDir });

const project = (id: string, name: string, repoPath: string | null) => ({
  id,
  name,
  description: 'a product',
  status: 'active',
  color: '#000',
  teamMembers: [],
  createdAt: '2026-08-11T00:00:00.000Z',
  tags: [],
  deletedAt: null,
  repoPath,
  shape: 'headless',
});

const { REPO_ROOT } = await import('../src/paths');

mkdirSync(dataDir, { recursive: true });
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      project(PRODUCT_ID, 'Product', productRepoDir),
      // repoPath pointing at the ligma checkout itself — the dogfood project.
      project(SELF_ID, 'Ligma', REPO_ROOT),
      project(GREENFIELD_ID, 'URL Shortener', null),
    ],
  }),
  'utf-8',
);
writeFileSync(
  path.join(dataDir, 'tasks.json'),
  JSON.stringify({
    tasks: [
      { id: 'task_product', title: 'Build it', projectId: PRODUCT_ID, kanban: 'in-progress' },
      {
        id: 'task_greenfield',
        title: 'Build the shortener',
        projectId: GREENFIELD_ID,
        kanban: 'in-progress',
      },
      { id: 'task_self', title: 'Fix ligma', projectId: SELF_ID, kanban: 'in-progress' },
      { id: 'task_orphan', title: 'No project', projectId: null, kanban: 'in-progress' },
    ],
  }),
  'utf-8',
);
writeFileSync(path.join(dataDir, 'inbox.json'), JSON.stringify({ messages: [] }), 'utf-8');
writeFileSync(path.join(dataDir, 'decisions.json'), JSON.stringify({ decisions: [] }), 'utf-8');
writeFileSync(
  path.join(dataDir, 'agents.json'),
  JSON.stringify({
    agents: [
      {
        id: 'dev',
        name: 'Developer',
        description: 'builds',
        instructions: '',
        capabilities: [],
        skillIds: [],
        status: 'active',
      },
    ],
  }),
  'utf-8',
);
writeFileSync(path.join(dataDir, 'skills-library.json'), JSON.stringify({ skills: [] }), 'utf-8');

const { productsRoot, productSlug, provisionRepo, ensureProductRepo, isStubBoot } = await import(
  '../src/store/product-repo'
);
const { bootGateFailure, builderCwd, productRepo, taskProductEnv } = await import(
  '../src/engine/task-env'
);
const { readBoot, writeBoot } = await import('../src/store/ligma-dir');
const { bootRecipeCheck } = await import('../src/env/preflight');
const { addEvidencePin } = await import('../src/engine/evidence-pins');
const { buildTaskPrompt } = await import('../src/engine/prompt-builder');

afterAll(() => {
  for (const dir of [dataDir, productsDir, productRepoDir])
    rmSync(dir, { recursive: true, force: true });
});

const RECIPE = {
  appDir: '.',
  install: null,
  dev: ['node', 'server.js'],
  portStrategy: { kind: 'env' as const, var: 'PORT' },
  healthPath: '/health',
  healthMarker: 'ok',
  seed: null,
};

describe('provisioning a product repo', () => {
  it("resolves the products root and the slug from the project's name", () => {
    expect(productsRoot()).toBe(productsDir);
    expect(productSlug('URL Shortener!', 'proj_x')).toBe('url-shortener');
    // A name with nothing slug-able falls back to the id, which is safe by construction.
    expect(productSlug('///', 'proj_x')).toBe('proj_x');
  });

  it('inits a git repo with a seeded README and a first commit', () => {
    const dir = path.join(productsDir, 'fresh');
    provisionRepo(dir, 'Fresh', 'shortens urls');

    expect(existsSync(path.join(dir, '.git'))).toBe(true);
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(readme).toContain('# Fresh');
    expect(readme).toContain('shortens urls');
    expect(readme).toContain('## Quickstart');

    const log = execFileSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf-8' });
    expect(log).toContain('seed product repo');
  });

  it('refuses to write into a directory that already has commits', () => {
    const dir = path.join(productsDir, 'fresh');
    expect(() => provisionRepo(dir, 'Fresh')).toThrow(/already exists and has commits/);
  });

  it('refuses a non-empty directory that is not a repo', () => {
    const dir = path.join(productsDir, 'occupied');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'someones-work.txt'), 'mine', 'utf-8');
    expect(() => provisionRepo(dir, 'Occupied')).toThrow(/not empty/);
  });

  it('lands the repo on the project and is idempotent from there', async () => {
    const first = await ensureProductRepo(GREENFIELD_ID);
    expect(first).toBe(path.join(productsDir, 'url-shortener'));

    const projects = JSON.parse(readFileSync(path.join(dataDir, 'projects.json'), 'utf-8')) as {
      projects: Array<{ id: string; repoPath: string | null }>;
    };
    expect(projects.projects.find((p) => p.id === GREENFIELD_ID)?.repoPath).toBe(first);

    // Second promote: same path, nothing re-created, no throw.
    expect(await ensureProductRepo(GREENFIELD_ID)).toBe(first);
  });

  it('never provisions over a project that already has a repo', async () => {
    expect(await ensureProductRepo(PRODUCT_ID)).toBe(productRepoDir);
    expect(await ensureProductRepo(SELF_ID)).toBe(REPO_ROOT);
  });
});

describe('builder cwd', () => {
  it('is the product repo for a task on a project with one', () => {
    expect(productRepo(PRODUCT_ID)).toBe(productRepoDir);
    expect(builderCwd(PRODUCT_ID)).toBe(productRepoDir);
  });

  it('is unchanged for ligma-self: no project, or a repoPath that IS this checkout', () => {
    expect(productRepo(null)).toBeNull();
    expect(productRepo(SELF_ID)).toBeNull();
    expect(builderCwd(null)).toBe('');
    expect(builderCwd(SELF_ID)).toBe('');
  });
});

describe('the boot-recipe gate on completion', () => {
  it('blocks a product build with no recipe, in the env-preflight failure class', () => {
    const reason = bootGateFailure('task_product');
    expect(reason).toContain('No .ligma/boot.json');
    expect(reason).toContain(productRepoDir);
    expect(() => taskProductEnv(PRODUCT_ID)).toThrow(/No \.ligma\/boot\.json/);
  });

  it('blocks an INVALID recipe with the validation error, never silently', () => {
    mkdirSync(path.join(productRepoDir, '.ligma'), { recursive: true });
    writeFileSync(path.join(productRepoDir, '.ligma', 'boot.json'), '{"dev":[]}', 'utf-8');
    expect(bootGateFailure('task_product')).toMatch(/dev|boot\.json/);
  });

  it('passes once a valid recipe exists, and hands it to the verification env', () => {
    writeBoot(productRepoDir, RECIPE);
    expect(bootGateFailure('task_product')).toBeNull();
    expect(taskProductEnv(PRODUCT_ID)).toEqual({ repoPath: productRepoDir, boot: RECIPE });
  });

  it('never gates a ligma-self task — the dogfood adapter needs no recipe', () => {
    expect(bootGateFailure('task_self')).toBeNull();
    expect(bootGateFailure('task_orphan')).toBeNull();
    expect(taskProductEnv(SELF_ID)).toBeNull();
  });
});

/**
 * P12's full lifecycle. Seeding a stub alone would be UNSAFE: the stub is a
 * valid recipe, so the preflight check passes on it and a build that never
 * wrote a real one would verify by reading README.md forever. These four
 * assertions are the coordinated fix — seeded and marked, prompt says replace
 * it, gate refuses it by name, real recipe passes.
 */
describe('the stub boot recipe a greenfield repo is provisioned with', () => {
  // Provisioned by ensureProductRepo(GREENFIELD_ID) in the first block.
  const greenfieldDir = path.join(productsDir, 'url-shortener');

  const greenfieldTask = {
    id: 'task_greenfield',
    title: 'Build the shortener',
    description: 'the thing',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'in-progress',
    assignedTo: 'dev',
    projectId: GREENFIELD_ID,
    collaborators: [],
    subtasks: [],
    acceptanceCriteria: ['it shortens urls'],
    notes: '',
    estimatedMinutes: null,
  };

  it('is committed, valid, and marked a stub — so absence is not a state a product repo can be in', () => {
    expect(existsSync(path.join(greenfieldDir, '.ligma', 'boot.json'))).toBe(true);
    expect(isStubBoot(greenfieldDir)).toBe(true);
    // Valid on purpose: `readBoot` parses it and the preflight check PASSES.
    // That pass is exactly why the gate below cannot rely on the check alone.
    expect(readBoot(greenfieldDir).status).toBe('ready');
    expect(bootRecipeCheck(greenfieldDir, true).status).toBe('pass');
    const tracked = execFileSync('git', ['ls-files', '.ligma/boot.json'], {
      cwd: greenfieldDir,
      encoding: 'utf-8',
    });
    expect(tracked.trim()).toBe('.ligma/boot.json');
  });

  it('fails the boot gate by name — a stub left in place is not a finished build', () => {
    expect(bootGateFailure('task_greenfield')).toContain(
      'builder left the stub boot recipe in place',
    );
    expect(() => taskProductEnv(GREENFIELD_ID)).toThrow(/stub boot recipe in place/);
  });

  it('makes the builder prompt say REPLACE, not create', () => {
    const prompt = buildTaskPrompt('dev', greenfieldTask);
    expect(prompt).toContain('One is ALREADY THERE and it is a placeholder');
    expect(prompt).toContain('"stub": true');
    expect(prompt).toContain('You MUST overwrite it');
    // The adopted repo (real recipe, written in the block above) gets the plain
    // wording — nothing to replace there.
    expect(
      buildTaskPrompt('dev', { ...greenfieldTask, id: 'task_product', projectId: PRODUCT_ID }),
    ).not.toContain('ALREADY THERE');
  });

  it('passes once the builder replaces it with a real recipe', () => {
    // `writeBoot` validates against the schema, which has no `stub` key — so
    // any real write drops the mark. That IS the lifecycle.
    writeBoot(greenfieldDir, RECIPE);
    expect(isStubBoot(greenfieldDir)).toBe(false);
    expect(bootGateFailure('task_greenfield')).toBeNull();
    expect(taskProductEnv(GREENFIELD_ID)).toEqual({ repoPath: greenfieldDir, boot: RECIPE });
  });
});

describe('the builder prompt for a product build', () => {
  const task = {
    id: 'task_product',
    title: 'Build it',
    description: 'the thing',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'in-progress',
    assignedTo: 'dev',
    projectId: PRODUCT_ID,
    collaborators: [],
    subtasks: [],
    acceptanceCriteria: ['it shortens urls'],
    notes: '',
    estimatedMinutes: null,
  };

  it('requires a README quickstart and a valid boot.json, and names the repo', () => {
    const prompt = buildTaskPrompt('dev', task);
    expect(prompt).toContain(productRepoDir);
    expect(prompt).toContain('A working README with a quickstart');
    expect(prompt).toContain('.ligma/boot.json');
    expect(prompt).toContain('healthMarker');
  });

  it('says none of it on a ligma-self task', () => {
    const prompt = buildTaskPrompt('dev', { ...task, id: 'task_self', projectId: SELF_ID });
    expect(prompt).not.toContain('This build ships a product, not a patch');
  });

  it("carries the reviewer's evidence pins into the fix task's prompt", () => {
    addEvidencePin({
      id: 'pin_1',
      projectId: PRODUCT_ID,
      runId: 'vrun_1',
      // A headless run's evidence is a record, not a picture — the pin points
      // at a line in it, and still compiles into the same instruction block.
      kind: 'record',
      evidencePath: 'personas/naive-developer-1/records/GET-health.json',
      line: 3,
      field: null,
      comment: "the quickstart's second command 404s",
      disposition: 'feedback',
      taskId: 'task_product',
      createdAt: new Date().toISOString(),
    });

    const prompt = buildTaskPrompt('dev', task);
    expect(prompt).toContain('REQUIRED FIXES');
    expect(prompt).toContain("the quickstart's second command 404s");
    expect(prompt).toContain('records/GET-health.json');
  });

  it('ignores a pin filed against another task', () => {
    addEvidencePin({
      id: 'pin_2',
      projectId: PRODUCT_ID,
      runId: 'vrun_1',
      kind: 'image',
      evidencePath: 'personas/spec-auditor/records/POST-links.json',
      x: 0.1,
      y: 0.1,
      comment: 'unrelated defect',
      disposition: 'feedback',
      taskId: 'task_elsewhere',
      createdAt: new Date().toISOString(),
    });

    expect(buildTaskPrompt('dev', task)).not.toContain('unrelated defect');
  });
});
