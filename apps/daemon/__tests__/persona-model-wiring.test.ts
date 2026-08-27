/**
 * Persona spawns must carry harness.personaModel — the whole point of this pass
 * (build brief: "use cheaper models for more manual tasks", and a browser/
 * terminal-driving persona is exactly that). Before this, runPersona never set
 * `model` at all, so every persona ran on the user's CLI default.
 *
 * The slot is granted without touching the real quota ledger (same seam
 * harness-judge-error.test.ts uses).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '../src/engine/runner';
import type { AcceptanceContract } from '../src/harness/types';

let claimedBackend: 'claude' | 'codex' | 'gemini' = 'claude';
vi.mock('../src/harness/spawn-slot', () => ({
  awaitClaimedSlot: async () => claimedBackend,
}));

const { runPersona } = await import('../src/harness/personas');
const { loadConfig } = await import('../src/engine/config');

function contract(): AcceptanceContract {
  return {
    id: 'ctr_persona_model_test',
    version: 1,
    taskId: 'task_persona_model_test',
    productId: null,
    title: 'Persona model wiring',
    baselineRunId: null,
    criteria: [
      { id: 'crit_1', kind: 'criterion', text: 'it works', holdout: false, provenance: null },
    ],
    createdAt: new Date().toISOString(),
    signature: null,
  };
}

describe("runPersona passes harness.personaModel as the spawn's model", () => {
  it('on the claude backend, forwards the configured personaModel', async () => {
    claimedBackend = 'claude';
    const runDir = mkdtempSync(path.join(os.tmpdir(), 'persona-model-test-'));
    let captured: { model?: string | null } | null = null;
    const runner = {
      spawnAgent: async (opts: { model?: string | null }) => {
        captured = opts;
        return { pid: 1, exitCode: 1, stdout: '', stderr: '', timedOut: false };
      },
    } as unknown as AgentRunner;

    try {
      await runPersona({
        spec: { charter: 'naive-user', name: 'naive-user-1', personaSeed: 'a seed' },
        runId: 'vrun_persona_model_test',
        runDir,
        bridgeUrl: 'http://127.0.0.1:0',
        productUrl: 'http://127.0.0.1:0',
        contract: contract(),
        goal: 'do the thing',
        maxTurns: 4,
        timeoutMinutes: 1,
        runner,
      });
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }

    expect(captured).not.toBeNull();
    expect(captured!.model).toBe(loadConfig().execution.harness.personaModel);
  });

  it('on a non-claude backend, drops the model rather than pinning an alias codex/gemini cannot honour', async () => {
    claimedBackend = 'codex';
    const runDir = mkdtempSync(path.join(os.tmpdir(), 'persona-model-test-'));
    let captured: { model?: string | null } | null = null;
    const runner = {
      spawnAgent: async (opts: { model?: string | null }) => {
        captured = opts;
        return { pid: 1, exitCode: 1, stdout: '', stderr: '', timedOut: false };
      },
    } as unknown as AgentRunner;

    try {
      await runPersona({
        spec: { charter: 'naive-user', name: 'naive-user-1', personaSeed: 'a seed' },
        runId: 'vrun_persona_model_test_codex',
        runDir,
        bridgeUrl: 'http://127.0.0.1:0',
        productUrl: 'http://127.0.0.1:0',
        contract: contract(),
        goal: 'do the thing',
        maxTurns: 4,
        timeoutMinutes: 1,
        runner,
      });
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }

    expect(captured).not.toBeNull();
    expect(captured!.model).toBeUndefined();
  });
});
