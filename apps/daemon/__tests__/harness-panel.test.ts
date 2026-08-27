/**
 * Persona-report and judge-verdict parsing.
 *
 * These are the fail-closed seams: if either parser is generous, a broken
 * tester agent or a rambling judge becomes a pass. No LLM is spawned here — the
 * inputs are the exact stdout shapes `claude -p --output-format json` produces.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/engine/config';
import { assertJudgeModel, computeOutcome, parseJudgeOutput } from '../src/harness/judge';
import { parsePersonaOutput, unwrapCliReply } from '../src/harness/personas';
import { buildRoster } from '../src/harness/run-verification';
import type { AcceptanceContract, PersonaReport } from '../src/harness/types';

/** The CLI wraps the model's reply in an envelope; personas see that shape. */
const envelope = (reply: string): string => JSON.stringify({ type: 'result', result: reply });

const fenced = (json: unknown): string =>
  `Here is what I found.\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

const contract: AcceptanceContract = {
  id: 'ctr_test',
  version: 3,
  taskId: 'task_test',
  productId: null,
  title: 'Test contract',
  baselineRunId: null,
  criteria: [
    {
      id: 'crit_1',
      kind: 'criterion',
      text: 'Notes survive a reopen',
      holdout: false,
      provenance: null,
    },
    {
      id: 'crit_2',
      kind: 'criterion',
      text: 'The task appears on the board',
      holdout: true,
      provenance: null,
    },
    {
      id: 'inv_1',
      kind: 'invariant',
      text: 'never loses typed input',
      holdout: true,
      provenance: null,
    },
  ],
  createdAt: '2026-08-10T00:00:00.000Z',
  signature: null,
};

const report = (over: Partial<PersonaReport>): PersonaReport => ({
  charter: 'naive-user',
  runId: 'vrun_test',
  personaSeed: null,
  goalAchieved: true,
  stepCount: 4,
  wrongTurns: 0,
  elapsedMs: 1000,
  findings: [],
  criterionResults: null,
  transcriptPath: 'personas/naive-user-1/transcript.jsonl',
  invalid: false,
  ...over,
});

/** The shape `claude -p --output-format json` actually prints: an event array. */
const eventArray = (reply: string): string =>
  JSON.stringify([
    { type: 'system', subtype: 'init', tools: ['Bash'] },
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Let me look at the board.' }] },
    },
    {
      type: 'user',
      message: { content: [{ tool_use_id: 't1', type: 'tool_result', content: 'ok' }] },
    },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 6, result: reply },
  ]);

describe('unwrapping the CLI reply', () => {
  const reply = '```json\n{"goalAchieved": true, "findings": []}\n```';

  it('unwraps the event-array form — the default the CLI prints', () => {
    // This is the shape that silently broke fence extraction: inside the array
    // JSON the reply's newlines are escaped, so ``` never matches until unwrapped.
    expect(unwrapCliReply(eventArray(reply))).toBe(reply);
    expect(parsePersonaOutput(eventArray(reply), 'naive-user').goalAchieved).toBe(true);
  });

  it('unwraps the single-object form', () => {
    expect(unwrapCliReply(JSON.stringify({ result: reply }))).toBe(reply);
  });

  it('unwraps the JSONL form', () => {
    const jsonl = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'result', result: reply }),
    ].join('\n');
    expect(unwrapCliReply(jsonl)).toBe(reply);
  });

  it('falls back to assistant text when the stream has no result event', () => {
    const truncated = JSON.stringify([
      { type: 'assistant', message: { content: [{ type: 'text', text: reply }] } },
    ]);
    expect(unwrapCliReply(truncated)).toBe(reply);
  });

  it('passes plain text through untouched', () => {
    expect(unwrapCliReply(reply)).toBe(reply);
    expect(unwrapCliReply('   ')).toBe('');
  });
});

describe('persona report parsing', () => {
  it('parses a well-formed report', () => {
    const parsed = parsePersonaOutput(
      envelope(
        fenced({
          goalAchieved: false,
          wrongTurns: 3,
          findings: [
            {
              severity: 'major',
              summary: 'The note I typed was gone after reopening the task.',
              evidence: ['personas/naive-user-1/shots/04-click.png'],
              criterionId: 'crit_1',
            },
          ],
        }),
      ),
      'naive-user',
    );

    expect(parsed.goalAchieved).toBe(false);
    expect(parsed.wrongTurns).toBe(3);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].severity).toBe('major');
    expect(parsed.findings[0].evidence).toEqual(['personas/naive-user-1/shots/04-click.png']);
  });

  it('takes the LAST fenced block, so a quoted example does not win', () => {
    const reply =
      'The template looked like this:\n```json\n{"goalAchieved": true, "wrongTurns": 99, "findings": []}\n```\n' +
      'and here is my actual report:\n```json\n{"goalAchieved": false, "wrongTurns": 1, "findings": []}\n```';
    const parsed = parsePersonaOutput(envelope(reply), 'naive-user');
    expect(parsed.goalAchieved).toBe(false);
    expect(parsed.wrongTurns).toBe(1);
  });

  it('throws when there is no fenced block', () => {
    expect(() =>
      parsePersonaOutput(
        envelope('I could not work out how to use the bridge, sorry.'),
        'naive-user',
      ),
    ).toThrow(/no fenced JSON block/);
  });

  it('throws on garbage inside the fence', () => {
    expect(() =>
      parsePersonaOutput(envelope('```json\n{not json at all,,,}\n```'), 'naive-user'),
    ).toThrow();
  });

  it('throws on an unknown severity instead of downgrading it', () => {
    expect(() =>
      parsePersonaOutput(
        envelope(
          fenced({ goalAchieved: true, findings: [{ severity: 'catastrophic', summary: 'x' }] }),
        ),
        'naive-user',
      ),
    ).toThrow(/severity/);
  });

  it('throws on an empty finding summary', () => {
    expect(() =>
      parsePersonaOutput(
        envelope(fenced({ goalAchieved: true, findings: [{ severity: 'note', summary: '  ' }] })),
        'naive-user',
      ),
    ).toThrow(/summary/);
  });

  it('accepts a missing findings array as no findings', () => {
    const parsed = parsePersonaOutput(envelope(fenced({ goalAchieved: true })), 'naive-user');
    expect(parsed.findings).toEqual([]);
  });

  it('drops criterionResults from charters not allowed to judge criteria', () => {
    const parsed = parsePersonaOutput(
      envelope(
        fenced({
          goalAchieved: true,
          findings: [],
          criterionResults: [{ criterionId: 'crit_1', status: 'met' }],
        }),
      ),
      'naive-user',
    );
    expect(parsed.criterionResults).toBeNull();
  });

  it('keeps criterionResults for the spec-auditor', () => {
    const parsed = parsePersonaOutput(
      envelope(
        fenced({
          goalAchieved: null,
          findings: [],
          criterionResults: [
            {
              criterionId: 'crit_1',
              status: 'not-met',
              evidence: ['personas/spec-auditor/shots/02-click.png'],
            },
            { criterionId: 'crit_2', status: 'not-tested' },
          ],
        }),
      ),
      'spec-auditor',
    );
    expect(parsed.criterionResults).toHaveLength(2);
    expect(parsed.criterionResults?.[0].status).toBe('not-met');
    expect(parsed.criterionResults?.[1].evidence).toEqual([]);
  });

  it('throws on an invalid criterion status', () => {
    expect(() =>
      parsePersonaOutput(
        envelope(
          fenced({
            findings: [],
            criterionResults: [{ criterionId: 'crit_1', status: 'probably' }],
          }),
        ),
        'spec-auditor',
      ),
    ).toThrow(/status/);
  });
});

describe('judge verdict parsing is fail-closed', () => {
  it('returns unknown for every criterion when the reply is unparseable', () => {
    const parsed = parseJudgeOutput('the product seemed fine to me', contract);
    expect(parsed.criterionVerdicts).toHaveLength(3);
    expect(parsed.criterionVerdicts.every((v) => v.status === 'unknown')).toBe(true);
    expect(parsed.criterionVerdicts[0].reasoning).toMatch(/could not be parsed/);
    expect(computeOutcome(parsed.criterionVerdicts, []).outcome).toBe('failed');
  });

  it('returns unknown for every criterion when stdout is empty (crashed judge)', () => {
    const parsed = parseJudgeOutput('', contract);
    expect(parsed.criterionVerdicts.every((v) => v.status === 'unknown')).toBe(true);
  });

  it("reads a verdict out of the CLI's event-array output", () => {
    const parsed = parseJudgeOutput(
      eventArray(
        fenced({
          criterionVerdicts: [
            { criterionId: 'crit_1', status: 'met', reasoning: 'screenshot shows the note' },
          ],
        }),
      ),
      contract,
    );
    expect(parsed.criterionVerdicts.find((v) => v.criterionId === 'crit_1')?.status).toBe('met');
  });

  it('leaves criteria the judge skipped as unknown', () => {
    const parsed = parseJudgeOutput(
      envelope(
        fenced({
          criterionVerdicts: [
            { criterionId: 'crit_1', status: 'met', reasoning: 'saw it', evidence: [] },
          ],
        }),
      ),
      contract,
    );
    expect(parsed.criterionVerdicts.find((v) => v.criterionId === 'crit_1')?.status).toBe('met');
    expect(parsed.criterionVerdicts.find((v) => v.criterionId === 'crit_2')?.status).toBe(
      'unknown',
    );
    expect(parsed.criterionVerdicts.find((v) => v.criterionId === 'inv_1')?.reasoning).toMatch(
      /did not return a verdict/,
    );
  });

  it('ignores criterion ids that are not in the contract', () => {
    const parsed = parseJudgeOutput(
      envelope(
        fenced({
          criterionVerdicts: [{ criterionId: 'crit_99', status: 'met', reasoning: 'invented' }],
        }),
      ),
      contract,
    );
    expect(parsed.criterionVerdicts.map((v) => v.criterionId)).toEqual([
      'crit_1',
      'crit_2',
      'inv_1',
    ]);
    expect(parsed.criterionVerdicts.every((v) => v.status === 'unknown')).toBe(true);
  });

  it('ignores an invented status, keeping the seeded unknown', () => {
    const parsed = parseJudgeOutput(
      envelope(
        fenced({
          criterionVerdicts: [{ criterionId: 'crit_1', status: 'mostly met', reasoning: 'hmm' }],
        }),
      ),
      contract,
    );
    expect(parsed.criterionVerdicts[0].status).toBe('unknown');
  });

  it('collects human decisions and drops entries with no question', () => {
    const parsed = parseJudgeOutput(
      envelope(
        fenced({
          criterionVerdicts: [],
          humanDecisions: [
            { question: 'Works but takes six clicks — accept?', context: 'seen by naive-user-2' },
            { context: 'no question' },
          ],
        }),
      ),
      contract,
    );
    expect(parsed.humanDecisions).toHaveLength(1);
    expect(parsed.humanDecisions[0].question).toMatch(/six clicks/);
  });

  /**
   * H6a — the judge is shown the questions already open on the task, so it can
   * say "that is the one you already have" instead of re-raising it. The claim
   * is kept in the verdict (it is what the judge said); appendHumanDecisions is
   * what declines to write another card for it.
   */
  it("keeps the judge's own duplicate declaration", () => {
    const parsed = parseJudgeOutput(
      envelope(
        fenced({
          criterionVerdicts: [],
          humanDecisions: [
            {
              question: 'Still six clicks to save — accept?',
              context: 'same as before',
              duplicateOf: 'dec_7',
            },
            { question: 'Deleting a project asks twice — intended?', context: 'new' },
          ],
        }),
      ),
      contract,
    );
    expect(parsed.humanDecisions[0].duplicateOf).toBe('dec_7');
    expect(parsed.humanDecisions[1].duplicateOf).toBeNull();
  });
});

describe('outcome computation', () => {
  const allMet = contract.criteria.map((c) => ({
    criterionId: c.id,
    status: 'met' as const,
    reasoning: 'evidence seen',
    evidence: ['personas/spec-auditor/shots/01-goto.png'],
  }));

  it('passes only when every criterion is met', () => {
    expect(computeOutcome(allMet, [report({})]).outcome).toBe('passed');
  });

  it('fails on a single unknown', () => {
    const one = [...allMet];
    one[1] = { ...one[1], status: 'unknown' as unknown as 'met' };
    const { outcome, reasons } = computeOutcome(one, [report({})]);
    expect(outcome).toBe('failed');
    expect(reasons[0]).toMatch(/crit_2=unknown/);
  });

  it('fails on a blocker finding even with every criterion met', () => {
    const withBlocker = report({
      findings: [
        {
          severity: 'blocker',
          summary: 'lost my typed note on reload',
          evidence: [],
          criterionId: null,
        },
      ],
    });
    const { outcome, reasons } = computeOutcome(allMet, [withBlocker]);
    expect(outcome).toBe('failed');
    expect(reasons.some((r) => r.includes('blocker'))).toBe(true);
  });

  it('fails when the spec-auditor run is invalid', () => {
    const { outcome, reasons } = computeOutcome(allMet, [
      report({ charter: 'spec-auditor', invalid: true }),
    ]);
    expect(outcome).toBe('failed');
    expect(reasons.some((r) => r.includes('load-bearing'))).toBe(true);
  });

  it('fails when the saboteur run is invalid', () => {
    expect(computeOutcome(allMet, [report({ charter: 'saboteur', invalid: true })]).outcome).toBe(
      'failed',
    );
  });

  it("does NOT auto-fail on an invalid naive-user run — that is the judge's call", () => {
    const { outcome } = computeOutcome(allMet, [
      report({ charter: 'naive-user', invalid: true }),
      report({}),
    ]);
    expect(outcome).toBe('passed');
  });
});

describe('judge model separation', () => {
  it('refuses to run without an explicit judge model', () => {
    expect(() => assertJudgeModel(null, null)).toThrow(/judgeModel is not set/);
    expect(() => assertJudgeModel('   ', null)).toThrow(/judgeModel is not set/);
  });

  it("refuses when the judge model equals the builder's", () => {
    expect(() => assertJudgeModel('opus', 'opus')).toThrow(/same model the builder used/);
  });

  it('refuses the sentinel that stands for the CLI default builder model', () => {
    expect(() => assertJudgeModel('default', null)).toThrow(/same model the builder used/);
  });

  it('accepts a distinct judge model', () => {
    expect(assertJudgeModel(' opus ', null)).toBe('opus');
    expect(assertJudgeModel('opus', 'sonnet')).toBe('opus');
  });

  it("the daemon's own defaults (judge opus, worker sonnet) satisfy the separation", () => {
    const { judgeModel } = loadConfig().execution.harness;
    const { workerModel } = loadConfig().execution;
    expect(assertJudgeModel(judgeModel, workerModel)).toBe('opus');
  });

  it('refuses a workerModel misconfigured to equal judgeModel', () => {
    const { judgeModel } = loadConfig().execution.harness;
    expect(() => assertJudgeModel(judgeModel, judgeModel)).toThrow(/same model the builder used/);
  });
});

describe('roster', () => {
  it('smoke mode is naive-user ×1 plus the spec-auditor', () => {
    expect(buildRoster(true, 3).map((s) => s.name)).toEqual(['naive-user-1', 'spec-auditor']);
  });

  it('the full roster runs the configured number of naive users, each with its own seed', () => {
    const roster = buildRoster(false, 3);
    // Auditor first: the only charter that can mark criteria met must run
    // before a quota-starved panel dies on colour commentary.
    expect(roster.map((s) => s.name)).toEqual([
      'spec-auditor',
      'naive-user-1',
      'naive-user-2',
      'naive-user-3',
      'saboteur',
      'returning-user',
      'visual-critic',
    ]);
    const seeds = roster.filter((s) => s.charter === 'naive-user').map((s) => s.personaSeed);
    expect(new Set(seeds).size).toBe(3);
    // Exactly one charter may mark criteria met.
    expect(roster.filter((s) => s.charter === 'spec-auditor')).toHaveLength(1);
  });
});
