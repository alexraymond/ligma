import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from '../src/http';
import { PUT } from '../src/routes/daemon/route';
import { mutateDaemonConfig } from '../src/store/data';
import { backupDataFiles, restoreDataFiles } from './helpers';

// Regression for: saving Autopilot settings silently deletes the governor and
// harness config. A partial PUT to /api/daemon that only touches core
// execution fields (maxTurns, timeoutMinutes, ...) must not wipe out
// execution.harness / execution.governor when the caller didn't send them.

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
  killSwitch: true, // the human hit the kill switch — this must never come back false on its own
  roleRouting: { builder: 'claude', persona: 'claude', judge: 'claude' },
};

const HARNESS = {
  autoVerify: true,
  maxParallelPersonas: 2,
  naiveUserRuns: 3,
  judgeModel: 'opus-regression-marker',
};

beforeAll(async () => {
  backups = await backupDataFiles();
});

afterAll(async () => {
  await restoreDataFiles(backups);
});

beforeEach(async () => {
  await mutateDaemonConfig(async (data) => {
    data.polling = { enabled: true, intervalMinutes: 5 };
    data.concurrency = { maxParallelAgents: 3 };
    data.schedule = {};
    data.execution = { ...BASE_EXECUTION, harness: HARNESS, governor: GOVERNOR };
  });
});

function putRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/daemon', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/daemon — execution merge', () => {
  it('preserves execution.governor.killSwitch and execution.harness on a partial execution update', async () => {
    const res = await PUT(
      putRequest({
        execution: { ...BASE_EXECUTION, timeoutMinutes: 45 }, // no harness/governor sent
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: {
        execution: { timeoutMinutes: number; governor: { killSwitch: boolean }; harness: unknown };
      };
    };

    expect(body.config.execution.timeoutMinutes).toBe(45); // the field actually being changed took effect
    expect(body.config.execution.governor.killSwitch).toBe(true); // survived
    expect(body.config.execution.harness).toEqual(HARNESS); // survived
  });

  it('still lets an explicit governor update through', async () => {
    const res = await PUT(
      putRequest({
        execution: { ...BASE_EXECUTION, governor: { ...GOVERNOR, killSwitch: false } },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: {
        execution: { timeoutMinutes: number; governor: { killSwitch: boolean }; harness: unknown };
      };
    };
    expect(body.config.execution.governor.killSwitch).toBe(false);
    expect(body.config.execution.harness).toEqual(HARNESS); // unrelated block still untouched
  });
});
