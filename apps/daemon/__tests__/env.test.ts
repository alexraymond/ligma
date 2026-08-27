import { describe, expect, it } from 'vitest';
import { findDeadEnvs } from '../src/env/manifest';
import { generateSeedData } from '../src/env/mission-control-adapter';
import type { EnvManifest, EnvStatus } from '../src/env/types';

// ─── Seed generator ─────────────────────────────────────────────────────────

interface SeededTask {
  id: string;
  title: string;
  kanban: string;
  verificationStatus: string;
  importance: string;
  urgency: string;
  subtasks: unknown[];
  blockedBy: string[];
  assignedTo: string | null;
  notes: string;
}

const tasksOf = (seed: number): SeededTask[] =>
  (generateSeedData(seed).files['tasks.json'] as { tasks: SeededTask[] }).tasks;

describe('generateSeedData determinism', () => {
  it('produces byte-identical output for the same seed', () => {
    expect(JSON.stringify(generateSeedData(42).files)).toBe(
      JSON.stringify(generateSeedData(42).files),
    );
  });

  it('produces different output for different seeds', () => {
    expect(JSON.stringify(generateSeedData(1).files)).not.toBe(
      JSON.stringify(generateSeedData(2).files),
    );
  });
});

describe('generateSeedData summary', () => {
  it('counts match the actual record counts in every file', () => {
    const { files, summary } = generateSeedData(7);
    const lengths: Record<string, number> = {
      'tasks.json': (files['tasks.json'] as { tasks: unknown[] }).tasks.length,
      'goals.json': (files['goals.json'] as { goals: unknown[] }).goals.length,
      'projects.json': (files['projects.json'] as { projects: unknown[] }).projects.length,
      'brain-dump.json': (files['brain-dump.json'] as { entries: unknown[] }).entries.length,
      'inbox.json': (files['inbox.json'] as { messages: unknown[] }).messages.length,
      'activity-log.json': (files['activity-log.json'] as { events: unknown[] }).events.length,
      'decisions.json': (files['decisions.json'] as { decisions: unknown[] }).decisions.length,
    };
    expect(summary.counts).toEqual(lengths);
    expect(summary.seed).toBe(7);
  });

  it('seeds roughly 120 tasks', () => {
    expect(tasksOf(3)).toHaveLength(120);
  });
});

describe('generateSeedData enum coverage', () => {
  const tasks = tasksOf(11);

  it('covers every kanban state including awaiting-verification', () => {
    const seen = new Set(tasks.map((t) => t.kanban));
    for (const k of ['not-started', 'in-progress', 'awaiting-verification', 'done']) {
      expect(seen).toContain(k);
    }
  });

  it('covers every verificationStatus', () => {
    const seen = new Set(tasks.map((t) => t.verificationStatus));
    for (const v of ['unverified', 'in-review', 'passed', 'failed']) {
      expect(seen).toContain(v);
    }
  });

  it('covers every Eisenhower quadrant', () => {
    const seen = new Set(tasks.map((t) => `${t.importance}/${t.urgency}`));
    expect(seen.size).toBe(4);
  });

  it('covers 0, 1 and many subtasks', () => {
    const counts = tasks.map((t) => t.subtasks.length);
    expect(counts).toContain(0);
    expect(counts).toContain(1);
    expect(Math.max(...counts)).toBeGreaterThan(5);
  });

  it('includes blockedBy chains', () => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const chained = tasks.filter((t) => t.blockedBy.length > 0);
    expect(chained.length).toBeGreaterThan(3);
    // Every dependency must resolve to a real seeded task.
    for (const t of chained) for (const dep of t.blockedBy) expect(byId.has(dep)).toBe(true);
    // At least one transitive chain A → B → C.
    const transitive = chained.some((t) =>
      t.blockedBy.some((d) => (byId.get(d)?.blockedBy.length ?? 0) > 0),
    );
    expect(transitive).toBe(true);
  });

  it('assigns every agent, and leaves some tasks unassigned', () => {
    const seen = new Set(tasks.map((t) => t.assignedTo));
    for (const a of ['me', 'researcher', 'developer', 'marketer', 'business-analyst']) {
      expect(seen).toContain(a);
    }
    expect(seen).toContain(null);
  });

  it('includes hostile titles: CJK, emoji, RTL Arabic, and one over 300 chars', () => {
    const titles = tasks.map((t) => t.title);
    expect(titles.some((t) => /[一-鿿]/.test(t))).toBe(true);
    expect(titles.some((t) => /[\u{1F300}-\u{1FAFF}]/u.test(t))).toBe(true);
    expect(titles.some((t) => /[؀-ۿ]/.test(t))).toBe(true);
    expect(titles.some((t) => t.length > 300)).toBe(true);
  });

  it('includes markdown notes and one note over 10k chars', () => {
    expect(tasks.some((t) => t.notes.includes('```'))).toBe(true);
    expect(tasks.some((t) => t.notes.length > 10_000)).toBe(true);
  });

  it('covers every activity event type', () => {
    const events = (
      generateSeedData(11).files['activity-log.json'] as { events: { type: string }[] }
    ).events;
    const seen = new Set(events.map((e) => e.type));
    for (const t of [
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
    ]) {
      expect(seen).toContain(t);
    }
  });

  it('covers every inbox message type and read state', () => {
    const messages = (
      generateSeedData(11).files['inbox.json'] as { messages: { type: string; status: string }[] }
    ).messages;
    expect(new Set(messages.map((m) => m.type)).size).toBe(5);
    const statuses = new Set(messages.map((m) => m.status));
    expect(statuses).toContain('unread');
    expect(statuses).toContain('read');
  });

  it('covers pending and answered decisions with blocksTask both ways', () => {
    const decisions = (
      generateSeedData(11).files['decisions.json'] as {
        decisions: { status: string; blocksTask: boolean }[];
      }
    ).decisions;
    expect(new Set(decisions.map((d) => d.status))).toEqual(new Set(['pending', 'answered']));
    expect(new Set(decisions.map((d) => d.blocksTask))).toEqual(new Set([true, false]));
  });

  it('covers processed and unprocessed brain dump entries', () => {
    const entries = (
      generateSeedData(11).files['brain-dump.json'] as { entries: { processed: boolean }[] }
    ).entries;
    expect(new Set(entries.map((e) => e.processed))).toEqual(new Set([true, false]));
  });

  it('gives long-term goals milestone children that point back at them', () => {
    const goals = (
      generateSeedData(11).files['goals.json'] as {
        goals: { id: string; type: string; parentGoalId: string | null; milestones: string[] }[];
      }
    ).goals;
    const parents = goals.filter((g) => g.type === 'long-term');
    const children = goals.filter((g) => g.type === 'medium-term');
    expect(parents.length).toBeGreaterThan(0);
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) expect(parents.some((p) => p.id === c.parentGoalId)).toBe(true);
    for (const p of parents)
      for (const m of p.milestones) expect(children.some((c) => c.id === m)).toBe(true);
  });
});

// ─── Manifest reconcile ─────────────────────────────────────────────────────

function fakeEnv(id: string, status: EnvStatus, pid: number | null): EnvManifest {
  return {
    id,
    taskId: null,
    productId: 'mission-control',
    worktreePath: `/tmp/.envs/${id}`,
    branch: `env/${id}`,
    baseCommit: 'abc1234',
    port: 4000,
    url: 'http://localhost:4000',
    pid,
    status,
    timings: { worktreeMs: 1, installMs: 1, seedMs: 1, bootMs: 1, healthMs: 1, totalMs: 5 },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    error: null,
    seedSummary: null,
  };
}

describe('findDeadEnvs', () => {
  const alive = (pid: number) => pid === 111;

  it('flags ready and booting envs whose pid is dead', () => {
    const envs = [fakeEnv('a', 'ready', 999), fakeEnv('b', 'booting', 999)];
    expect(findDeadEnvs(envs, alive)).toEqual(['a', 'b']);
  });

  it('leaves envs alone when their pid is alive', () => {
    expect(findDeadEnvs([fakeEnv('a', 'ready', 111)], alive)).toEqual([]);
  });

  it('flags a ready env with no pid at all', () => {
    expect(findDeadEnvs([fakeEnv('a', 'ready', null)], alive)).toEqual(['a']);
  });

  it('ignores statuses that are not supposed to have a live process', () => {
    const envs: EnvManifest[] = [
      fakeEnv('a', 'creating', null),
      fakeEnv('b', 'installing', null),
      fakeEnv('c', 'seeding', null),
      fakeEnv('d', 'failed', 999),
      fakeEnv('e', 'torn-down', 999),
    ];
    expect(findDeadEnvs(envs, alive)).toEqual([]);
  });
});
