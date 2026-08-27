/**
 * Spawn argv: restrictions must survive the backend, or the spawn must not happen
 * (D8, fixes #3/#4 and the oracle deny rules of #2).
 *
 * The bug this locks down: buildArgs returned early for codex and gemini, so
 * allowedTools/skipPermissions were dropped. A judge routed to codex got
 * `--sandbox workspace-write -C <runDir>` and could rewrite the evidence it was
 * grading; a read-only persona routed to gemini got `--approval-mode yolo`.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { denyRulesForRole, toolsForRole } from '../src/engine/config';
import { buildArgs, canBackendHonorRestrictions, modelForBackend } from '../src/engine/runner';
import type { SpawnOptions } from '../src/engine/types';

import { DATA_DIR } from '../src/paths';

const opts = (over: Partial<SpawnOptions> = {}): SpawnOptions => ({
  prompt: 'do the thing',
  maxTurns: 10,
  timeoutMinutes: 30,
  skipPermissions: false,
  cwd: '/tmp/work',
  ...over,
});

const BUILDER_TOOLS = ['Read', 'Edit', 'Write', 'Bash'];

describe('toolsForRole (D9)', () => {
  it('keeps Bash for the builder — it has to be able to run things', () => {
    expect(toolsForRole('builder')).toContain('Bash');
  });

  it('gives the roles that edit JSON Read/Edit/Write and no shell', () => {
    for (const role of ['scheduled', 'triage'] as const) {
      expect(toolsForRole(role)).toEqual(['Read', 'Edit', 'Write']);
      expect(toolsForRole(role)).not.toContain('Bash');
    }
  });

  // E10: the inbox pass returns its reply as JSON and the daemon files it, so
  // the spawn whose entire prompt is somebody else's message text no longer
  // holds a pen over the store it came from. Same grant as talk.
  it('gives the compose-only roles Read and nothing else', () => {
    for (const role of ['talk', 'inbox'] as const) {
      expect(toolsForRole(role)).toEqual(['Read']);
    }
  });
});

describe('denyRulesForRole (D7)', () => {
  it('hides the compiled contracts from every role', () => {
    for (const role of ['builder', 'scheduled', 'inbox', 'triage'] as const) {
      expect(denyRulesForRole(role)).toContain(`Read(/${path.join(DATA_DIR, 'contracts', '**')})`);
    }
  });

  it('hides the raw task store from the builder', () => {
    expect(denyRulesForRole('builder')).toContain(`Read(/${path.join(DATA_DIR, 'tasks.json')})`);
    expect(denyRulesForRole('builder')).toContain(`Edit(/${path.join(DATA_DIR, 'tasks.json')})`);
  });

  it('still lets scheduled commands and triage manage tasks', () => {
    for (const role of ['scheduled', 'triage'] as const) {
      expect(denyRulesForRole(role).some((r) => r.includes('tasks.json'))).toBe(false);
    }
  });
});

describe('claude argv', () => {
  it('passes the allow list and the deny rules for a restricted builder', () => {
    const args = buildArgs(opts({ allowedTools: BUILDER_TOOLS, role: 'builder' }), 'claude');
    expect(args).toContain('--allowedTools');
    expect(args).toContain('Bash');
    expect(args).toContain('--disallowedTools');
    expect(args).toContain(`Read(/${path.join(DATA_DIR, 'contracts', '**')})`);
    expect(args).toContain(`Read(/${path.join(DATA_DIR, 'tasks.json')})`);
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('passes the bypass flag only when the caller asked for it', () => {
    const args = buildArgs(opts({ skipPermissions: true, role: 'builder' }), 'claude');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('honours an explicit deny list over the role default', () => {
    const args = buildArgs(
      opts({ allowedTools: ['Read'], disallowedTools: ['Read(//etc/**)'] }),
      'claude',
    );
    expect(args).toContain('Read(//etc/**)');
    expect(args.some((a) => a.includes('contracts'))).toBe(false);
  });

  it('forwards a pinned model', () => {
    expect(buildArgs(opts({ allowedTools: ['Read'], model: 'opus' }), 'claude')).toContain(
      '--model',
    );
  });
});

describe('codex argv', () => {
  it('uses the read-only sandbox for a restricted read-only spawn (the judge)', () => {
    const args = buildArgs(opts({ allowedTools: ['Read'] }), 'codex');
    expect(args.join(' ')).toContain('--sandbox read-only');
    expect(args.join(' ')).not.toContain('workspace-write');
    expect(args.join(' ')).not.toContain('approval_policy');
  });

  it('uses the read-only sandbox for a shell-only persona (stricter, never looser)', () => {
    const args = buildArgs(opts({ allowedTools: ['Bash'] }), 'codex');
    expect(args.join(' ')).toContain('--sandbox read-only');
  });

  it('allows workspace-write for a restricted builder, without switching approvals off', () => {
    const args = buildArgs(opts({ allowedTools: BUILDER_TOOLS, role: 'builder' }), 'codex');
    expect(args.join(' ')).toContain('--sandbox workspace-write');
    expect(args.join(' ')).not.toContain('approval_policy');
  });

  it('refuses to spawn when writes are allowed but the shell is not', () => {
    expect(() =>
      buildArgs(opts({ allowedTools: ['Read', 'Edit', 'Write'], role: 'inbox' }), 'codex'),
    ).toThrow(/deny(ing)? command execution/);
  });

  it('refuses to spawn when a claude model was pinned', () => {
    expect(() => buildArgs(opts({ allowedTools: ['Read'], model: 'opus' }), 'codex')).toThrow(
      /only the claude CLI/,
    );
  });

  it('stays unrestricted only when skipPermissions was set', () => {
    const args = buildArgs(opts({ skipPermissions: true }), 'codex').join(' ');
    expect(args).toContain('--sandbox workspace-write');
    expect(args).toContain('approval_policy="never"');
  });
});

describe('gemini argv', () => {
  it('uses plan (read-only) mode for a restricted read-only spawn', () => {
    const args = buildArgs(opts({ allowedTools: ['Read'] }), 'gemini').join(' ');
    expect(args).toContain('--approval-mode plan');
    expect(args).not.toContain('yolo');
  });

  it('refuses to spawn a restricted session that needs to write', () => {
    expect(() =>
      buildArgs(opts({ allowedTools: BUILDER_TOOLS, role: 'builder' }), 'gemini'),
    ).toThrow(/cannot express a partial grant/);
  });

  it('refuses to spawn a restricted session that needs a shell', () => {
    expect(() => buildArgs(opts({ allowedTools: ['Bash'] }), 'gemini')).toThrow(
      /cannot express a partial grant/,
    );
  });

  it('refuses to spawn when a claude model was pinned', () => {
    expect(() => buildArgs(opts({ allowedTools: ['Read'], model: 'opus' }), 'gemini')).toThrow(
      /only the claude CLI/,
    );
  });

  it('uses yolo only when skipPermissions was set', () => {
    expect(buildArgs(opts({ skipPermissions: true }), 'gemini').join(' ')).toContain(
      '--approval-mode yolo',
    );
  });
});

describe('canBackendHonorRestrictions (fallback chains skip, direct spawns throw)', () => {
  const cases: Array<[string, SpawnOptions]> = [
    ['builder (R/E/W/Bash)', opts({ allowedTools: BUILDER_TOOLS, role: 'builder' })],
    ['judge (Read + model pin)', opts({ allowedTools: ['Read'], model: 'opus' })],
    ['judge (Read)', opts({ allowedTools: ['Read'] })],
    ['persona (Bash)', opts({ allowedTools: ['Bash'] })],
    ['inbox (R/E/W)', opts({ allowedTools: ['Read', 'Edit', 'Write'], role: 'inbox' })],
    ['unrestricted', opts({ skipPermissions: true, role: 'builder' })],
    ['unrestricted + model pin', opts({ skipPermissions: true, model: 'opus' })],
    ['no tools declared', opts()],
  ];

  it('agrees with buildArgs for every backend and every case', () => {
    for (const backend of ['claude', 'codex', 'gemini'] as const) {
      for (const [label, o] of cases) {
        const predicate = canBackendHonorRestrictions(backend, o);
        let threw = false;
        try {
          buildArgs(o, backend);
        } catch {
          threw = true;
        }
        expect(
          predicate,
          `${backend} / ${label}: predicate ${predicate} but buildArgs threw=${threw}`,
        ).toBe(!threw);
      }
    }
  });

  it('says claude can honour anything', () => {
    for (const [, o] of cases) expect(canBackendHonorRestrictions('claude', o)).toBe(true);
  });

  it('lets a chain skip gemini for a builder but keep codex', () => {
    const builder = opts({ allowedTools: BUILDER_TOOLS, role: 'builder' });
    expect(canBackendHonorRestrictions('codex', builder)).toBe(true);
    expect(canBackendHonorRestrictions('gemini', builder)).toBe(false);
  });

  it('accepts the bare restriction shape, without a full SpawnOptions', () => {
    expect(canBackendHonorRestrictions('gemini', { allowedTools: ['Read'] })).toBe(true);
    expect(canBackendHonorRestrictions('gemini', { allowedTools: ['Write'] })).toBe(false);
    expect(canBackendHonorRestrictions('codex', { skipPermissions: true })).toBe(true);
    expect(canBackendHonorRestrictions('codex', { model: 'opus' })).toBe(false);
  });
});

describe('modelForBackend (personaModel/workerModel gate)', () => {
  it('passes the configured model through on claude', () => {
    expect(modelForBackend('claude', 'sonnet')).toBe('sonnet');
  });

  it('treats an unspecified backend as claude — the same default spawnAgent uses', () => {
    expect(modelForBackend(undefined, 'sonnet')).toBe('sonnet');
  });

  it('drops the model for codex/gemini rather than let buildArgs fail closed', () => {
    // The bug this guards: a fallback chain (dispatcher.ts, run-task.ts) passes
    // workerModel/personaModel unconditionally across a claude→codex/gemini
    // retry. Without this gate, buildArgs throws mid-fallback instead of the
    // backend being skipped gracefully — see "refuses to spawn when a claude
    // model was pinned" above.
    expect(modelForBackend('codex', 'sonnet')).toBeUndefined();
    expect(modelForBackend('gemini', 'sonnet')).toBeUndefined();
  });

  it("passes null through on claude — the caller's own opt-out of a model pin", () => {
    expect(modelForBackend('claude', null)).toBeNull();
  });
});

describe('no restricted spawn is ever auto-approved', () => {
  it('never emits yolo or approval_policy=never for a restricted spawn', () => {
    const restricted: Array<[SpawnOptions, 'claude' | 'codex' | 'gemini']> = [
      [opts({ allowedTools: ['Read'] }), 'claude'],
      [opts({ allowedTools: BUILDER_TOOLS, role: 'builder' }), 'claude'],
      [opts({ allowedTools: ['Read'] }), 'codex'],
      [opts({ allowedTools: ['Bash'] }), 'codex'],
      [opts({ allowedTools: BUILDER_TOOLS, role: 'builder' }), 'codex'],
      [opts({ allowedTools: ['Read'] }), 'gemini'],
    ];
    for (const [o, backend] of restricted) {
      const args = buildArgs(o, backend).join(' ');
      expect(args, `${backend}: ${args}`).not.toContain('yolo');
      expect(args, `${backend}: ${args}`).not.toContain('approval_policy="never"');
      expect(args, `${backend}: ${args}`).not.toContain('--dangerously-skip-permissions');
    }
  });
});
