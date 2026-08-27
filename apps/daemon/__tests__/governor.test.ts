import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../src/paths';

// Redirect the ledger + kill file into a throwaway dir: these tests must never
// touch the real quota window (or inherit state from each other).
process.env.MC_GOVERNOR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-governor-'));

import {
  type Ledger,
  type LedgerEntry,
  canSpawn,
  claimSpawn,
  coolingBackoffMs,
  decide,
  deferralFields,
  isKillSwitchActive,
  killSwitchFilePath,
  ledgerFilePath,
  pruneSpawns,
  readLedger,
  recordAvailabilityFailure,
  recordSpawn,
  recordSuccess,
  refundSpawn,
  reserveFloor,
  resolveRoleBackend,
  status,
} from '../src/engine/quota-governor';
import type { GovernorConfig, GovernorRole } from '../src/engine/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function cfg(overrides: Partial<GovernorConfig> = {}): GovernorConfig {
  return {
    enabled: true,
    windowHours: 5,
    maxSessionsPerWindow: 10,
    reservePercent: 20,
    killSwitch: false,
    roleRouting: { builder: 'claude', persona: 'claude', judge: 'claude' },
    ...overrides,
  };
}

function spawns(
  count: number,
  opts: { minutesAgo?: number; backend?: LedgerEntry['backend'] } = {},
): LedgerEntry[] {
  const minutesAgo = opts.minutesAgo ?? 1;
  return Array.from({ length: count }, (_, i) => ({
    ts: new Date(NOW - (minutesAgo + i) * 60_000).toISOString(),
    backend: opts.backend ?? 'claude',
    role: 'builder' as GovernorRole,
    ref: `task_${i}`,
  }));
}

function ledger(entries: LedgerEntry[], backends: Ledger['backends'] = {}): Ledger {
  return { spawns: entries, backends };
}

function ask(input: {
  config?: GovernorConfig;
  ledger?: Ledger;
  role?: GovernorRole;
  backend?: LedgerEntry['backend'];
  killFilePresent?: boolean;
  now?: number;
}) {
  return decide({
    config: input.config ?? cfg(),
    ledger: input.ledger ?? ledger([]),
    role: input.role ?? 'builder',
    backend: input.backend ?? 'claude',
    killFilePresent: input.killFilePresent ?? false,
    now: input.now ?? NOW,
  });
}

// ─── Pure math ───────────────────────────────────────────────────────────────

describe('reserveFloor', () => {
  it('keeps the configured share back for the human (the acceptance case)', () => {
    expect(reserveFloor(5, 20)).toBe(4);
  });

  it('floors rather than rounds, so the reserve is never undersized', () => {
    expect(reserveFloor(40, 20)).toBe(32);
    expect(reserveFloor(7, 20)).toBe(5); // 5.6 → 5
  });

  it('0% reserve gives autonomy the whole window', () => {
    expect(reserveFloor(10, 0)).toBe(10);
  });

  it('100% reserve blocks autonomy entirely', () => {
    expect(reserveFloor(10, 100)).toBe(0);
  });

  it('clamps nonsense percentages instead of going negative', () => {
    expect(reserveFloor(10, 150)).toBe(0);
    expect(reserveFloor(10, -50)).toBe(10);
  });

  // A window of N used to collapse to floor 0 for small N — every autonomous
  // spawn denied with reason "reserve" on a completely empty ledger.
  it('always leaves at least one autonomous spawn for a small window', () => {
    for (let max = 1; max <= 5; max++) {
      for (const pct of [0, 1, 10, 20, 33, 50, 75, 99]) {
        expect(reserveFloor(max, pct), `max=${max} pct=${pct}`).toBeGreaterThanOrEqual(1);
        expect(reserveFloor(max, pct), `max=${max} pct=${pct}`).toBeLessThanOrEqual(max);
      }
      // 100% is the one honest way to say "no autonomy".
      expect(reserveFloor(max, 100)).toBe(0);
    }
    expect(reserveFloor(0, 20)).toBe(0);
  });
});

describe('coolingBackoffMs', () => {
  it('doubles from one minute', () => {
    expect(coolingBackoffMs(1)).toBe(60_000);
    expect(coolingBackoffMs(2)).toBe(120_000);
    expect(coolingBackoffMs(3)).toBe(240_000);
    expect(coolingBackoffMs(4)).toBe(480_000);
  });

  it('caps at 30 minutes and stays there', () => {
    expect(coolingBackoffMs(6)).toBe(30 * 60_000);
    expect(coolingBackoffMs(50)).toBe(30 * 60_000);
  });

  it('is zero before any failure', () => {
    expect(coolingBackoffMs(0)).toBe(0);
  });
});

describe('pruneSpawns', () => {
  it('drops entries older than the window', () => {
    const entries = [
      {
        ts: new Date(NOW - 6 * HOUR).toISOString(),
        backend: 'claude' as const,
        role: 'builder' as const,
        ref: null,
      },
      {
        ts: new Date(NOW - 1 * HOUR).toISOString(),
        backend: 'claude' as const,
        role: 'builder' as const,
        ref: null,
      },
    ];
    const kept = pruneSpawns(entries, NOW, 5 * HOUR);
    expect(kept).toHaveLength(1);
    expect(kept[0].ts).toBe(entries[1].ts);
  });

  it('drops unparseable timestamps rather than trusting them', () => {
    const entries = [
      { ts: 'not-a-date', backend: 'claude' as const, role: 'builder' as const, ref: null },
    ];
    expect(pruneSpawns(entries, NOW, 5 * HOUR)).toHaveLength(0);
  });

  it('returns entries oldest-first so retry timing can read the head', () => {
    const kept = pruneSpawns(spawns(3), NOW, 5 * HOUR);
    expect(kept.map((e) => Date.parse(e.ts))).toEqual(
      [...kept.map((e) => Date.parse(e.ts))].sort((a, b) => a - b),
    );
  });
});

// ─── Denial reasons ──────────────────────────────────────────────────────────

describe('decide', () => {
  it('allows a spawn in a fresh window', () => {
    expect(ask({})).toEqual({ allowed: true, backend: 'claude' });
  });

  it('denies with reason reserve once autonomy hits the floor', () => {
    const d = ask({ config: cfg({ maxSessionsPerWindow: 5 }), ledger: ledger(spawns(4)) });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('reserve');
    expect(d.retryInMs).toBeGreaterThan(0);
  });

  it('denies with reason window-exhausted when even the reserve is gone', () => {
    const d = ask({ config: cfg({ maxSessionsPerWindow: 5 }), ledger: ledger(spawns(5)) });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('window-exhausted');
  });

  it('still allows the last spawn below the floor (off-by-one guard)', () => {
    const d = ask({ config: cfg({ maxSessionsPerWindow: 5 }), ledger: ledger(spawns(3)) });
    expect(d.allowed).toBe(true);
  });

  it('retryInMs is when enough entries expire, not a fixed guess', () => {
    // max 6, floor 4, five in-window entries: the oldest TWO must expire before
    // autonomy is back under the floor, so the retry hint is the second-oldest.
    const entries = spawns(5, { minutesAgo: 10 });
    const d = ask({ config: cfg({ maxSessionsPerWindow: 6 }), ledger: ledger(entries), now: NOW });
    if (d.allowed) throw new Error('expected a denial');
    const oldestTwo = pruneSpawns(entries, NOW, 5 * HOUR).slice(0, 2);
    expect(d.retryInMs).toBe(Date.parse(oldestTwo[1].ts) + 5 * HOUR - NOW);
  });

  it('ignores expired entries when counting the window', () => {
    const stale = spawns(9, { minutesAgo: 6 * 60 });
    expect(ask({ config: cfg({ maxSessionsPerWindow: 5 }), ledger: ledger(stale) }).allowed).toBe(
      true,
    );
  });

  it('does not charge non-claude spawns to the claude window', () => {
    const d = ask({
      config: cfg({ maxSessionsPerWindow: 5 }),
      ledger: ledger(spawns(5)),
      backend: 'gemini',
    });
    expect(d).toEqual({ allowed: true, backend: 'gemini' });
  });

  it('does not count non-claude entries towards the claude window', () => {
    const d = ask({
      config: cfg({ maxSessionsPerWindow: 5 }),
      ledger: ledger(spawns(5, { backend: 'codex' })),
    });
    expect(d.allowed).toBe(true);
  });

  it('denies with reason backend-cooling while a backend is in backoff', () => {
    const coolingUntil = new Date(NOW + 90_000).toISOString();
    const d = ask({ ledger: ledger([], { claude: { failures: 2, coolingUntil } }) });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('backend-cooling');
    expect(d.retryInMs).toBe(90_000);
  });

  it('cooling applies to non-claude backends too', () => {
    const coolingUntil = new Date(NOW + 60_000).toISOString();
    const d = ask({
      backend: 'gemini',
      ledger: ledger([], { gemini: { failures: 1, coolingUntil } }),
    });
    expect(d.allowed).toBe(false);
  });

  it('lets a backend through once its cooling window has passed', () => {
    const coolingUntil = new Date(NOW - 1000).toISOString();
    expect(ask({ ledger: ledger([], { claude: { failures: 3, coolingUntil } }) }).allowed).toBe(
      true,
    );
  });

  it('kill switch from config beats everything, including an empty window', () => {
    const d = ask({ config: cfg({ killSwitch: true }) });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('kill-switch');
  });

  it('kill switch from the file alone is enough (OR, not AND)', () => {
    const d = ask({ killFilePresent: true });
    if (d.allowed) throw new Error('expected a denial');
    expect(d.reason).toBe('kill-switch');
  });

  it('kill switch wins even when gating is disabled', () => {
    const d = ask({ config: cfg({ enabled: false }), killFilePresent: true });
    if (d.allowed) throw new Error('expected a denial');
    expect(d.reason).toBe('kill-switch');
  });

  it('disabled governor stops gating on the window', () => {
    const d = ask({
      config: cfg({ enabled: false, maxSessionsPerWindow: 5 }),
      ledger: ledger(spawns(50)),
    });
    expect(d.allowed).toBe(true);
  });

  it('blocks every autonomous role at the floor, not just builders', () => {
    for (const role of ['builder', 'persona', 'judge', 'scheduled'] as const) {
      const d = ask({ role, config: cfg({ maxSessionsPerWindow: 5 }), ledger: ledger(spawns(4)) });
      expect(d.allowed, role).toBe(false);
    }
  });
});

// ─── Role routing ────────────────────────────────────────────────────────────

describe('roleRouting resolution', () => {
  it('routes each role from the config, defaulting scheduled to claude', () => {
    const routing = cfg({
      roleRouting: { builder: 'claude', persona: 'gemini', judge: 'codex' },
    }).roleRouting;
    const resolve = (role: GovernorRole) => routing[role] ?? 'claude';
    expect(resolve('builder')).toBe('claude');
    expect(resolve('persona')).toBe('gemini');
    expect(resolve('judge')).toBe('codex');
    expect(resolve('scheduled')).toBe('claude');
  });

  it('resolveRoleBackend reads the live config for all four roles', () => {
    for (const role of ['builder', 'persona', 'judge', 'scheduled'] as const) {
      expect(['claude', 'codex', 'gemini']).toContain(resolveRoleBackend(role));
    }
  });

  it("a routed spawn is judged against its own backend's quota", () => {
    const full = ledger(spawns(5));
    expect(
      ask({
        role: 'persona',
        backend: 'gemini',
        config: cfg({ maxSessionsPerWindow: 5 }),
        ledger: full,
      }).allowed,
    ).toBe(true);
    expect(
      ask({
        role: 'persona',
        backend: 'claude',
        config: cfg({ maxSessionsPerWindow: 5 }),
        ledger: full,
      }).allowed,
    ).toBe(false);
  });
});

// ─── Ledger file behaviour ───────────────────────────────────────────────────

describe('ledger file', () => {
  const LEDGER = ledgerFilePath();
  const KILL = killSwitchFilePath();

  beforeEach(() => {
    rmSync(LEDGER, { force: true });
    rmSync(KILL, { force: true });
  });

  it('records one entry per spawn', () => {
    recordSpawn('builder', 'task_1', 'claude');
    recordSpawn('persona', 'vrun_1/naive-user-1', 'claude');
    const entries = readLedger().spawns;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.role)).toEqual(['builder', 'persona']);
    expect(entries[0].ref).toBe('task_1');
  });

  it('concurrent recordSpawn calls do not lose entries', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        Promise.resolve().then(() => recordSpawn('builder', `task_${i}`, 'claude')),
      ),
    );
    const refs = readLedger().spawns.map((e) => e.ref);
    expect(refs).toHaveLength(12);
    expect(new Set(refs).size).toBe(12);
  });

  it('prunes out-of-window entries on write', () => {
    const stale: LedgerEntry = {
      ts: new Date(Date.now() - 100 * HOUR).toISOString(),
      backend: 'claude',
      role: 'builder',
      ref: 'ancient',
    };
    writeFileSync(LEDGER, JSON.stringify({ spawns: [stale], backends: {} }), 'utf-8');
    recordSpawn('builder', 'fresh', 'claude');
    expect(readLedger().spawns.map((e) => e.ref)).toEqual(['fresh']);
  });

  it('treats a corrupt ledger as an empty window instead of throwing', () => {
    writeFileSync(LEDGER, '{ not json', 'utf-8');
    expect(readLedger().spawns).toEqual([]);
    expect(canSpawn('builder').allowed).toBe(true);
  });

  it('two empty reads do not share state (a mutation must not leak)', () => {
    const first = readLedger();
    first.backends.claude = {
      failures: 9,
      coolingUntil: new Date(Date.now() + HOUR).toISOString(),
    };
    first.spawns.push({
      ts: new Date().toISOString(),
      backend: 'claude',
      role: 'builder',
      ref: 'ghost',
    });
    expect(readLedger()).toEqual({ spawns: [], backends: {} });
    expect(canSpawn('builder').allowed).toBe(true);
  });

  it('availability failures cool the backend with a doubling backoff', () => {
    recordAvailabilityFailure('claude');
    const first = readLedger().backends.claude!;
    expect(first.failures).toBe(1);
    const firstDelay = Date.parse(first.coolingUntil!) - Date.now();
    expect(firstDelay).toBeGreaterThan(50_000);
    expect(firstDelay).toBeLessThanOrEqual(60_000);

    recordAvailabilityFailure('claude');
    const second = readLedger().backends.claude!;
    expect(second.failures).toBe(2);
    expect(Date.parse(second.coolingUntil!) - Date.now()).toBeGreaterThan(110_000);

    const decision = canSpawn('builder', 'claude');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('backend-cooling');
  });

  it('a success resets the backoff', () => {
    recordAvailabilityFailure('claude');
    recordSuccess('claude');
    expect(readLedger().backends.claude).toEqual({ failures: 0, coolingUntil: null });
    expect(status().backends.claude).toEqual({ state: 'ready', coolingUntil: null });
  });

  it('the kill file alone stops canSpawn', () => {
    expect(isKillSwitchActive()).toBe(false);
    writeFileSync(KILL, '', 'utf-8');
    expect(isKillSwitchActive()).toBe(true);
    const decision = canSpawn('builder');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('kill-switch');
    expect(status().killSwitch).toBe(true);
  });

  it('status() counts only claude sessions and reports the autonomy gap', () => {
    recordSpawn('builder', 'task_1', 'claude');
    recordSpawn('builder', 'task_2', 'gemini'); // not the scarce resource
    const s = status();
    expect(s.used).toBe(1);
    expect(s.reserveFloor).toBeLessThan(s.max);
    expect(s.remainingForAutonomy).toBe(Math.max(0, s.reserveFloor - 1));
  });
});

// ─── Atomic claim ────────────────────────────────────────────────────────────

/**
 * canSpawn() + recordSpawn() is check-then-act. Two processes could both read
 * `used === floor - 1`, both be allowed and both spawn — the governor's whole
 * purpose defeated by a race it could not see. claimSpawn decides and books
 * inside one lock.
 */
describe('claimSpawn', () => {
  const LEDGER = ledgerFilePath();
  const KILL = killSwitchFilePath();

  beforeEach(() => {
    rmSync(LEDGER, { force: true });
    rmSync(KILL, { force: true });
  });

  it('books the slot it allows, in the same operation', () => {
    const decision = claimSpawn('builder', { backend: 'claude', ref: 'task_claim' });
    expect(decision.allowed).toBe(true);
    expect(readLedger().spawns.map((e) => e.ref)).toEqual(['task_claim']);
  });

  it('books nothing when it denies — a denial stays free', () => {
    writeFileSync(KILL, '', 'utf-8');
    const decision = claimSpawn('builder', { backend: 'claude', ref: 'task_denied' });
    expect(decision.allowed).toBe(false);
    expect(readLedger().spawns).toHaveLength(0);
  });

  it('never lets concurrent claimers exceed the floor', async () => {
    const floor = status().reserveFloor;
    const attempts = floor + 8;

    const decisions = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        Promise.resolve().then(() =>
          claimSpawn('builder', { backend: 'claude', ref: `task_${i}` }),
        ),
      ),
    );

    const allowed = decisions.filter((d) => d.allowed).length;
    expect(allowed).toBe(floor);
    // Every allowed claim is in the ledger, and nothing else is.
    expect(readLedger().spawns).toHaveLength(floor);
  });
});

/**
 * refundSpawn undoes a claimSpawn() booking that never became a real spawn —
 * dispatcher.ts's dispatchTask calls it when it fails before reaching the
 * actual process spawn, so that claim does not sit in the ledger burning a
 * window slot for work that never ran.
 */
describe('refundSpawn', () => {
  const LEDGER = ledgerFilePath();
  const KILL = killSwitchFilePath();

  beforeEach(() => {
    rmSync(LEDGER, { force: true });
    rmSync(KILL, { force: true });
  });

  it('removes the entry a matching claimSpawn booked', () => {
    claimSpawn('builder', { backend: 'claude', ref: 'task_refund' });
    expect(readLedger().spawns.map((e) => e.ref)).toEqual(['task_refund']);

    refundSpawn('builder', 'task_refund', 'claude');

    expect(readLedger().spawns).toHaveLength(0);
  });

  it('only removes the most recent match, leaving an earlier genuine spawn under the same ref alone', () => {
    claimSpawn('builder', { backend: 'claude', ref: 'task_retry' });
    claimSpawn('builder', { backend: 'claude', ref: 'task_retry' });
    expect(readLedger().spawns).toHaveLength(2);

    refundSpawn('builder', 'task_retry', 'claude');

    expect(readLedger().spawns).toHaveLength(1);
  });

  it('is a no-op when nothing matches', () => {
    claimSpawn('builder', { backend: 'claude', ref: 'task_other' });
    refundSpawn('builder', 'task_nonexistent', 'claude');
    expect(readLedger().spawns).toHaveLength(1);
  });
});

// ─── Dispatcher deferral in flight ───────────────────────────────────────────

/**
 * The dispatcher's deferral branch, exercised with a stubbed spawn: the first
 * attempt is allowed and fails for availability, and every fallback backend is
 * already cooling, so the governor denies the chain. That was gated, not broken —
 * the task goes back to not-started with no retry queued and no failure recorded.
 *
 * Deliberately NOT driven by a stub exiting 3: this path spawns the raw CLI,
 * which has no such convention, so the dispatcher must not read a deferral out
 * of a child's exit code.
 */
describe('dispatcher deferral in flight', () => {
  const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
  const RETRY_FILE = path.join(DATA_DIR, 'daemon-retry-queue.json');
  const STATUS_FILE = path.join(DATA_DIR, 'daemon-status.json');
  const LEDGER = ledgerFilePath();
  const tasksBackup = `${TASKS_FILE}.testbackup`;
  const retryBackup = `${RETRY_FILE}.testbackup`;
  const statusBackup = `${STATUS_FILE}.testbackup`;
  const TASK_ID = 'task_governor_defer_test';

  beforeEach(() => {
    renameSync(TASKS_FILE, tasksBackup);
    if (existsSync(RETRY_FILE)) renameSync(RETRY_FILE, retryBackup);
    // A real HealthMonitor writes the live daemon status file, and a real
    // Dispatcher prunes run-outputs. Neither may touch real state.
    if (existsSync(STATUS_FILE)) renameSync(STATUS_FILE, statusBackup);
    process.env.MC_RUN_OUTPUTS_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-run-outputs-'));
    rmSync(LEDGER, { force: true });
    writeFileSync(
      TASKS_FILE,
      JSON.stringify({
        tasks: [
          {
            id: TASK_ID,
            title: 'deferral probe',
            description: '',
            importance: 'important',
            urgency: 'urgent',
            kanban: 'not-started',
            projectId: null,
            milestoneId: null,
            assignedTo: 'developer',
            collaborators: [],
            dailyActions: [],
            subtasks: [],
            blockedBy: [],
            estimatedMinutes: null,
            actualMinutes: null,
            acceptanceCriteria: [],
            tags: [],
            notes: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null,
          },
        ],
      }),
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(TASKS_FILE, { force: true });
    renameSync(tasksBackup, TASKS_FILE);
    rmSync(RETRY_FILE, { force: true });
    if (existsSync(retryBackup)) renameSync(retryBackup, RETRY_FILE);
    rmSync(STATUS_FILE, { force: true });
    if (existsSync(statusBackup)) renameSync(statusBackup, STATUS_FILE);
    rmSync(process.env.MC_RUN_OUTPUTS_DIR!, { recursive: true, force: true });
    delete process.env.MC_RUN_OUTPUTS_DIR;
    rmSync(LEDGER, { force: true });
  });

  it('leaves the task queued, unfailed and unretried', async () => {
    const { Dispatcher } = await import('../src/engine/dispatcher');
    const { HealthMonitor } = await import('../src/engine/health');
    const { AgentRunner } = await import('../src/engine/runner');
    const { loadConfig } = await import('../src/engine/config');

    // Every fallback target is cooling, so the in-flight gate has nowhere to go.
    recordAvailabilityFailure('gemini');
    recordAvailabilityFailure('codex');

    const health = new HealthMonitor();
    const failuresBefore = health.getStatus().stats.tasksFailed;
    const stubRunner = {
      spawnAgent: async () => ({
        pid: 4242,
        exitCode: 1,
        stdout: '',
        stderr: 'rate limit exceeded (429)',
        timedOut: false,
      }),
    } as unknown as InstanceType<typeof AgentRunner>;

    const dispatcher = new Dispatcher(loadConfig(), stubRunner, health);
    await dispatcher.pollAndDispatch();
    // dispatchTask is deliberately fire-and-forget; give the stub a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const tasks = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as {
      tasks: Array<{ id: string; kanban: string }>;
    };
    expect(tasks.tasks.find((t) => t.id === TASK_ID)?.kanban).toBe('not-started');
    expect(health.getRetryCount(TASK_ID)).toBe(0);
    expect(health.getStatus().stats.tasksFailed).toBe(failuresBefore);
    expect(existsSync(RETRY_FILE)).toBe(false);
    // The gate booked the spawn it allowed — the ledger is not silent about it.
    expect(readLedger().spawns.map((e) => e.ref)).toContain(TASK_ID);
  });

  it('treats a CLI that exits 3 as a failure, not as a deferral', async () => {
    const { Dispatcher } = await import('../src/engine/dispatcher');
    const { HealthMonitor } = await import('../src/engine/health');
    const { AgentRunner } = await import('../src/engine/runner');
    const { loadConfig } = await import('../src/engine/config');

    const health = new HealthMonitor();
    const failuresBefore = health.getStatus().stats.tasksFailed;
    // claude/codex/gemini have no exit-3 convention. Swallowing this as a
    // deferral hid usage and auth errors: no failure, no retry, no report.
    const stubRunner = {
      spawnAgent: async () => ({ pid: 4242, exitCode: 3, stdout: '', stderr: '', timedOut: false }),
    } as unknown as InstanceType<typeof AgentRunner>;

    const dispatcher = new Dispatcher(loadConfig(), stubRunner, health);
    await dispatcher.pollAndDispatch();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // A deferral records neither of these; a failure must record both.
    expect(health.getStatus().stats.tasksFailed).toBe(failuresBefore + 1);
    expect(health.getRetryCount(TASK_ID)).toBe(1);
  });
});

// ─── What a denial means to the run that got it ──────────────────────────────

describe('deferralFields', () => {
  const NOW_ISO = '2026-08-11T14:00:00.000Z';
  const NOW_MS = Date.parse(NOW_ISO);

  it("turns the governor's own retry estimate into a time the card can show", () => {
    expect(
      deferralFields({ reason: 'window-exhausted', retryInMs: 30 * 60 * 1000 }, NOW_MS),
    ).toEqual({
      causeKind: 'rate-limit',
      resumesAt: '2026-08-11T14:30:00.000Z',
    });
    expect(deferralFields({ reason: 'reserve', retryInMs: 60_000 }, NOW_MS).resumesAt).toBe(
      '2026-08-11T14:01:00.000Z',
    );
    expect(deferralFields({ reason: 'backend-cooling', retryInMs: 0 }, NOW_MS).resumesAt).toBe(
      NOW_ISO,
    );
  });

  it('promises no resume time for a kill switch — that one waits on a human', () => {
    expect(deferralFields({ reason: 'kill-switch', retryInMs: 60_000 }, NOW_MS)).toEqual({
      causeKind: 'rate-limit',
    });
  });

  it('never invents a time in the past from a negative estimate', () => {
    expect(deferralFields({ reason: 'reserve', retryInMs: -5000 }, NOW_MS).resumesAt).toBe(NOW_ISO);
  });
});
