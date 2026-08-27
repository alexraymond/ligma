/**
 * Prompt-size guards and the single CLI-reply parser (fixes I10, I12, I13).
 *
 * I10: judge and persona prompts skipped enforcePromptLimit, so a saboteur that
 * pasted 10k characters into a field pushed the judge prompt past the argv limit,
 * the spawn died with E2BIG, and a good build got an "error" verdict.
 * I12/I13: three hand-rolled copies of the fenced-JSON extractor had drifted —
 * the contract compiler took the FIRST block (the prompt's own example, whenever
 * the model echoed it) and did not understand the event-array envelope.
 */

import { describe, expect, it } from 'vitest';
import { buildJudgePrompt } from '../src/harness/judge';
import { buildPersonaPrompt, parseCliJsonReply } from '../src/harness/personas';
import type { AcceptanceContract, PersonaCharter, PersonaReport } from '../src/harness/types';

const MAX_PROMPT_LENGTH = 100_000;

const contract: AcceptanceContract = {
  id: 'ctr_prompt_guard',
  version: 1,
  taskId: 'task_prompt_guard',
  productId: null,
  title: 'Prompt guards',
  baselineRunId: null,
  criteria: [
    { id: 'crit_1', kind: 'criterion', text: 'the board loads', holdout: false, provenance: null },
    {
      id: 'crit_2',
      kind: 'criterion',
      text: 'a task can be created',
      holdout: true,
      provenance: null,
    },
  ],
  createdAt: '2026-08-11T00:00:00.000Z',
  signature: null,
};

const report = (
  charter: PersonaCharter,
  summary: string,
  over: Partial<PersonaReport> = {},
): PersonaReport => ({
  charter,
  runId: `vrun_${charter}`,
  personaSeed: null,
  goalAchieved: true,
  stepCount: 5,
  wrongTurns: 1,
  elapsedMs: 500,
  findings: [{ severity: 'major', summary, evidence: ['shots/01.png'], criterionId: null }],
  criterionResults: null,
  transcriptPath: `personas/${charter}/transcript.jsonl`,
  invalid: false,
  ...over,
});

const judgeOpts = (reports: PersonaReport[]) => ({
  contract,
  reports,
  runId: 'vrun_prompt_guard',
  taskId: 'task_prompt_guard',
  runDir: '/tmp/run',
  evidenceIndex: Array.from({ length: 400 }, (_, i) => `personas/naive-user-1/shots/${i}.png`),
  judgeModel: 'opus',
  builderModel: null,
  maxTurns: 6,
  timeoutMinutes: 10,
});

describe('judge prompt size guard', () => {
  it('fits the argv budget when a saboteur pastes 60k characters', () => {
    const paste = 'A'.repeat(60_000);
    const prompt = buildJudgePrompt(
      judgeOpts([
        report('naive-user', paste),
        report('visual-critic', paste),
        report('returning-user', paste),
        report('saboteur', paste),
        report('spec-auditor', paste, {
          criterionResults: [
            { criterionId: 'crit_1', status: 'met', evidence: ['shots/01.png'] },
            { criterionId: 'crit_2', status: 'not-met', evidence: [] },
          ],
        }),
      ]),
    );

    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(prompt).not.toContain('PROMPT TRUNCATED');
    // The spec-auditor's criterion claims are what the verdict is computed from.
    expect(prompt).toContain('"criterionId": "crit_1"');
    expect(prompt).toContain('"criterionId": "crit_2"');
    // Capping the finding text is enough here, so no report is lost at all.
    expect(prompt).not.toContain('too large to include');
    expect(prompt).toContain('[truncated]');
    // The required-output contract must survive, or the reply is unparseable.
    expect(prompt).toContain('Reply with NOTHING but a single fenced JSON block');
  });

  it('drops the dispensable charters when capping is not enough, keeping the load-bearing two', () => {
    const bulky = (charter: PersonaCharter, i: number): PersonaReport => ({
      ...report(charter, 'x'),
      runId: `vrun_${charter}_${i}`,
      findings: Array.from({ length: 20 }, () => ({
        severity: 'minor' as const,
        summary: 'y'.repeat(600),
        evidence: Array.from({ length: 10 }, (_, k) => `personas/${charter}/shots/${k}.png`),
        criterionId: null,
      })),
    });

    const reports: PersonaReport[] = [
      ...Array.from({ length: 12 }, (_, i) => bulky('naive-user', i)),
      ...Array.from({ length: 6 }, (_, i) => bulky('visual-critic', i)),
      bulky('saboteur', 0),
      {
        ...bulky('spec-auditor', 0),
        criterionResults: [{ criterionId: 'crit_1', status: 'met', evidence: ['shots/01.png'] }],
      },
    ];

    const prompt = buildJudgePrompt(judgeOpts(reports));
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(prompt).toContain('too large to include');
    expect(prompt).toContain('naive-user');
    expect(prompt).toContain('"charter": "spec-auditor"');
    expect(prompt).toContain('"criterionId": "crit_1"');
    expect(prompt).toContain('Reply with NOTHING but a single fenced JSON block');
  });

  it('keeps every report when nothing is oversized', () => {
    const prompt = buildJudgePrompt(
      judgeOpts([
        report('naive-user', 'could not find the button'),
        report('spec-auditor', 'crit_2 never shown'),
      ]),
    );
    expect(prompt).not.toContain('too large to include');
    expect(prompt).toContain('could not find the button');
  });
});

/**
 * H6a — a judge that cannot see the questions already open on the task re-asks
 * them: 11 near-identical pending cards from two runs 84 seconds apart, which
 * parked the task on the ≥3-pending rule. It is shown them, and answers with a
 * decision id rather than with matching text.
 */
describe('judge prompt shows the questions already open', () => {
  const withOpen = (openDecisions: Array<{ id: string; question: string }>) =>
    buildJudgePrompt({
      ...judgeOpts([report('spec-auditor', 'crit_2 never shown')]),
      openDecisions,
    });

  it('lists each open question with the id to point at', () => {
    const prompt = withOpen([
      { id: 'dec_7', question: 'Saving takes six clicks — accept?' },
      { id: 'dec_8', question: 'The empty state is blank — accept?' },
    ]);
    expect(prompt).toContain('dec_7');
    expect(prompt).toContain('Saving takes six clicks');
    expect(prompt).toContain('dec_8');
    expect(prompt).toContain('duplicateOf');
  });

  it('says nothing about open questions when there are none', () => {
    const prompt = withOpen([]);
    expect(prompt).not.toContain('already open');
  });
});

describe('persona prompt size guard', () => {
  it('caps a prompt built from an absurd contract', () => {
    const prompt = buildPersonaPrompt({
      spec: { charter: 'spec-auditor', name: 'spec-auditor', personaSeed: null },
      runId: 'vrun_prompt_guard',
      runDir: '/tmp/run',
      bridgeUrl: 'http://127.0.0.1:1/s/spec-auditor/token',
      productUrl: 'http://127.0.0.1:2',
      contract: {
        ...contract,
        criteria: Array.from({ length: 200 }, (_, i) => ({
          id: `crit_${i + 1}`,
          kind: 'criterion' as const,
          text: 'x'.repeat(2000),
          holdout: false,
          provenance: null,
        })),
      },
      goal: 'do the thing',
      maxTurns: 30,
      timeoutMinutes: 20,
    });
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH + 100);
  });
});

describe('one CLI-reply parser for the whole harness', () => {
  const fenced = (json: unknown) => `\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

  it("takes the LAST fenced block, not the prompt's echoed example", () => {
    const reply = `Here is the shape I will use:\n\n${fenced({ criteria: ['EXAMPLE'] })}\n\nAnd my answer:\n\n${fenced({ criteria: ['real'] })}`;
    expect(parseCliJsonReply(JSON.stringify({ result: reply }), 'test')).toEqual({
      criteria: ['real'],
    });
  });

  it('understands the event-array envelope the harness actually spawns', () => {
    const stdout = JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } },
      {
        type: 'result',
        subtype: 'success',
        result: `answer:\n\n${fenced({ invariants: ['never loses input'] })}`,
      },
    ]);
    expect(parseCliJsonReply(stdout, 'test')).toEqual({ invariants: ['never loses input'] });
  });

  it('throws when there is no fenced block, naming what failed', () => {
    expect(() => parseCliJsonReply('no json here', "contract compiler's reply")).toThrow(
      /no fenced JSON block in the contract compiler's reply/,
    );
  });
});
