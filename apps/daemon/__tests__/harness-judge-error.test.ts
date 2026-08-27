/**
 * A harness malfunction is not a product failure (D3, fix #5).
 *
 * Before this fix a judge that crashed, timed out or produced garbage left every
 * criterion "unknown", computeOutcome said "failed", and that verdict was signed
 * and applied to the task — the build was blamed for the harness breaking. Same
 * for a contract whose signature did not verify.
 *
 * No LLM is spawned: the runner is a stub returning the exact SpawnResult shapes.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '../src/engine/runner';
import type { AcceptanceContract, PersonaReport } from '../src/harness/types';

type SpawnResultLike = {
  pid: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

// The slot is granted without touching the real quota ledger.
vi.mock('../src/harness/spawn-slot', () => ({
  awaitClaimedSlot: async () => 'claude',
}));

const { runJudge } = await import('../src/harness/judge');
const { sign } = await import('../src/harness/signing');

function signedContract(): AcceptanceContract {
  const unsigned: AcceptanceContract = {
    id: 'ctr_judge_error_test',
    version: 1,
    taskId: 'task_judge_error_test',
    productId: null,
    title: 'Judge error handling',
    baselineRunId: null,
    criteria: [
      {
        id: 'crit_1',
        kind: 'criterion',
        text: 'the export button works',
        holdout: false,
        provenance: null,
      },
      {
        id: 'crit_2',
        kind: 'criterion',
        text: 'the export contains every row',
        holdout: true,
        provenance: null,
      },
    ],
    createdAt: '2026-08-11T00:00:00.000Z',
    signature: null,
  };
  const { signature: _drop, ...payload } = unsigned;
  return { ...unsigned, signature: sign(payload) };
}

const cleanReport: PersonaReport = {
  charter: 'spec-auditor',
  runId: 'vrun_test',
  personaSeed: null,
  goalAchieved: true,
  stepCount: 3,
  wrongTurns: 0,
  elapsedMs: 100,
  findings: [],
  criterionResults: [
    { criterionId: 'crit_1', status: 'met', evidence: ['shots/01.png'] },
    { criterionId: 'crit_2', status: 'met', evidence: ['shots/02.png'] },
  ],
  transcriptPath: 'personas/spec-auditor/transcript.jsonl',
  invalid: false,
};

const stubRunner = (result: SpawnResultLike | Error): AgentRunner =>
  ({
    spawnAgent: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  }) as unknown as AgentRunner;

const fenced = (json: unknown): string =>
  JSON.stringify({
    type: 'result',
    result: `Here is my verdict.\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``,
  });

const judge = (runner: AgentRunner, contract = signedContract()) =>
  runJudge({
    contract,
    reports: [cleanReport],
    runId: 'vrun_test',
    taskId: contract.taskId!,
    runDir: '/tmp/does-not-need-to-exist',
    evidenceIndex: ['personas/spec-auditor/report.json'],
    judgeModel: 'opus',
    builderModel: null,
    maxTurns: 4,
    timeoutMinutes: 1,
    runner,
  });

describe('judge outcome: error vs failed', () => {
  it('a crashed judge is an error, not a failure', async () => {
    const verdict = await judge(
      stubRunner({ pid: 1, exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }),
    );
    expect(verdict.outcome).toBe('error');
    expect(verdict.signature).not.toBeNull();
    expect(verdict.criterionVerdicts.every((v) => v.reasoning.startsWith('Harness error:'))).toBe(
      true,
    );
    // The class comes from the branch that raised it, not from "boom".
    expect(verdict.causeKind).toBe('backend');
  });

  it('a timed-out judge is an error', async () => {
    const verdict = await judge(
      stubRunner({ pid: 1, exitCode: null, stdout: 'partial', stderr: '', timedOut: true }),
    );
    expect(verdict.outcome).toBe('error');
    expect(verdict.causeKind).toBe('backend');
  });

  it('a judge spawn that throws (fail-closed backend) is an error', async () => {
    const verdict = await judge(
      stubRunner(new Error('gemini cannot express a read-only tool set')),
    );
    expect(verdict.outcome).toBe('error');
    expect(verdict.criterionVerdicts[0].reasoning).toContain('gemini cannot express');
    expect(verdict.causeKind).toBe('backend');
  });

  it('unparseable judge output is an error', async () => {
    const verdict = await judge(
      stubRunner({
        pid: 1,
        exitCode: 0,
        stdout: 'the product seemed fine to me',
        stderr: '',
        timedOut: false,
      }),
    );
    expect(verdict.outcome).toBe('error');
    // The parser already knew: it returned a parseError rather than a verdict.
    expect(verdict.causeKind).toBe('parse');
  });

  it('a contract that fails signature verification is an error', async () => {
    const tampered = signedContract();
    tampered.criteria[0].text = 'the export button works, sort of';
    const verdict = await judge(
      stubRunner({
        pid: 1,
        exitCode: 0,
        stdout: fenced({ criterionVerdicts: [] }),
        stderr: '',
        timedOut: false,
      }),
      tampered,
    );
    expect(verdict.outcome).toBe('error');
    expect(verdict.criterionVerdicts[0].reasoning).toContain('signature verification');
    expect(verdict.causeKind).toBe('harness');
  });

  it('every criterion met with clean reports is a pass', async () => {
    const verdict = await judge(
      stubRunner({
        pid: 1,
        exitCode: 0,
        stdout: fenced({
          criterionVerdicts: [
            {
              criterionId: 'crit_1',
              status: 'met',
              reasoning: 'saw it export',
              evidence: ['shots/01.png'],
            },
            {
              criterionId: 'crit_2',
              status: 'met',
              reasoning: 'row count matched',
              evidence: ['shots/02.png'],
            },
          ],
          humanDecisions: [],
        }),
        stderr: '',
        timedOut: false,
      }),
    );
    expect(verdict.outcome).toBe('passed');
    // Nothing malfunctioned, so there is no cause to name.
    expect(verdict.causeKind).toBeUndefined();
  });

  it('a genuine not-met is a failure, not an error', async () => {
    const verdict = await judge(
      stubRunner({
        pid: 1,
        exitCode: 0,
        stdout: fenced({
          criterionVerdicts: [
            {
              criterionId: 'crit_1',
              status: 'met',
              reasoning: 'saw it export',
              evidence: ['shots/01.png'],
            },
            {
              criterionId: 'crit_2',
              status: 'not-met',
              reasoning: 'export was missing 4 rows',
              evidence: [],
            },
          ],
          humanDecisions: [],
        }),
        stderr: '',
        timedOut: false,
      }),
    );
    expect(verdict.outcome).toBe('failed');
    expect(verdict.causeKind).toBeUndefined();
  });
});
