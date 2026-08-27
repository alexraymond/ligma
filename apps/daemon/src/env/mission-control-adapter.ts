/**
 * mission-control-adapter.ts — The web TargetAdapter for the dogfood product.
 *
 * Isolation comes from the worktree: the app lives at `<worktree>/apps/web` and
 * its store at `<worktree>/data` — the same pair `apps/daemon/package.json`'s
 * dogfood pin (`LIGMA_DATA_DIR=../../data`) resolves to — so a dev server booted
 * here reads that worktree's data dir and nothing else.
 *
 * The paths below are the POST-REBRAND layout. They used to say
 * `<worktree>/mission-control`, a directory the rebrand removed, so every
 * ligma-self verification failed at install and burned an attempt (codebase
 * audit E2).
 *
 * Seeding is the part that matters. An empty database hides every UX bug an
 * acceptance harness is supposed to catch, so seed() writes a full, deliberately
 * hostile dataset: every enum value, unicode in every direction, a 300-char
 * title, a 10k-char note, dependency chains.
 */

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildSafeEnv } from '../engine/security';
import { ENVS_DIR } from './manifest';
import type { EnvManifest, SeedSummary, TargetAdapter } from './types';

const execFileAsync = promisify(execFile);

/** The real data dir, read-only source for agents.json / skills-library.json. */
import { DATA_DIR as REAL_DATA_DIR } from '../paths';

/** Something the app renders on every page — proof we got HTML, not a 200 shell. */
const HEALTH_MARKER = 'Ligma';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 500;

/** The Next app inside the monorepo — `apps/web` since the rebrand. */
function appDir(env: EnvManifest): string {
  return path.join(env.worktreePath, 'apps', 'web');
}

/**
 * The worktree's own JSON store. Repo-root `data/`, not `<app>/data`: the
 * daemon owns the store now (paths.ts `DATA_DIR`), and the dogfood pin points
 * it at the repo root.
 */
function seedDataDir(env: EnvManifest): string {
  return path.join(env.worktreePath, 'data');
}

export function bootLogPath(envId: string): string {
  return path.join(ENVS_DIR, `${envId}.boot.log`);
}

// ─── Ports ───────────────────────────────────────────────────────────────────

/** Ask the OS for a free port. No registry, no range, no collisions to manage. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Could not read assigned port')));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Is nothing serving this port? Used both as evidence that a torn-down env
 * released its port and as the pre-boot check for a fixed-port recipe.
 *
 * Probes BOTH loopback stacks by CONNECTING. The old bind-probe listened on
 * 127.0.0.1 alone and reported "free" while a dev server was live on [::1] —
 * which is where vite, vitepress and next bind by default (`localhost` resolves
 * to ::1 first on macOS). Worse, macOS grants a wildcard bind alongside an
 * address-specific one, so binding proves nothing about the port being taken.
 * A successful connection does.
 */
export function isPortFree(port: number): Promise<boolean> {
  const reachable = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const sock = net.connect({ port, host });
      const settle = (answer: boolean): void => {
        sock.destroy();
        resolve(answer);
      };
      sock.setTimeout(1_000);
      sock.once('connect', () => settle(true));
      sock.once('error', () => settle(false));
      sock.once('timeout', () => settle(false));
    });
  return Promise.all([reachable('127.0.0.1'), reachable('::1')]).then(
    (hits) => !hits.includes(true),
  );
}

// ─── Deterministic seed data ─────────────────────────────────────────────────

/** mulberry32 — small, fast, good enough, and identical across runs. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed epoch so a given seed produces byte-identical JSON every run. */
const BASE_MS = Date.parse('2026-08-01T09:00:00.000Z');
const at = (offsetMinutes: number) => new Date(BASE_MS + offsetMinutes * 60_000).toISOString();

const AGENT_IDS = ['me', 'researcher', 'developer', 'marketer', 'business-analyst'] as const;
const KANBAN = ['not-started', 'in-progress', 'awaiting-verification', 'done'] as const;
const VERIFICATION = ['unverified', 'in-review', 'passed', 'failed'] as const;
const MESSAGE_TYPES = ['delegation', 'report', 'question', 'update', 'approval'] as const;
const MESSAGE_STATUSES = ['unread', 'read', 'archived'] as const;
const EVENT_TYPES = [
  'task_created',
  'task_updated',
  'task_completed',
  'task_delegated',
  'message_sent',
  'decision_requested',
  'decision_answered',
  'brain_dump_triaged',
  'milestone_completed',
  'agent_checkin',
  'run',
  'verdict',
  'promote',
  'design_turn',
] as const;
const PROJECT_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;
const GOAL_STATUSES = ['not-started', 'in-progress', 'completed'] as const;

const MARKDOWN_NOTE = [
  '## Context',
  '',
  'Reproduced on `main` at commit `deadbeef`. See [the spec](https://example.test/spec).',
  '',
  '| Step | Expected | Actual |',
  '|------|----------|--------|',
  '| load | 200 | 500 |',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  '- [x] reproduced',
  '- [ ] fixed',
].join('\n');

/** ~10k chars of markdown, for layout/truncation bugs. */
const HUGE_NOTE = `${MARKDOWN_NOTE}\n\n${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(180)}`;

const LONG_TITLE = `Investigate the intermittent regression where ${'the scheduler silently drops queued work under sustained concurrent load and never surfaces an error to the operator, '.repeat(3)}which makes the failure invisible until a customer reports it`;

/** Titles that break naive rendering: CJK, emoji, RTL, combining marks. */
const UNICODE_TITLES = [
  '任务管理系统的性能优化与缓存策略',
  '🚀 Ship the launch checklist ✅🔥 (emoji in title)',
  'مراجعة استراتيجية التسويق للربع الرابع',
  'Zero​width​and c̷o̷m̷b̷i̷n̷i̷n̷g̷ marks ǫ̷̢̛n̷̡̛ ą̷̛ title',
];

interface SeedBundle {
  files: Record<string, unknown>;
  summary: SeedSummary;
}

/**
 * Build a complete data/ payload. Deterministic in `seed`: same seed in, same
 * bytes out. Exported so unit tests can assert coverage without spawning envs.
 */
export function generateSeedData(seed: number): SeedBundle {
  const rng = makeRng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  // ─── Projects ──────────────────────────────────────────────────────────
  const projects = Array.from({ length: 5 }, (_, i) => ({
    id: `proj_seed_${i + 1}`,
    name: [
      'Landing Page Rebuild',
      'API Gateway',
      'Growth Experiments',
      'Data Migration',
      '支持中文的项目',
    ][i],
    description: `Seeded project ${i + 1}. ${MARKDOWN_NOTE.slice(0, 120)}`,
    status: PROJECT_STATUSES[i % PROJECT_STATUSES.length],
    color: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'][i],
    teamMembers: AGENT_IDS.slice(0, (i % 4) + 1) as unknown as string[],
    createdAt: at(-60 * 24 * (30 - i)),
    tags: ['seeded', `p${i + 1}`],
    deletedAt: null,
  }));

  // ─── Goals: 3 long-term parents + 5 milestone children = 8 ─────────────
  const milestoneIds = Array.from({ length: 5 }, (_, i) => `mile_seed_${i + 1}`);
  const longTerm = Array.from({ length: 3 }, (_, i) => ({
    id: `goal_seed_${i + 1}`,
    title: [
      'Reach 100 paying customers',
      'Ship v1.0 of the platform',
      'Build a durable content engine',
    ][i],
    type: 'long-term' as const,
    timeframe: `Q${i + 1} 2026`,
    parentGoalId: null,
    projectId: i < projects.length ? projects[i].id : null,
    status: GOAL_STATUSES[i % GOAL_STATUSES.length],
    milestones: milestoneIds.filter((_, m) => m % 3 === i),
    tasks: [] as string[],
    createdAt: at(-60 * 24 * 40),
    deletedAt: null,
  }));
  const milestones = milestoneIds.map((id, i) => ({
    id,
    title: [
      'Landing page live',
      'Beta API published',
      'First 50 signups',
      '支持多语言的界面',
      'Pricing page shipped',
    ][i],
    type: 'medium-term' as const,
    timeframe: at(60 * 24 * (7 + i * 7)).slice(0, 10),
    parentGoalId: `goal_seed_${(i % 3) + 1}`,
    projectId: projects[i % projects.length].id,
    status: GOAL_STATUSES[(i + 1) % GOAL_STATUSES.length],
    milestones: [] as string[],
    tasks: [] as string[],
    createdAt: at(-60 * 24 * (20 - i)),
    deletedAt: null,
  }));
  const goals = [...longTerm, ...milestones];

  // ─── Tasks (120) ───────────────────────────────────────────────────────
  const TASK_COUNT = 120;
  const tasks = Array.from({ length: TASK_COUNT }, (_, i) => {
    const id = `task_seed_${String(i + 1).padStart(3, '0')}`;
    const kanban = KANBAN[i % KANBAN.length];
    // Realistic pairing that still visits all four verification states.
    const verificationStatus =
      kanban === 'done'
        ? 'passed'
        : kanban === 'awaiting-verification'
          ? i % 8 < 4
            ? 'in-review'
            : 'failed'
          : 'unverified';
    const subtaskCount = i % 4 === 3 ? 12 : i % 4; // 0, 1, 2, 12
    const assignedTo = i % 17 === 0 ? null : AGENT_IDS[i % AGENT_IDS.length];

    // Explicit dependency chain across tasks 8→9→10→11, plus scattered links.
    const blockedBy: string[] = [];
    if (i >= 8 && i <= 11) blockedBy.push(`task_seed_${String(i).padStart(3, '0')}`);
    else if (i > 20 && i % 13 === 0) blockedBy.push(`task_seed_${String(i - 5).padStart(3, '0')}`);

    let title = `Seeded task ${i + 1}: ${['refactor', 'investigate', 'document', 'ship', 'review'][i % 5]} the ${['scheduler', 'inbox', 'kanban board', 'goal tree', 'daemon'][i % 5]}`;
    if (i < UNICODE_TITLES.length) title = UNICODE_TITLES[i];
    if (i === 4) title = LONG_TITLE;

    const notes = i === 5 ? HUGE_NOTE : i % 7 === 0 ? MARKDOWN_NOTE : '';

    return {
      id,
      title,
      description:
        i % 11 === 0
          ? ''
          : `Deterministic seed description for ${id}. Covers ${kanban} / ${verificationStatus}.`,
      importance: i % 2 === 0 ? 'important' : 'not-important',
      urgency: i % 4 < 2 ? 'urgent' : 'not-urgent',
      kanban,
      verificationStatus,
      projectId: i % 6 === 5 ? null : projects[i % projects.length].id,
      milestoneId: i % 5 === 4 ? null : milestones[i % milestones.length].id,
      assignedTo,
      collaborators:
        i % 3 === 0
          ? [AGENT_IDS[(i + 1) % AGENT_IDS.length], AGENT_IDS[(i + 2) % AGENT_IDS.length]]
          : [],
      dailyActions:
        i % 9 === 0
          ? [
              {
                id: `da_${id}`,
                title: 'Daily action for today',
                done: i % 2 === 0,
                date: at(-60 * 24).slice(0, 10),
              },
            ]
          : [],
      subtasks: Array.from({ length: subtaskCount }, (_, s) => ({
        id: `sub_${id}_${s + 1}`,
        title: `Subtask ${s + 1} — ${pick(['write it', '測試一下', 'review 🧐', 'مراجعة'])}`,
        done: s < subtaskCount / 2,
      })),
      blockedBy,
      estimatedMinutes: i % 5 === 0 ? null : 15 * ((i % 8) + 1),
      actualMinutes: kanban === 'done' ? 15 * ((i % 7) + 1) : null,
      acceptanceCriteria:
        i % 4 === 0 ? [] : [`${id} renders without layout shift`, 'No console errors'],
      comments:
        i % 6 === 0
          ? [
              {
                id: `cmt_${id}_1`,
                author: AGENT_IDS[i % AGENT_IDS.length],
                content: `Comment with **markdown**, a [link](https://example.test), and unicode 🎯 على ${id}`,
                createdAt: at(-60 * (48 - (i % 40))),
              },
            ]
          : [],
      tags: i % 11 === 0 ? [] : ['seeded', `q${(i % 4) + 1}`],
      notes,
      dueDate: i % 3 === 0 ? at(60 * 24 * ((i % 14) + 1)) : null,
      createdAt: at(-60 * 24 * (30 - (i % 30))),
      updatedAt: at(-60 * ((i % 48) + 1)),
      completedAt: kanban === 'done' ? at(-60 * ((i % 24) + 1)) : null,
      deletedAt: null,
    };
  });

  // Link tasks back into goals so the goal tree is not empty.
  for (const [i, t] of tasks.entries()) {
    const g = goals[i % goals.length];
    g.tasks.push(t.id);
  }

  // ─── Inbox (40) ────────────────────────────────────────────────────────
  const messages = Array.from({ length: 40 }, (_, i) => {
    const status = MESSAGE_STATUSES[i % MESSAGE_STATUSES.length];
    return {
      id: `msg_seed_${String(i + 1).padStart(3, '0')}`,
      from: i % 4 === 0 ? 'system' : AGENT_IDS[i % AGENT_IDS.length],
      to: AGENT_IDS[(i + 2) % AGENT_IDS.length],
      type: MESSAGE_TYPES[i % MESSAGE_TYPES.length],
      taskId: i % 5 === 4 ? null : tasks[i % tasks.length].id,
      subject:
        i % 9 === 0
          ? `件名: ${tasks[i % tasks.length].title.slice(0, 40)}`
          : `Re: ${tasks[i % tasks.length].title.slice(0, 60)}`,
      body:
        i % 10 === 0 ? HUGE_NOTE.slice(0, 4000) : `${MARKDOWN_NOTE}\n\nSeeded message ${i + 1}.`,
      status,
      createdAt: at(-60 * (72 - i)),
      readAt: status === 'unread' ? null : at(-60 * (70 - i)),
    };
  });

  // ─── Activity log (60) ─────────────────────────────────────────────────
  const events = Array.from({ length: 60 }, (_, i) => ({
    id: `evt_seed_${String(i + 1).padStart(3, '0')}`,
    type: EVENT_TYPES[i % EVENT_TYPES.length],
    actor: i % 3 === 0 ? 'system' : AGENT_IDS[i % AGENT_IDS.length],
    taskId: i % 7 === 6 ? null : tasks[i % tasks.length].id,
    // Every 11th row omits it entirely — the seed has to contain the pre-Phase-2
    // shape too, or nothing downstream is ever tested against a row without it.
    ...(i % 11 === 10 ? {} : { projectId: tasks[i % tasks.length].projectId ?? null }),
    summary: `${EVENT_TYPES[i % EVENT_TYPES.length]} — ${tasks[i % tasks.length].title.slice(0, 50)}`,
    details: i % 8 === 0 ? MARKDOWN_NOTE : `Seeded event ${i + 1} details.`,
    timestamp: at(-60 * (60 - i)),
  }));

  // ─── Decisions (10) ────────────────────────────────────────────────────
  const decisions = Array.from({ length: 10 }, (_, i) => {
    const answered = i % 2 === 1;
    return {
      id: `dec_seed_${String(i + 1).padStart(2, '0')}`,
      requestedBy: i % 5 === 0 ? 'system' : AGENT_IDS[i % AGENT_IDS.length],
      taskId: i % 4 === 3 ? null : tasks[i * 7].id,
      question:
        i % 3 === 0
          ? `どのアプローチを採用すべきですか? (#${i + 1})`
          : `Which approach should we take for seeded decision ${i + 1}?`,
      options: ['Option A — cheap and fast', 'Option B — slow and correct', 'Option C — 折衷案 🤝'],
      context: MARKDOWN_NOTE,
      status: answered ? 'answered' : 'pending',
      answer: answered ? 'Option B — slow and correct' : null,
      answeredAt: answered ? at(-60 * (10 - i)) : null,
      createdAt: at(-60 * (40 - i)),
      blocksTask: i % 4 < 2,
    };
  });

  // ─── Brain dump (15) ───────────────────────────────────────────────────
  const entries = Array.from({ length: 15 }, (_, i) => {
    const processed = i % 3 === 0;
    return {
      id: `bd_seed_${String(i + 1).padStart(2, '0')}`,
      content:
        i % 5 === 0
          ? 'アイデア: エージェントの作業をタイムラインで可視化する 📈'
          : `Seeded idea ${i + 1}: what if the daemon reported its own health to the inbox?`,
      capturedAt: at(-60 * (30 - i)),
      processed,
      convertedTo: processed && i % 6 === 0 ? tasks[i].id : null,
      tags: i % 4 === 0 ? [] : ['idea', 'seeded'],
    };
  });

  const files: Record<string, unknown> = {
    'tasks.json': { tasks },
    'tasks-archive.json': { tasks: [] },
    'goals.json': { goals },
    'projects.json': { projects },
    'brain-dump.json': { entries },
    'inbox.json': { messages },
    'activity-log.json': { events },
    'decisions.json': { decisions },
  };

  return {
    files,
    summary: {
      seed,
      counts: {
        'tasks.json': tasks.length,
        'goals.json': goals.length,
        'projects.json': projects.length,
        'brain-dump.json': entries.length,
        'inbox.json': messages.length,
        'activity-log.json': events.length,
        'decisions.json': decisions.length,
      },
    },
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export function createMissionControlAdapter(seed: number): TargetAdapter {
  return {
    kind: 'web',

    async install(env) {
      // pnpm's content-addressed store makes this a hardlink copy, not a download.
      // Workspace root, not the app: pnpm resolves a monorepo's whole graph
      // from where pnpm-workspace.yaml lives.
      await execFileAsync('pnpm', ['install', '--prefer-offline'], {
        cwd: env.worktreePath,
        env: buildSafeEnv() as NodeJS.ProcessEnv,
        maxBuffer: 32 * 1024 * 1024,
      });
    },

    async seed(env) {
      const dataDir = seedDataDir(env);
      mkdirSync(dataDir, { recursive: true });

      const { files, summary } = generateSeedData(seed);
      for (const [name, payload] of Object.entries(files)) {
        writeFileSync(path.join(dataDir, name), JSON.stringify(payload, null, 2), 'utf-8');
      }

      // Structural files the app expects to already exist — copy, don't invent.
      // skills-library.json is the one exception: the daemon's own readers
      // default it to { skills: [] } when absent, so a dev checkout that has
      // never authored a skill must not fail seeding over it.
      for (const name of ['agents.json', 'skills-library.json']) {
        const src = path.join(REAL_DATA_DIR, name);
        if (name === 'skills-library.json' && !existsSync(src)) {
          writeFileSync(path.join(dataDir, name), JSON.stringify({ skills: [] }, null, 2), 'utf-8');
          continue;
        }
        copyFileSync(src, path.join(dataDir, name));
      }

      // The env must never start doing autonomous work of its own.
      const cfg = JSON.parse(
        readFileSync(path.join(REAL_DATA_DIR, 'daemon-config.json'), 'utf-8'),
      ) as {
        polling: { enabled: boolean };
        schedule: Record<string, { enabled: boolean }>;
      };
      cfg.polling.enabled = false;
      for (const job of Object.values(cfg.schedule)) job.enabled = false;
      writeFileSync(
        path.join(dataDir, 'daemon-config.json'),
        JSON.stringify(cfg, null, 2),
        'utf-8',
      );

      return summary;
    },

    async boot(env) {
      if (env.port === null) throw new Error('boot() requires a port');
      const logPath = bootLogPath(env.id);
      mkdirSync(path.dirname(logPath), { recursive: true });
      const log = openSync(logPath, 'a');

      // `pnpm exec next dev` instead of `pnpm dev -- -p N`: the dev script is
      // plain "next dev" and pnpm's `--` handling has changed between majors,
      // so passing the flag straight to the binary removes the ambiguity.
      const child: ChildProcess = spawn('pnpm', ['exec', 'next', 'dev', '-p', String(env.port)], {
        cwd: appDir(env),
        detached: true, // own process group, so teardown can kill the whole tree
        stdio: ['ignore', log, log] as const,
        // The store the seeded data actually went into, pinned explicitly so
        // this env can never read the real `~/.ligma/data`.
        env: { ...buildSafeEnv(), LIGMA_DATA_DIR: seedDataDir(env) } as NodeJS.ProcessEnv,
      });
      child.unref();
      if (child.pid === undefined) throw new Error('Failed to spawn dev server');

      return { pid: child.pid, url: `http://localhost:${env.port}` };
    },

    async health(env) {
      if (env.url === null) return false;
      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(env.url, { signal: AbortSignal.timeout(10_000) });
          if (res.status === 200) {
            const body = await res.text();
            if (body.includes(HEALTH_MARKER)) return true;
          }
        } catch {
          // Not up yet.
        }
        await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
      }
      return false;
    },

    async teardown(env) {
      if (env.pid !== null) {
        try {
          process.kill(-env.pid, 'SIGTERM');
        } catch {
          // Already gone.
        }
        const graceUntil = Date.now() + 5_000;
        while (Date.now() < graceUntil) {
          try {
            process.kill(-env.pid, 0);
          } catch {
            break; // group is gone
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        try {
          process.kill(-env.pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }

      // Evidence, not hope: the port must actually be rebindable.
      if (env.port !== null) {
        for (let i = 0; i < 25; i++) {
          if (await isPortFree(env.port)) return;
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`Port ${env.port} still bound after teardown of ${env.id}`);
      }
    },
  };
}
