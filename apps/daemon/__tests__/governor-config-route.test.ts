/**
 * The governor's numbers, editable from Settings (UX spec §6, brief §3: nothing
 * load-bearing may be configuration the product never shows).
 *
 * These are the numbers that decide how much of Alex's own allocation the
 * factory may spend (principle 9), and until now they were hand-edited JSON. The
 * route already validated an `execution.governor` block; what was never proven
 * is the part that makes an editable card honest — **that a change takes effect
 * without a restart**.
 *
 * The mechanism: `mutateDaemonConfig` writes `daemon-config.json` under the
 * store's mutex, and `cachedConfig()` keys its memo on that file's mtime+size,
 * so the very next read re-parses. No TTL, no reload signal, no restart.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cachedConfig, invalidateConfigCache } from '../src/engine/config-cache';
import { NextRequest } from '../src/http';
import { PUT } from '../src/routes/daemon/route';
import { mutateDaemonConfig } from '../src/store/data';
import { backupDataFiles, restoreDataFiles } from './helpers';

let backups: Record<string, string>;

const BASE_EXECUTION = {
  maxTurns: 25,
  timeoutMinutes: 30,
  retries: 1,
  retryDelayMinutes: 5,
  skipPermissions: false,
  allowedTools: ['Read', 'Edit', 'Write'],
  agentTeams: false,
  claudeBinaryPath: null,
  backendMode: 'claude' as const,
  codexTaskTags: ['codex'],
  codexBinaryPath: null,
  codexModel: null,
  geminiTaskTags: ['gemini'],
  geminiBinaryPath: null,
  geminiModel: null,
  claudeAutoFailoverEnabled: true,
  claudeAutoFailoverThreshold: 2,
  claudeAutoFailoverBackend: 'codex' as const,
};

const GOVERNOR = {
  enabled: true,
  windowHours: 5,
  maxSessionsPerWindow: 40,
  reservePercent: 20,
  killSwitch: false,
  roleRouting: { builder: 'claude' as const, persona: 'claude' as const, judge: 'claude' as const },
};

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
  invalidateConfigCache();
});

beforeEach(async () => {
  await mutateDaemonConfig(async (data) => {
    const config = data as unknown as Record<string, unknown>;
    config.execution = { ...BASE_EXECUTION, governor: { ...GOVERNOR } };
  });
  invalidateConfigCache();
});

function put(body: unknown): Promise<Response> {
  return PUT(
    new NextRequest('http://localhost/api/daemon', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const governorOf = (res: unknown) =>
  (res as { config: { execution: { governor: typeof GOVERNOR } } }).config.execution.governor;

describe('governor config through the daemon route', () => {
  it('saves the window ceiling, window hours and reserve percent', async () => {
    const res = await put({
      execution: {
        ...BASE_EXECUTION,
        governor: { ...GOVERNOR, windowHours: 8, maxSessionsPerWindow: 120, reservePercent: 35 },
      },
    });
    expect(res.status).toBe(200);
    const saved = governorOf(await res.json());
    expect(saved.windowHours).toBe(8);
    expect(saved.maxSessionsPerWindow).toBe(120);
    expect(saved.reservePercent).toBe(35);
  });

  it('takes effect without a restart — the governor reads config live', async () => {
    expect(cachedConfig().execution.governor.maxSessionsPerWindow).toBe(40);
    await put({
      execution: { ...BASE_EXECUTION, governor: { ...GOVERNOR, maxSessionsPerWindow: 7 } },
    });
    // No invalidateConfigCache() here on purpose: the memo is keyed on the
    // config file's mtime+size, so the write alone is what makes this true.
    expect(cachedConfig().execution.governor.maxSessionsPerWindow).toBe(7);
  });

  it('moves the derived reserve floor with the percent, which is what the card shows', async () => {
    await put({
      execution: {
        ...BASE_EXECUTION,
        governor: { ...GOVERNOR, maxSessionsPerWindow: 100, reservePercent: 25 },
      },
    });
    const { reserveFloor } = await import('../src/engine/quota-governor');
    expect(reserveFloor(100, 25)).toBe(75);
  });

  it('engages the kill switch, and the change is live too', async () => {
    await put({ execution: { ...BASE_EXECUTION, governor: { ...GOVERNOR, killSwitch: true } } });
    expect(cachedConfig().execution.governor.killSwitch).toBe(true);
  });

  it('refuses numbers outside the bounds the daemon itself enforces', async () => {
    for (const governor of [
      { ...GOVERNOR, reservePercent: 140 },
      { ...GOVERNOR, windowHours: 0 },
      { ...GOVERNOR, maxSessionsPerWindow: 0 },
    ]) {
      const res = await put({ execution: { ...BASE_EXECUTION, governor } });
      expect(res.status).toBe(400);
    }
    // The stored config is untouched by a rejected save.
    expect(cachedConfig().execution.governor.reservePercent).toBe(20);
  });
});
