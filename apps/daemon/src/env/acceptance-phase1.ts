/**
 * acceptance-phase1.ts — Phase 1 acceptance evidence. Run: pnpm env:acceptance
 *
 * Spins up five ephemeral envs in parallel from the current HEAD, each with its
 * own port and its own seeded dataset, proves each one serves ITS OWN data,
 * prints a timing table, tears everything down, and then proves the teardown
 * was real: no live pids, every port rebindable, no worktrees, no env branches.
 *
 * Exit code is the verdict. Non-zero = the phase does not pass.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createEnv, teardownEnv } from './lifecycle';
import { ENVS_DIR, REPO_ROOT, getEnv, isPidAlive } from './manifest';
import { generateSeedData, isPortFree } from './mission-control-adapter';
import type { EnvManifest } from './types';

const ENV_COUNT = 5;
const SEEDS = [1001, 1002, 1003, 1004, 1005];

const failures: string[] = [];

function check(ok: boolean, label: string): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
  return ok;
}

function ms(v: number | null): string {
  return v === null ? '—' : `${(v / 1000).toFixed(1)}s`;
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
}

async function verifyServesOwnData(env: EnvManifest, seed: number): Promise<void> {
  console.log(`\n[${env.id}] serving ${env.url}`);

  const page = await fetch(`${env.url}/`);
  const html = await page.text();
  check(page.status === 200, `GET / → 200 (got ${page.status})`);
  check(html.includes('<html'), 'GET / body is HTML');
  check(html.includes('Ligma'), 'GET / body contains app chrome');

  const expected = generateSeedData(seed).summary.counts['tasks.json'];
  const res = await fetch(`${env.url}/api/tasks`);
  const body = (await res.json()) as { tasks: { id: string }[]; meta: { total: number } };
  check(res.status === 200, `GET /api/tasks → 200 (got ${res.status})`);
  check(
    body.meta.total === expected,
    `GET /api/tasks meta.total === ${expected} seeded tasks (got ${body.meta.total})`,
  );
  // The parent repo has no task_seed_* ids, so this can only be the env's data.
  check(
    body.tasks.some((t) => t.id === 'task_seed_001'),
    "GET /api/tasks returns seeded ids (not the parent repo's tasks)",
  );

  const dash = await fetch(`${env.url}/api/dashboard`);
  const dashBody = (await dash.json()) as { stats: { totalTasks: number } };
  check(
    dashBody.stats.totalTasks === expected,
    `GET /api/dashboard stats.totalTasks === ${expected} (got ${dashBody.stats.totalTasks})`,
  );
}

async function main(): Promise<void> {
  const head = git(['rev-parse', 'HEAD']);
  console.log('═'.repeat(78));
  console.log('PHASE 1 ACCEPTANCE — ephemeral environments');
  console.log(`repo   ${REPO_ROOT}`);
  console.log(`branch ${git(['rev-parse', '--abbrev-ref', 'HEAD'])} @ ${head.slice(0, 8)}`);
  console.log(`envs   ${ENV_COUNT} in parallel, seeds ${SEEDS.join(', ')}`);
  console.log('═'.repeat(78));

  const wallStart = Date.now();
  const results = await Promise.allSettled(
    SEEDS.map((seed) => createEnv({ productId: 'mission-control', baseCommit: head, seed })),
  );
  const wallMs = Date.now() - wallStart;

  const envs: EnvManifest[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') {
      envs.push(r.value);
    } else {
      failures.push(`env with seed ${SEEDS[i]} failed to come up: ${r.reason}`);
      console.log(`\n  FAIL  createEnv(seed=${SEEDS[i]}): ${r.reason}`);
    }
  }

  // ─── Timing table ────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('TIMINGS');
  console.log('─'.repeat(78));
  const header = ['env', 'port', 'worktree', 'install', 'seed', 'boot', 'health', 'total'];
  const widths = [26, 6, 9, 9, 7, 7, 8, 8];
  console.log(header.map((h, i) => h.padEnd(widths[i])).join(''));
  for (const env of envs) {
    const t = env.timings;
    const row = [
      env.id,
      String(env.port ?? '—'),
      ms(t.worktreeMs),
      ms(t.installMs),
      ms(t.seedMs),
      ms(t.bootMs),
      ms(t.healthMs),
      ms(t.totalMs),
    ];
    console.log(row.map((c, i) => c.padEnd(widths[i])).join(''));
  }
  console.log('─'.repeat(78));
  console.log(`parallel wall clock for ${envs.length}/${ENV_COUNT} envs: ${ms(wallMs)}`);

  // ─── Seed summaries ──────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('SEEDED RECORD COUNTS (from manifest seedSummary)');
  console.log('─'.repeat(78));
  for (const env of envs) {
    const s = env.seedSummary;
    console.log(
      `${env.id}  seed=${s?.seed ?? '—'}  ${
        s
          ? Object.entries(s.counts)
              .map(([k, v]) => `${k.replace('.json', '')}=${v}`)
              .join('  ')
          : 'none'
      }`,
    );
  }

  // ─── Per-env black-box checks ────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('BLACK-BOX CHECKS (URL only, as a Phase 2 tester agent would see)');
  console.log('─'.repeat(78));
  for (const [i, env] of envs.entries()) {
    try {
      await verifyServesOwnData(env, SEEDS[i]);
    } catch (err) {
      check(false, `${env.id} checks threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Teardown ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('TEARDOWN');
  console.log('─'.repeat(78));
  const preTeardown = envs.map((e) => ({
    id: e.id,
    pid: e.pid,
    port: e.port,
    worktreePath: e.worktreePath,
    branch: e.branch,
  }));
  const teardownStart = Date.now();
  const torn = await Promise.allSettled(envs.map((e) => teardownEnv(e.id)));
  for (const [i, r] of torn.entries()) {
    check(
      r.status === 'fulfilled',
      `teardownEnv(${envs[i].id}) completed${r.status === 'rejected' ? `: ${r.reason}` : ''}`,
    );
  }
  console.log(`teardown wall clock: ${ms(Date.now() - teardownStart)}`);

  // ─── Post-teardown evidence ──────────────────────────────────────────────
  console.log(`\n${'─'.repeat(78)}`);
  console.log('POST-TEARDOWN EVIDENCE');
  console.log('─'.repeat(78));
  for (const e of preTeardown) {
    check(e.pid === null || !isPidAlive(e.pid), `pid ${e.pid} is dead (${e.id})`);
    check(e.port !== null && (await isPortFree(e.port)), `port ${e.port} is rebindable (${e.id})`);
    check(
      !existsSync(e.worktreePath),
      `worktree dir removed: ${e.worktreePath.replace(ENVS_DIR, '<envs>')}`,
    );
    check(getEnv(e.id)?.status === 'torn-down', `manifest status is torn-down (${e.id})`);
  }

  const worktrees = git(['worktree', 'list']).split('\n').filter(Boolean);
  check(
    worktrees.length === 1,
    `git worktree list shows only the main tree (found ${worktrees.length}):\n        ${worktrees.join('\n        ')}`,
  );

  const envBranches = git(['branch', '--list', 'env/*'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  check(
    envBranches.length === 0,
    `no env/* branches left (found ${envBranches.length}${envBranches.length ? `: ${envBranches.join(', ')}` : ''})`,
  );

  // ─── Verdict ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(78)}`);
  if (failures.length === 0) {
    console.log(
      `PHASE 1 ACCEPTANCE: PASS — ${ENV_COUNT}/${ENV_COUNT} envs created, verified, torn down`,
    );
    console.log('═'.repeat(78));
    return;
  }
  console.log(`PHASE 1 ACCEPTANCE: FAIL — ${failures.length} check(s) failed`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log('═'.repeat(78));
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('acceptance harness crashed:', err);
  process.exitCode = 1;
});
