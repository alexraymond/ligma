/**
 * scripts/acceptance/fake-claude.mjs — the canned stand-in drill mode spawns
 * through `claudeBinaryPath`. Each role's reply must parse with the SAME
 * parser its real consumer uses, or a drill run would pass while a real
 * dispatch would break on the exact same reply shape.
 *
 * Runs the real script as a child process (so a broken shebang, a missing
 * `LIGMA_SPAWN_ROLE` read, or a non-zero exit is caught too), then feeds its
 * stdout through the production parsers — never a hand-rolled shape check.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { AcceptanceContract } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { discoveryReplySchema } from '../src/engine/discovery';
import { parseCompletedSubtaskIds } from '../src/engine/prompt-builder';
import { parseJudgeOutput } from '../src/harness/judge';
import { parseCliJsonReply, parsePersonaOutput } from '../src/harness/personas';

const FAKE_CLAUDE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'acceptance',
  'fake-claude.mjs',
);

function runFakeClaude(role: string | undefined): string {
  return execFileSync(
    process.execPath,
    [FAKE_CLAUDE, '-p', 'irrelevant prompt', '--output-format', 'json'],
    {
      encoding: 'utf-8',
      env: { ...process.env, LIGMA_SPAWN_ROLE: role ?? '' },
    },
  );
}

const fakeContract: AcceptanceContract = {
  id: 'ctr_test',
  version: 1,
  taskId: 'task_1',
  productId: null,
  title: 'test contract',
  baselineRunId: null,
  criteria: [
    { id: 'crit_1', kind: 'criterion', text: 'does a thing', holdout: false, provenance: null },
    {
      id: 'inv_1',
      kind: 'invariant',
      text: 'never does another thing',
      holdout: true,
      provenance: null,
    },
  ],
  createdAt: new Date().toISOString(),
  signature: null,
};

describe('fake-claude.mjs', () => {
  it('exits 0 for every known role and an unknown one', () => {
    for (const role of ['discovery', 'builder', 'persona', 'judge', 'scheduled', undefined]) {
      expect(() => runFakeClaude(role)).not.toThrow();
    }
  });

  it('discovery reply parses with discoveryReplySchema and ends discovery', () => {
    const stdout = runFakeClaude('discovery');
    const parsed = discoveryReplySchema.parse(parseCliJsonReply(stdout, 'discovery'));
    expect(parsed).toEqual({ needMore: false, form: null });
  });

  it('builder reply parses with parseCompletedSubtaskIds', () => {
    const stdout = runFakeClaude('builder');
    expect(parseCompletedSubtaskIds(stdout)).toEqual([]);
  });

  it('persona reply parses with parsePersonaOutput for every charter', () => {
    const stdout = runFakeClaude('persona');
    const parsed = parsePersonaOutput(stdout, 'naive-user');
    expect(parsed).toEqual({
      goalAchieved: null,
      wrongTurns: 0,
      findings: [],
      criterionResults: null,
      proposedJourneys: null,
    });
  });

  it('judge reply parses with parseJudgeOutput (all criteria stay unknown, no parse error)', () => {
    const stdout = runFakeClaude('judge');
    const { criterionVerdicts, humanDecisions, parseError } = parseJudgeOutput(
      stdout,
      fakeContract,
    );
    expect(parseError).toBeNull();
    expect(humanDecisions).toEqual([]);
    expect(criterionVerdicts).toHaveLength(2);
    for (const v of criterionVerdicts) expect(v.status).toBe('unknown');
  });

  it('an unrecognized role still yields a fenced, parseable {} block', () => {
    const stdout = runFakeClaude('scheduled');
    expect(parseCliJsonReply(stdout, 'generic')).toEqual({});
  });

  it('no LIGMA_SPAWN_ROLE at all still yields a fenced, parseable {} block', () => {
    const stdout = runFakeClaude(undefined);
    expect(parseCliJsonReply(stdout, 'generic')).toEqual({});
  });
});
