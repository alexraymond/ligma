import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * Config that validates but cannot run (T2's class), refused where it is read.
 *
 * E6: `roleRouting.judge: "codex" | "gemini"` passed validation and then failed
 * at RUNTIME, every run — `assertJudgeModel` plus decideBackend's pinned-model
 * rejection make the judge spawn fail closed, while `remainingForRole("judge")`
 * answers Infinity for a non-claude role, so the panels became unbounded and
 * each one burned a verification attempt toward the cap.
 *
 * E15: the default tool grant is the BUILDER's, and the builder is the one role
 * that runs things.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-config-routing-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { loadConfig, getConfigPath } = await import('./config');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function withConfig(execution: Record<string, unknown>): ReturnType<typeof loadConfig> {
  writeFileSync(getConfigPath(), JSON.stringify({ execution }), 'utf-8');
  return loadConfig();
}

describe('roleRouting.judge (E6)', () => {
  it('refuses to route the judge off claude', () => {
    const config = withConfig({ governor: { roleRouting: { judge: 'codex' } } });
    expect(config.execution.governor.roleRouting.judge).toBe('claude');
  });

  it('still routes the roles that CAN run elsewhere', () => {
    const config = withConfig({
      governor: { roleRouting: { builder: 'codex', persona: 'gemini', judge: 'gemini' } },
    });
    expect(config.execution.governor.roleRouting.builder).toBe('codex');
    expect(config.execution.governor.roleRouting.persona).toBe('gemini');
    expect(config.execution.governor.roleRouting.judge).toBe('claude');
  });

  it('takes an explicit judge=claude unchanged', () => {
    expect(
      withConfig({ governor: { roleRouting: { judge: 'claude' } } }).execution.governor.roleRouting
        .judge,
    ).toBe('claude');
  });
});

describe('the default tool grant (E15)', () => {
  it('gives the builder a shell', () => {
    if (existsSync(getConfigPath())) unlinkSync(getConfigPath());
    // No file ⇒ defaults (loadConfig self-heals by writing them back).
    expect(loadConfig().execution.allowedTools).toEqual(['Read', 'Edit', 'Write', 'Bash']);
  });
});
