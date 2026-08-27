import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * Phase 2 governor: the "human" role, and what a spawn cost.
 *
 * The decision table below is the whole point of the role. The reserve exists to
 * hold sessions back FOR Alex, so denying Alex's own question in order to
 * protect Alex's headroom would be the governor defeating its own purpose — but
 * the ceiling is the subscription itself, and nobody votes past that.
 */
import { beforeEach, describe, expect, it } from 'vitest';

// Throwaway ledger dir, set before the module reads it. These tests must never
// touch the real quota window.
process.env.MC_GOVERNOR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-governor-phase2-'));

import {
  type Ledger,
  type LedgerEntry,
  decide,
  ledgerFilePath,
  readLedger,
  recordSpawn,
  recordSpawnOutcome,
} from './quota-governor';
import type { GovernorConfig } from './types';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');

function cfg(overrides: Partial<GovernorConfig> = {}): GovernorConfig {
  return {
    enabled: true,
    windowHours: 5,
    maxSessionsPerWindow: 10,
    // floor = 10 * (1 - 0.2) = 8. Autonomous roles stop at 8; the ceiling is 10.
    reservePercent: 20,
    killSwitch: false,
    roleRouting: { builder: 'claude', persona: 'claude', judge: 'claude' },
    ...overrides,
  };
}

/** `n` claude spawns inside the window, oldest first. */
function ledgerWith(n: number): Ledger {
  return {
    spawns: Array.from({ length: n }, (_, i) => ({
      ts: new Date(NOW - (n - i) * 60_000).toISOString(),
      backend: 'claude' as const,
      role: 'builder' as const,
      ref: `task_${i}`,
    })),
    backends: {},
  };
}

const at = (used: number, role: 'builder' | 'human', config = cfg()) =>
  decide({
    config,
    ledger: ledgerWith(used),
    role,
    backend: 'claude',
    killFilePresent: false,
    now: NOW,
  });

describe("the human role's decision table", () => {
  it('below the floor: both allowed', () => {
    expect(at(3, 'builder').allowed).toBe(true);
    expect(at(3, 'human').allowed).toBe(true);
  });

  it('AT the reserve floor: the builder is denied, the human is not', () => {
    // The one row that matters. 8 of 10 used — the daemon's share is spent, and
    // the two left are the reserve, which is the human's.
    const builder = at(8, 'builder');
    expect(builder.allowed).toBe(false);
    expect(builder.allowed === false && builder.reason).toBe('reserve');
    expect(at(8, 'human').allowed).toBe(true);
  });

  it('between the floor and the ceiling: still builder-denied, human-allowed', () => {
    expect(at(9, 'builder').allowed).toBe(false);
    expect(at(9, 'human').allowed).toBe(true);
  });

  it('AT the absolute ceiling: both denied', () => {
    const human = at(10, 'human');
    expect(at(10, 'builder').allowed).toBe(false);
    expect(human.allowed).toBe(false);
    expect(human.allowed === false && human.reason).toBe('window-exhausted');
  });

  it('past the ceiling: both denied, and the human gets a real retry time', () => {
    const human = at(14, 'human');
    expect(at(14, 'builder').allowed).toBe(false);
    expect(human.allowed).toBe(false);
    // A slot comes back when the oldest in-window spawn ages out, not "never".
    expect(human.allowed === false && human.retryInMs).toBeGreaterThan(0);
  });

  it('the kill switch denies both — a stop is a stop', () => {
    const killed = cfg({ killSwitch: true });
    expect(at(0, 'builder', killed).allowed).toBe(false);
    const human = at(0, 'human', killed);
    expect(human.allowed).toBe(false);
    expect(human.allowed === false && human.reason).toBe('kill-switch');
  });

  it('the kill FILE denies the human too, even on an empty window', () => {
    const decision = decide({
      config: cfg(),
      ledger: ledgerWith(0),
      role: 'human',
      backend: 'claude',
      killFilePresent: true,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe('kill-switch');
  });

  it('a 100% reserve still leaves the human the whole window', () => {
    // reservePercent 100 is an explicit "no autonomy" — floor 0, so the builder
    // is denied on an EMPTY window. The human is not: every session is theirs.
    const noAutonomy = cfg({ reservePercent: 100 });
    expect(at(0, 'builder', noAutonomy).allowed).toBe(false);
    expect(at(0, 'human', noAutonomy).allowed).toBe(true);
    expect(at(10, 'human', noAutonomy).allowed).toBe(false);
  });

  it('does not wait out a cooling backend the way an autonomous retry loop must', () => {
    const cooling: Ledger = {
      spawns: [],
      backends: { claude: { failures: 2, coolingUntil: new Date(NOW + 5 * 60_000).toISOString() } },
    };
    const input = {
      config: cfg(),
      ledger: cooling,
      backend: 'claude' as const,
      killFilePresent: false,
      now: NOW,
    };
    const builder = decide({ ...input, role: 'builder' });
    expect(builder.allowed).toBe(false);
    expect(builder.allowed === false && builder.reason).toBe('backend-cooling');
    // Cooling is a backoff for machines retrying in a loop. One person sending
    // one message is neither, and making them sit out a five-minute backoff
    // would be the governor managing the human instead of the daemon.
    expect(decide({ ...input, role: 'human' }).allowed).toBe(true);
  });

  it('a non-claude backend is not window-limited for the human either', () => {
    expect(
      decide({
        config: cfg(),
        ledger: ledgerWith(50),
        role: 'human',
        backend: 'gemini',
        killFilePresent: false,
        now: NOW,
      }).allowed,
    ).toBe(true);
  });
});

// ─── recordSpawnOutcome ──────────────────────────────────────────────────────

describe('recordSpawnOutcome', () => {
  beforeEach(() => {
    writeFileSync(ledgerFilePath(), JSON.stringify({ spawns: [], backends: {} }), 'utf-8');
  });

  const find = (ref: string): LedgerEntry | undefined =>
    readLedger().spawns.find((s) => s.ref === ref);

  it('annotates the entry the spawn booked', () => {
    recordSpawn('builder', 'task_a', 'claude');
    recordSpawnOutcome('builder', 'task_a', 'claude', {
      durationMs: 4210,
      tokensIn: 6120,
      tokensOut: 340,
    });

    const entry = find('task_a');
    expect(entry?.durationMs).toBe(4210);
    expect(entry?.tokensIn).toBe(6120);
    expect(entry?.tokensOut).toBe(340);
  });

  it("stores nulls when the backend's envelope carried no usage", () => {
    recordSpawn('builder', 'task_b', 'claude');
    recordSpawnOutcome('builder', 'task_b', 'claude', {
      durationMs: 900,
      tokensIn: null,
      tokensOut: null,
    });

    const entry = find('task_b');
    expect(entry?.durationMs).toBe(900);
    // Null, not 0. "The backend didn't say" and "it used no tokens" are
    // different facts, and only one of them is true.
    expect(entry?.tokensIn).toBeNull();
    expect(entry?.tokensOut).toBeNull();
  });

  it('leaves a field absent when nothing measured it', () => {
    recordSpawn('builder', 'task_c', 'claude');
    recordSpawnOutcome('builder', 'task_c', 'claude', { tokensIn: 5, tokensOut: 5 });
    expect(find('task_c')).not.toHaveProperty('durationMs');
  });

  it("annotates the MOST RECENT match, leaving an earlier attempt's numbers alone", () => {
    // A task retried on the same backend books twice. The second annotation must
    // describe the second attempt, or the first attempt's cost gets overwritten
    // by the retry's and the window's history stops adding up.
    recordSpawn('builder', 'task_d', 'claude');
    recordSpawnOutcome('builder', 'task_d', 'claude', {
      durationMs: 100,
      tokensIn: 1,
      tokensOut: 1,
    });
    recordSpawn('builder', 'task_d', 'claude');
    recordSpawnOutcome('builder', 'task_d', 'claude', {
      durationMs: 200,
      tokensIn: 2,
      tokensOut: 2,
    });

    const entries = readLedger().spawns.filter((s) => s.ref === 'task_d');
    expect(entries).toHaveLength(2);
    expect(entries[0].durationMs).toBe(100);
    expect(entries[1].durationMs).toBe(200);
  });

  it('does not annotate a different role, ref or backend', () => {
    recordSpawn('builder', 'task_e', 'claude');
    recordSpawnOutcome('judge', 'task_e', 'claude', { durationMs: 1 });
    recordSpawnOutcome('builder', 'task_other', 'claude', { durationMs: 2 });
    recordSpawnOutcome('builder', 'task_e', 'codex', { durationMs: 3 });
    expect(find('task_e')).not.toHaveProperty('durationMs');
  });

  it('is a no-op when the entry has already aged out — never a throw', () => {
    expect(() =>
      recordSpawnOutcome('builder', 'task_gone', 'claude', { durationMs: 5 }),
    ).not.toThrow();
  });

  it("records a human spawn's cost like any other", () => {
    recordSpawn('human', 'talk_1', 'claude');
    recordSpawnOutcome('human', 'talk_1', 'claude', {
      durationMs: 1200,
      tokensIn: 90,
      tokensOut: 40,
    });
    // Exempt from the reserve, NOT invisible: a human turn still spends the
    // window, and a gauge that hid it would under-report what is left.
    expect(find('talk_1')?.tokensIn).toBe(90);
  });
});

// ─── Migration tolerance ─────────────────────────────────────────────────────

describe('a pre-Phase-2 ledger', () => {
  it('loads entries that have no duration or token fields', () => {
    writeFileSync(
      ledgerFilePath(),
      JSON.stringify({
        spawns: [
          { ts: new Date(NOW).toISOString(), backend: 'claude', role: 'builder', ref: 'task_old' },
          { ts: new Date(NOW).toISOString(), backend: 'codex', role: 'judge', ref: null },
        ],
        backends: { claude: { failures: 0, coolingUntil: null } },
      }),
      'utf-8',
    );

    const ledger = readLedger();
    expect(ledger.spawns).toHaveLength(2);
    expect(ledger.spawns[0].durationMs).toBeUndefined();
    expect(ledger.spawns[0].tokensIn).toBeUndefined();
    // And it still decides against them — the window arithmetic never read
    // these fields, so an old ledger governs exactly as it always did.
    expect(
      decide({
        config: cfg(),
        ledger,
        role: 'builder',
        backend: 'claude',
        killFilePresent: false,
        now: NOW,
      }).allowed,
    ).toBe(true);
  });

  it('annotates an old un-annotated entry in place', () => {
    // Written at the REAL now, not the frozen NOW the decision tests use:
    // `recordSpawnOutcome` prunes the window against `Date.now()` on its way
    // out, so a fixture pinned to a fixed date silently ages out of the window
    // and the assertion below starts failing on a wall clock, not on a change.
    writeFileSync(
      ledgerFilePath(),
      JSON.stringify({
        spawns: [
          { ts: new Date().toISOString(), backend: 'claude', role: 'builder', ref: 'task_legacy' },
        ],
        backends: {},
      }),
      'utf-8',
    );
    recordSpawnOutcome('builder', 'task_legacy', 'claude', {
      durationMs: 77,
      tokensIn: null,
      tokensOut: null,
    });
    expect(readLedger().spawns.find((s) => s.ref === 'task_legacy')?.durationMs).toBe(77);
  });
});
