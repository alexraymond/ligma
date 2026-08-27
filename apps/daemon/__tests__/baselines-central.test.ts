/**
 * The visibility split (twin-primitives §3): journeys are public, baselines are
 * not. These are the two halves of that claim — the store puts baselines under
 * the central per-project dir, and every spawned agent is denied that dir by the
 * existing `--disallowedTools` machinery.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { denyRulesForRole } from '../src/engine/config';
import { buildArgs } from '../src/engine/runner';
import {
  CENTRAL_PROJECTS_DIR,
  baselinePath,
  baselinesDir,
  observationOf,
  probesDir,
} from '../src/harness/baselines';
import { CENTRAL_PROJECTS_DIR as PATHS_CENTRAL } from '../src/paths';
import { DATA_DIR } from '../src/paths';

describe('central per-project store', () => {
  it('lives under data/projects, never in a target repo', () => {
    expect(PATHS_CENTRAL).toBe(path.join(DATA_DIR, 'projects'));
    expect(baselinesDir('proj_1')).toBe(path.join(CENTRAL_PROJECTS_DIR, 'proj_1', 'baselines'));
    expect(probesDir('proj_1')).toBe(path.join(CENTRAL_PROJECTS_DIR, 'proj_1', 'probes'));
  });

  it('keeps a hostile project or journey id inside the store', () => {
    // basename() strips the traversal, and what it strips down to "." or ".."
    // is refused outright rather than resolved against the store root.
    expect(baselinePath('sub/proj_1', 'dir/jrn_1')).toBe(
      path.join(CENTRAL_PROJECTS_DIR, 'proj_1', 'baselines', 'jrn_1.json'),
    );
    for (const hostile of ['../../..', '..', '.', '', 'a/..']) {
      expect(() => baselinePath(hostile, 'x')).toThrow(/Unsafe id/);
      expect(() => baselinePath('proj_1', hostile)).toThrow(/Unsafe id/);
    }
  });
});

describe('builders are denied the baselines', () => {
  const glob = `${path.join(CENTRAL_PROJECTS_DIR, '**')}`;

  it('denies read and write of the central project store to every role', () => {
    for (const role of ['builder', 'inbox', 'scheduled', undefined] as const) {
      const rules = denyRulesForRole(role);
      expect(rules).toContain(`Read(/${glob})`);
      expect(rules).toContain(`Edit(/${glob})`);
    }
  });

  it('puts those rules on the actual claude argv', () => {
    const args = buildArgs(
      {
        prompt: 'build the thing',
        maxTurns: 3,
        timeoutMinutes: 5,
        skipPermissions: false,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
        cwd: DATA_DIR,
        role: 'builder',
      },
      'claude',
    );
    const denyIndex = args.indexOf('--disallowedTools');
    expect(denyIndex).toBeGreaterThan(-1);
    expect(args.slice(denyIndex + 1)).toContain(`Read(/${glob})`);
  });

  it('still denies the contracts dir — the new rule is additive', () => {
    expect(denyRulesForRole('builder')).toContain(
      `Read(/${path.join(DATA_DIR, 'contracts', '**')})`,
    );
  });

  it('denies the builder its own product repo NOTHING — the rules are absolute data/ paths', () => {
    // The builder now runs with cwd inside a product repo. The deny rules are
    // absolute paths into data/, so they bind the same session identically —
    // this is the assertion that a cwd change cannot loosen the oracle.
    for (const rule of denyRulesForRole('builder')) {
      expect(rule).toMatch(/^(Read|Edit)\(\/\//);
    }
  });
});

describe('what a baseline step observed', () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-observed-'));
  const record = (rel: string, body: unknown): string => {
    mkdirSync(path.join(runDir, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(runDir, rel), JSON.stringify(body), 'utf-8');
    return rel;
  };

  afterAll(() => rmSync(runDir, { recursive: true, force: true }));

  it('reads an HTTP record as a status and a schema', () => {
    const rel = record('personas/a/records/POST-tasks.json', {
      method: 'POST',
      url: 'http://127.0.0.1:1/api/tasks',
      status: 201,
      schema: '{id:string,title:string}',
    });
    expect(observationOf(runDir, rel)).toEqual({
      transport: 'http',
      status: 201,
      schema: '{id:string,title:string}',
    });
  });

  it('reads a command record as an exit code', () => {
    const rel = record('personas/a/records/run-1.json', {
      argv: ['node', 'cli.js', 'list'],
      exitCode: 0,
    });
    expect(observationOf(runDir, rel)).toEqual({ transport: 'pty', exitCode: 0 });
  });

  it('calls a screenshot a browser observation, and characterizes nothing it cannot read', () => {
    expect(observationOf(runDir, 'screenshots/step-3.png')).toEqual({ transport: 'browser' });
    expect(observationOf(runDir, null)).toBeUndefined();
    expect(observationOf(runDir, 'personas/a/records/gone.json')).toBeUndefined();
    expect(observationOf(runDir, 'personas/a/transcript.jsonl')).toBeUndefined();
  });
});
