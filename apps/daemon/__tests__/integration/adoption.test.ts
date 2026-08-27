/**
 * Integration: brownfield adoption end to end with the LLM layer stubbed
 * (UX spec F2, build brief §7 D3).
 *
 * The two agent passes are injected; everything else is the real pipeline — repo
 * fact gathering, Zod validation of the inferred recipe, the run store, and the
 * review sheet that is the only thing allowed to write into the target repo.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdoptionAgents } from '../../src/engine/adopt-repo';
import {
  ADOPTION_RUNS_DIR,
  applyAdoptionReview,
  createAdoptionRun,
  getAdoptionRun,
  readRepoFacts,
  retryAdoption,
  runAdoption,
} from '../../src/engine/adopt-repo';
import { DATA_DIR } from '../../src/paths';
import { getProjects } from '../../src/store/data';
import { listJourneys, readBoot, readProjectMd } from '../../src/store/ligma-dir';

let repo: string;
const createdRuns: string[] = [];

const INFERRED_BOOT = {
  appDir: '.',
  install: ['npm', 'ci'],
  dev: ['npm', 'run', 'dev'],
  portStrategy: { kind: 'env' as const, var: 'PORT' },
  healthPath: '/',
  healthMarker: 'Widget Shop',
  seed: null,
};

const stubAgents: AdoptionAgents = {
  async inferBoot(facts) {
    // Proof the pass is handed real, structured facts — not a scraped blob.
    expect(facts.packageJson?.scripts?.dev).toBe('vite');
    expect(facts.markers).toContain('README.md');
    return { boot: INFERRED_BOOT, rationale: 'package.json has a dev script on vite', shape: 'ui' };
  },
  async explore() {
    return {
      journeys: [
        {
          title: 'Buy a widget',
          goal: 'Get a widget into the basket and pay',
          steps: ['find a widget', 'pay'],
          tags: ['core'],
          rationale: 'the shop is the point',
        },
        {
          title: 'Track an order',
          goal: 'Find out where an order got to',
          steps: ['find orders'],
          tags: [],
          rationale: 'there is an orders link',
        },
        {
          title: 'Change the theme',
          goal: 'Switch to dark mode',
          steps: [],
          tags: [],
          rationale: 'there is a toggle',
        },
      ],
      confusion: [
        {
          severity: 'major',
          summary: 'The basket icon shows no count until you hover it',
          evidence: ['shots/02-click.png'],
        },
        { severity: 'note', summary: 'Two buttons both say Continue', evidence: [] },
      ],
    };
  },
};

/** The run's own append-only log, as `GET /api/runs/:id/output` parses it. */
function readRunLog(runId: string): Array<{ stream: string; text: string }> {
  const raw = readFileSync(path.join(DATA_DIR, 'run-outputs', `${runId}.jsonl`), 'utf-8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { stream: string; text: string });
}

function initFixtureRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'adopt-fixture-'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'widget-shop',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { vite: '^5' },
      },
      null,
      2,
    ),
    'utf-8',
  );
  writeFileSync(path.join(dir, 'README.md'), '# Widget Shop\n\nRun `npm run dev`.\n', 'utf-8');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: dir,
  });
  return dir;
}

beforeAll(() => {
  repo = initFixtureRepo();
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  for (const id of createdRuns) rmSync(path.join(ADOPTION_RUNS_DIR, `${id}.json`), { force: true });
});

describe('repo facts', () => {
  it('reads structure and manifests, never prose', () => {
    const facts = readRepoFacts(repo);
    expect(facts.name).toBe(path.basename(repo));
    expect(facts.entries).toContain('package.json');
    expect(facts.packageJson?.dependencies).toEqual(['vite']);
    expect(facts.readme).toContain('Widget Shop');
  });
});

describe('adoption run', () => {
  it('refuses a path that is not a git repo — an env is cut from a worktree', () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'));
    expect(() => createAdoptionRun(plain)).toThrow(/not a git repository/);
    expect(() => createAdoptionRun(path.join(plain, 'nope'))).toThrow(/No such directory/);
    rmSync(plain, { recursive: true, force: true });
  });

  it('infers a recipe, proposes journeys, and parks awaiting review without touching the repo', async () => {
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);

    const run = await runAdoption(created.id, { agents: stubAgents, skipEnv: true });

    expect(run.status).toBe('awaiting-review');
    expect(run.shape).toBe('ui');
    expect(run.boot).toEqual(INFERRED_BOOT);
    expect(run.bootRationale).toContain('vite');
    expect(run.proposedJourneys).toHaveLength(3);
    expect(run.confusionLog).toHaveLength(2);
    expect(run.error).toBeNull();

    // Nothing is written into someone else's repo before they say so.
    expect(existsSync(path.join(repo, '.ligma'))).toBe(false);

    // And it is durable — the route reads it back from disk.
    expect(getAdoptionRun(created.id)?.status).toBe('awaiting-review');
  });

  it('keeps a log of the facts and the recipe, where the run detail serves it', async () => {
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);
    await runAdoption(created.id, { agents: stubAgents, skipEnv: true });

    // The same append-only JSONL every other run streams from, so
    // GET /api/runs/:id/output serves an adoption run with no special case.
    const lines = readRunLog(created.id);
    expect(lines.every((l) => l.stream === 'stdout')).toBe(true);
    // The facts that steered the recipe, then the recipe itself — the two
    // things a human needs to see to correct one.
    const text = lines.map((l) => l.text).join('');
    expect(text).toContain('"installCandidates"');
    expect(text).toContain('Widget Shop');
  });

  it('records an inference failure as a harness error, never as a claim about the repo', async () => {
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);

    const run = await runAdoption(created.id, {
      skipEnv: true,
      agents: {
        async inferBoot() {
          throw new Error('boot inference failed (exit 1)');
        },
        explore: stubAgents.explore,
      },
    });

    expect(run.status).toBe('error');
    expect(run.error).toContain('boot inference failed');
    expect(existsSync(path.join(repo, '.ligma'))).toBe(false);
    // …and the failure is written into the run's own log, not just its record.
    expect(
      readRunLog(run.id).some(
        (l) => l.stream === 'stderr' && l.text.includes('boot inference failed'),
      ),
    ).toBe(true);
  });
});

describe('review sheet', () => {
  it('applies a batch of accept / edit / reject in one call', async () => {
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);
    await runAdoption(created.id, { agents: stubAgents, skipEnv: true });

    const response = await applyAdoptionReview(created.id, {
      name: 'Widget Shop',
      shape: 'ui',
      journeys: [
        { index: 0, action: 'accept' },
        {
          index: 1,
          action: 'accept',
          edited: {
            title: 'Track an order',
            goal: 'Find out where an order got to, from the order number alone',
            steps: ['find the orders list', 'open one order', 'see its current state'],
            tags: ['orders'],
            rationale: 'edited by the human',
          },
        },
        { index: 2, action: 'reject' },
      ],
    });

    expect(response.acceptedJourneyIds).toHaveLength(2);
    expect(response.rejected).toBe(1);

    // The project row carries repoPath and shape (twin-primitives §1).
    const project = (await getProjects()).projects.find((p) => p.id === response.projectId);
    expect(project).toMatchObject({
      name: 'Widget Shop',
      repoPath: repo,
      shape: 'ui',
      tags: ['adopted'],
    });

    // `.ligma/` is written into the target repo — recipe, journeys, notes.
    expect(readBoot(repo).boot).toEqual(INFERRED_BOOT);

    const { journeys, invalid } = listJourneys(repo);
    expect(invalid).toEqual([]);
    expect(journeys.map((j) => j.title).sort()).toEqual(['Buy a widget', 'Track an order']);
    expect(journeys.every((j) => j.origin === 'discovery')).toBe(true);
    // The human's edit is what landed, not the proposal.
    expect(journeys.find((j) => j.title === 'Track an order')?.steps).toHaveLength(3);

    // The confusion log becomes the project's first UX audit.
    const notes = readProjectMd(repo);
    expect(notes).toContain('First UX audit');
    expect(notes).toContain('basket icon shows no count');
    expect(notes).toContain(`adoption:${created.id}`);

    // The run is closed out and cannot be applied twice.
    expect(getAdoptionRun(created.id)?.status).toBe('applied');
    await expect(applyAdoptionReview(created.id, { journeys: [] })).rejects.toThrow(
      /already applied/,
    );
  });

  it('takes a corrected boot recipe over the inferred one, and validates it', async () => {
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);
    await runAdoption(created.id, { agents: stubAgents, skipEnv: true });

    await expect(
      applyAdoptionReview(created.id, { boot: { dev: 'npm run dev' } as never, journeys: [] }),
    ).rejects.toThrow();

    await applyAdoptionReview(created.id, {
      boot: { ...INFERRED_BOOT, healthMarker: 'Widget Shop — corrected' },
      journeys: [],
    });
    expect(readBoot(repo).boot).toMatchObject({ healthMarker: 'Widget Shop — corrected' });
  });

  it('re-adopting the same repo updates the project instead of duplicating it', async () => {
    const before = (await getProjects()).projects.filter((p) => p.repoPath === repo).length;
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);
    await runAdoption(created.id, { agents: stubAgents, skipEnv: true });
    await applyAdoptionReview(created.id, { shape: 'mixed', journeys: [] });

    const after = (await getProjects()).projects.filter((p) => p.repoPath === repo);
    expect(after).toHaveLength(before);
    expect(after[0].shape).toBe('mixed');
  });

  it('rejects a decision that points at no proposal', async () => {
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);
    await runAdoption(created.id, { agents: stubAgents, skipEnv: true });
    await expect(
      applyAdoptionReview(created.id, { journeys: [{ index: 99, action: 'accept' }] }),
    ).rejects.toThrow(/No proposed journey at index 99/);
  });
});

describe('the adopted repo is now provable', () => {
  it('carries a valid recipe and journeys the harness can run', () => {
    expect(readBoot(repo).status).toBe('ready');
    const { journeys } = listJourneys(repo);
    expect(journeys.length).toBeGreaterThan(0);
    for (const j of journeys) {
      expect(j.goal.length).toBeGreaterThan(0);
      // A journey file is JSON the builder may read — the visible slice.
      expect(
        JSON.parse(readFileSync(path.join(repo, '.ligma', 'journeys', `${j.id}.json`), 'utf-8')).id,
      ).toBe(j.id);
    }
    // Still nothing verification-sensitive in the repo.
    expect(existsSync(path.join(repo, '.ligma', 'baselines'))).toBe(false);
  });
});

/**
 * A failed adoption is recoverable, not a dead end (F2). The failure the D3
 * campaign hit was a boot recipe the model could not have got right — so the
 * correction is the recipe, and the retry boots straight from it.
 */
describe('recovery from a failed run', () => {
  const failingInfer: AdoptionAgents = {
    async inferBoot() {
      throw new Error('Command failed: pnpm install');
    },
    explore: stubAgents.explore,
  };

  async function failedRun(): Promise<string> {
    const created = createAdoptionRun(repo);
    createdRuns.push(created.id);
    await runAdoption(created.id, { skipEnv: true, agents: failingInfer });
    expect(getAdoptionRun(created.id)?.status).toBe('error');
    return created.id;
  }

  it('takes a corrected recipe and boots from it instead of inferring again', async () => {
    const runId = await failedRun();
    const corrected = { ...INFERRED_BOOT, appDir: 'app', install: ['bun', 'install'] };

    const queued = retryAdoption(runId, corrected);
    expect(queued.status).toBe('running');
    expect(queued.error).toBeNull();
    expect(queued.boot).toEqual(corrected);

    // The same agents that could not infer a recipe — the retry never asks them.
    const run = await runAdoption(runId, { skipEnv: true, agents: failingInfer });
    expect(run.status).toBe('awaiting-review');
    expect(run.boot).toEqual(corrected);
    expect(run.proposedJourneys).toHaveLength(3);
  });

  it('re-infers when the retry carries no correction', async () => {
    const runId = await failedRun();
    expect(retryAdoption(runId).boot).toBeNull();

    const run = await runAdoption(runId, { skipEnv: true, agents: stubAgents });
    expect(run.status).toBe('awaiting-review');
    expect(run.boot).toEqual(INFERRED_BOOT);
  });

  it("keeps the failed attempt's log and appends the next one to it", async () => {
    const runId = await failedRun();
    expect(
      readRunLog(runId)
        .map((l) => l.text)
        .join(''),
    ).toContain('Command failed: pnpm install');

    retryAdoption(runId, INFERRED_BOOT);
    await runAdoption(runId, { skipEnv: true, agents: stubAgents });

    // Same run, same log: the attempt that died is still readable next to the
    // attempt that worked, which is the whole point of retrying in place.
    const text = readRunLog(runId)
      .map((l) => l.text)
      .join('');
    expect(text).toContain('Command failed: pnpm install');
    expect(text).toContain('Widget Shop');
  });

  it('validates the corrected recipe, and refuses a run that is not recoverable', async () => {
    const runId = await failedRun();
    expect(() => retryAdoption(runId, { dev: 'npm run dev' })).toThrow();
    expect(getAdoptionRun(runId)?.status).toBe('error');

    expect(() => retryAdoption('arun_nope')).toThrow(/No such adoption run/);

    retryAdoption(runId, INFERRED_BOOT);
    expect(() => retryAdoption(runId)).toThrow(/still running/);

    await runAdoption(runId, { skipEnv: true, agents: stubAgents });
    await applyAdoptionReview(runId, { journeys: [] });
    expect(() => retryAdoption(runId)).toThrow(/already applied/);
  });
});
