/**
 * C2's judge-slot claim path.
 *
 * The judge used to claim its own governor slot at the very end of a run — after
 * its own panel had spent the window it needed. One live run did 13 personas over
 * 50 minutes and then starved on the judge: 13 sessions burned, no verdict, no
 * evidence retained. The daemon now claims that slot at the door and threads it
 * down; the judge spends it instead of queueing for it.
 *
 * No LLM and no real ledger: the runner is a stub and the slot module is mocked,
 * so what is asserted is the wiring — who waits, and who does not.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '../src/engine/runner';
import type { AcceptanceContract, PersonaReport } from '../src/harness/types';

const awaitClaimedSlot = vi.fn(async () => 'claude' as const);
vi.mock('../src/harness/spawn-slot', () => ({
  awaitClaimedSlot: (...a: unknown[]) => awaitClaimedSlot(...(a as [])),
}));

const { runJudge } = await import('../src/harness/judge');
const { sign } = await import('../src/harness/signing');
const { parseArgs } = await import('../src/harness/run-verification');

function signedContract(): AcceptanceContract {
  const unsigned: AcceptanceContract = {
    id: 'ctr_judge_slot_test',
    version: 1,
    taskId: 'task_judge_slot_test',
    productId: null,
    title: 'Judge slot threading',
    baselineRunId: null,
    criteria: [
      { id: 'crit_1', kind: 'criterion', text: 'it works', holdout: false, provenance: null },
    ],
    createdAt: '2026-08-26T00:00:00.000Z',
    signature: null,
  };
  const { signature: _drop, ...payload } = unsigned;
  return { ...unsigned, signature: sign(payload) };
}

const report: PersonaReport = {
  charter: 'spec-auditor',
  runId: 'vrun_slot_test',
  personaSeed: null,
  goalAchieved: true,
  stepCount: 1,
  wrongTurns: 0,
  elapsedMs: 1,
  findings: [],
  criterionResults: [{ criterionId: 'crit_1', status: 'met', evidence: ['shots/01.png'] }],
  transcriptPath: 'personas/spec-auditor/transcript.jsonl',
  invalid: false,
};

const fenced = JSON.stringify({
  type: 'result',
  result: `\`\`\`json\n${JSON.stringify({
    criterionVerdicts: [
      { criterionId: 'crit_1', status: 'met', reasoning: 'saw it', evidence: ['shots/01.png'] },
    ],
  })}\n\`\`\``,
});

/** Records the backend the judge actually spawned on. */
function stubRunner(seen: { backend?: string }): AgentRunner {
  return {
    spawnAgent: async (opts: { backend?: string }) => {
      seen.backend = opts.backend;
      return { pid: 1, exitCode: 0, stdout: fenced, stderr: '', timedOut: false };
    },
  } as unknown as AgentRunner;
}

const judge = (runner: AgentRunner, claimedSlot: 'claude' | 'gemini' | null) =>
  runJudge({
    contract: signedContract(),
    reports: [report],
    runId: 'vrun_slot_test',
    taskId: 'task_judge_slot_test',
    runDir: '/tmp/does-not-need-to-exist',
    evidenceIndex: [],
    judgeModel: 'opus',
    builderModel: null,
    maxTurns: 4,
    timeoutMinutes: 1,
    runner,
    claimedSlot,
  });

describe('runJudge with a pre-claimed slot', () => {
  it('spends the claimed slot without queueing for one', async () => {
    awaitClaimedSlot.mockClear();
    const seen: { backend?: string } = {};
    const verdict = await judge(stubRunner(seen), 'gemini');

    expect(awaitClaimedSlot).not.toHaveBeenCalled();
    expect(seen.backend).toBe('gemini');
    expect(verdict.outcome).toBe('passed');
  });

  it('still claims its own slot when nobody claimed one for it (a hand-run)', async () => {
    awaitClaimedSlot.mockClear();
    const seen: { backend?: string } = {};
    await judge(stubRunner(seen), null);

    expect(awaitClaimedSlot).toHaveBeenCalledTimes(1);
    expect(seen.backend).toBe('claude');
  });
});

describe('run-verification parseArgs', () => {
  it('reads the judge slot the daemon booked', () => {
    expect(parseArgs(['task_a', '--judge-slot', 'claude'])).toMatchObject({
      taskId: 'task_a',
      judgeSlot: 'claude',
    });
  });

  it("does not mistake a flag's value for the task id", () => {
    expect(parseArgs(['--judge-slot', 'gemini', 'task_b']).taskId).toBe('task_b');
    expect(parseArgs(['--mutate', 'mutations/x.ts', 'task_c']).taskId).toBe('task_c');
  });

  it('ignores a slot that is not a real backend rather than trusting it', () => {
    expect(parseArgs(['task_d', '--judge-slot', 'nonsense']).judgeSlot).toBeNull();
  });

  it('leaves judgeSlot null for a hand-run', () => {
    expect(parseArgs(['task_e', '--smoke'])).toMatchObject({ smoke: true, judgeSlot: null });
  });
});
