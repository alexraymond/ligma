/**
 * judge.ts — one adversarial reviewer that turns evidence into a verdict.
 *
 * Three rules make this more than "ask a model if it's good":
 *
 * 1. The contract's Ed25519 signature is verified BEFORE anything else. A
 *    tampered contract aborts the run as an error — never as a pass.
 * 2. The judge runs on an explicitly different model from the builder. We refuse
 *    to run otherwise, because a model grading its own homework is not a check.
 * 3. The outcome is computed HERE, in code, from the per-criterion statuses. The
 *    model supplies evidence-backed statuses and reasoning; it does not get a
 *    vote on "passed". Default is fail: no affirmative evidence ⇒ "unknown" ⇒
 *    not passed.
 */

import type { RunFailureCause } from '@ligma/api';
import { AgentRunner } from '../engine/runner';
import { enforcePromptLimit } from '../engine/security';
import type { Backend } from '../engine/types';
import { verifyContract } from './contract-store';
import { parseCliJsonReply } from './personas';
import { sign } from './signing';
import { awaitClaimedSlot } from './spawn-slot';
import type {
  AcceptanceContract,
  CriterionVerdict,
  PersonaReport,
  VerificationVerdict,
} from './types';
import { openDecisionsForTask } from './verdict';

const STATUSES = new Set(['met', 'not-met', 'unknown']);

/** Charters whose failure means we have no idea whether the product works. */
const LOAD_BEARING_CHARTERS = new Set(['spec-auditor', 'saboteur']);

export interface JudgeOptions {
  contract: AcceptanceContract;
  reports: PersonaReport[];
  runId: string;
  /** Null for a journey run — the same judge, no task to attribute it to. */
  taskId: string | null;
  /** <data>/verification-runs/<runId> — the judge's cwd, so it can open evidence. */
  runDir: string;
  /** Evidence file paths relative to runDir. */
  evidenceIndex: string[];
  judgeModel: string | null;
  /** The builder's resolved model. null = the CLI default. */
  builderModel: string | null;
  maxTurns: number;
  timeoutMinutes: number;
  runner?: AgentRunner;
  /**
   * A governor slot already booked for this judge by whoever started the run.
   *
   * Claiming it here, at the end, is what starved the judge: by then its own
   * panel has spent the window it needs, so the wait below could burn 20 minutes
   * and abort with all the evidence collected and nothing adjudicated (C2). Null
   * keeps the old behaviour, which is right for a hand-started run.
   */
  claimedSlot?: Backend | null;
  /**
   * The judgement calls already open on this task, so the judge can point at one
   * instead of asking it again (H6). Defaulted in `runJudge` from the decisions
   * store; pass `[]` to show none, and leave it undefined in a hand-built call.
   */
  openDecisions?: Array<{ id: string; question: string }>;
  /**
   * HEAD of the PRODUCT repo, read by the caller at verdict time — what this
   * verdict is a statement about. Null for a product with no repo.
   *
   * It arrives here rather than being read here because the verdict is SIGNED in
   * this file: a commitSha attached after `signVerdict` would fall outside the
   * signed payload, and a field a verdict can be given afterwards is exactly the
   * kind of provenance claim the signature exists to prevent.
   */
  commitSha?: string | null;
  /**
   * Journey scope, when this run walked a journey rather than a task.
   *
   * Here for the same reason `commitSha` is: `run-journey.ts` used to spread
   * these onto the verdict AFTER `signVerdict`, so every journey verdict failed
   * `verify()` by construction (codebase audit E8). A field the verdict can be
   * given afterwards is exactly what the signature exists to prevent.
   */
  journeyId?: string | null;
  projectId?: string | null;
}

/**
 * Enforce judge ≠ builder (docs/history/CONTRACTS.md §6) and return the model to pass
 * as `--model`.
 *
 * Honest description of what this can and cannot check: `builderModel` is
 * whatever the caller resolved for its build step — `execution.workerModel`
 * for a task verification run, `null` when the run has no builder of its own
 * (a journey re-run against an already-built product). A null builder model is
 * treated as the sentinel "default", which no explicit judge model may equal.
 */
export function assertJudgeModel(judgeModel: string | null, builderModel: string | null): string {
  if (!judgeModel || judgeModel.trim() === '') {
    throw new Error(
      'harness.judgeModel is not set. The judge must run on a different model from the builder, ' +
        'so it has to be named explicitly in daemon-config.json (execution.harness.judgeModel).',
    );
  }
  const judge = judgeModel.trim();
  const builder = (builderModel ?? 'default').trim();
  if (judge === builder) {
    throw new Error(
      `Refusing to judge: judgeModel "${judge}" is the same model the builder used. A model cannot grade its own work (docs/history/CONTRACTS.md §6).`,
    );
  }
  return judge;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

/** Per-finding text cap: a saboteur pasting 10k chars must not become the prompt. */
const FINDING_TEXT_CAP = 600;
const MAX_FINDINGS_PER_REPORT = 20;

/** Least → most important. The judge cannot do its job without the top two. */
const CHARTER_RANK = ['naive-user', 'visual-critic', 'returning-user', 'saboteur', 'spec-auditor'];
const SEVERITY_RANK = ['note', 'minor', 'major', 'blocker'];

/** Cap the text a persona (or a page it quoted) controls, per finding. */
function slimReport(r: PersonaReport): PersonaReport {
  return {
    ...r,
    findings: r.findings.slice(0, MAX_FINDINGS_PER_REPORT).map((f) => ({
      ...f,
      summary:
        f.summary.length > FINDING_TEXT_CAP
          ? `${f.summary.slice(0, FINDING_TEXT_CAP)}… [truncated]`
          : f.summary,
      evidence: f.evidence.slice(0, 10),
    })),
  };
}

/** Findings dropped, criterion claims kept: the smallest useful form of a report. */
function digestReport(r: PersonaReport): PersonaReport {
  return { ...r, findings: [] };
}

/** Drop order: least important charter first, then least severe. */
function dropOrder(reports: PersonaReport[]): PersonaReport[] {
  const severity = (r: PersonaReport): number =>
    r.findings.reduce((max, f) => Math.max(max, SEVERITY_RANK.indexOf(f.severity)), -1);
  return [...reports].sort(
    (a, b) =>
      CHARTER_RANK.indexOf(a.charter) - CHARTER_RANK.indexOf(b.charter) ||
      severity(a) - severity(b),
  );
}

function judgePromptFor(opts: JudgeOptions, reports: PersonaReport[], omitted: string[]): string {
  const { contract, evidenceIndex } = opts;

  const invalid = reports.filter((r) => r.invalid);
  const lines = [
    'You are the judge on an acceptance panel. Several independent tester agents just used a running',
    'product through a browser bridge. You did not see the product. You see their reports and the',
    'evidence files they produced. Decide, criterion by criterion, whether the product does what the',
    'contract says — from evidence, not from plausibility.',
    '',
    '## The contract (frozen and signature-verified)',
    '',
    `Title: ${contract.title}`,
    `Contract: ${contract.id} version ${contract.version}`,
    '',
    ...contract.criteria.map(
      (c) => `- ${c.id} (${c.kind}${c.holdout ? ', withheld from the builder' : ''}): ${c.text}`,
    ),
    '',
    '## Persona reports',
    '',
    '```json',
    JSON.stringify(reports, null, 2),
    '```',
    '',
    '## Evidence files available to you',
    '',
    "Your working directory IS the run's evidence directory. You may open any of these with Read",
    "(screenshots included) if a report's claim needs checking:",
    '',
    ...evidenceIndex.slice(0, 400).map((f) => `- ${f}`),
    '',
    '## How to decide',
    '',
    '- `met` requires AFFIRMATIVE evidence: a persona did the thing and observed the promised result.',
    '- `not-met` means someone observed the product doing something else. Say what, concretely.',
    '- `unknown` is the default. No evidence, ambiguous evidence, or a claim with no screenshot behind it',
    '  is `unknown`. `unknown` counts as a failure, so you never need to stretch to `not-met`.',
    "- Only the spec-auditor's `criterionResults` are a direct claim about a criterion. Other charters give",
    '  you observations; use them as corroboration or contradiction, never as authority.',
    '- A persona report with `invalid: true` produced no usable evidence. Treat anything it would have',
    '  covered as untested.',
  ];

  if (invalid.length > 0) {
    lines.push(
      '',
      `IMPORTANT: ${invalid.length} of ${reports.length} persona runs are invalid (${invalid
        .map((r) => r.charter)
        .join(', ')}). You MUST state in your reasoning which criteria are weaker because of it.`,
    );
  }

  if (omitted.length > 0) {
    lines.push(
      '',
      `IMPORTANT: ${omitted.length} persona report(s) were too large to include (${omitted.join(', ')}).`,
      'Treat everything they would have covered as untested, and say so in your reasoning.',
    );
  }

  // H6a: without this the judge cannot know what it (or an earlier run) already
  // asked, so it asks again — 11 near-duplicate cards on one task, which parked
  // it. Answering with an id is a structured claim, not a text match.
  const open = opts.openDecisions ?? [];
  if (open.length > 0) {
    lines.push(
      '',
      '## Judgement calls already open on this task',
      '',
      'These are waiting on the human right now. Do NOT raise any of them again: leave it out, or —',
      'if you want it on the record — repeat it with `"duplicateOf": "<the id below>"` and no new card',
      'will be written for it.',
      '',
      ...open.slice(0, 40).map((d) => `- ${d.id}: ${d.question}`),
    );
  }

  lines.push(
    '',
    '## Required output',
    '',
    'Reply with NOTHING but a single fenced JSON block. One entry per criterion id above, no omissions:',
    '',
    '```json',
    '{',
    '  "criterionVerdicts": [',
    '    { "criterionId": "crit_1", "status": "met|not-met|unknown",',
    '      "reasoning": "what evidence made you say this, naming the persona and the file",',
    '      "evidence": ["personas/spec-auditor/shots/01-goto.png"] }',
    '  ],',
    '  "humanDecisions": [',
    '    { "question": "a judgement call no test can settle, e.g. works but is tedious — accept?",',
    '      "context": "what you saw that raises it",',
    '      "duplicateOf": "dec_… if this is one of the open calls listed above, else omit" }',
    '  ]',
    '}',
    '```',
    '',
    '`humanDecisions` is for things that are not failures but a person should look at. Leave it `[]` if',
    'there are none. Do not output an overall pass/fail — that is computed from your statuses.',
  );

  return lines.join('\n');
}

/**
 * The judge prompt, guaranteed to fit the 100KB argv budget every other prompt
 * in the daemon respects.
 *
 * Without this a saboteur that pastes 10k characters into a field pushes the
 * prompt past MAX_ARG_STRLEN, the spawn dies with E2BIG, and a perfectly good
 * build gets an "error" verdict. Degradation is ordered so the load-bearing
 * evidence survives: cap each finding's text, then drop the least important
 * charters, then keep only criterion claims. Whatever is lost is named in the
 * prompt so the judge downgrades those criteria instead of guessing.
 */
export function buildJudgePrompt(opts: JudgeOptions): string {
  let reports = opts.reports.map(slimReport);
  const omitted: string[] = [];
  const fits = (prompt: string): boolean => enforcePromptLimit(prompt) === prompt;

  let prompt = judgePromptFor(opts, reports, omitted);
  if (fits(prompt)) return prompt;

  // Drop the dispensable charters, least important first. The last two standing
  // are the ones computeOutcome treats as load-bearing.
  for (const candidate of dropOrder(reports)) {
    if (reports.length <= 2) break;
    reports = reports.filter((r) => r !== candidate);
    omitted.push(`${candidate.charter}${candidate.personaSeed ? ` (${candidate.runId})` : ''}`);
    prompt = judgePromptFor(opts, reports, omitted);
    if (fits(prompt)) return prompt;
  }

  // Still too big: keep the criterion claims, lose the prose.
  prompt = judgePromptFor(opts, reports.map(digestReport), [
    ...omitted,
    'findings text of all remaining reports',
  ]);
  return enforcePromptLimit(prompt);
}

// ─── Parsing (fail-closed) ───────────────────────────────────────────────────

/** Every criterion starts here. Anything the judge doesn't answer stays unknown. */
function unknownVerdict(criterionId: string, reasoning: string): CriterionVerdict {
  return { criterionId, status: 'unknown', reasoning, evidence: [] };
}

export interface ParsedJudgeOutput {
  criterionVerdicts: CriterionVerdict[];
  humanDecisions: VerificationVerdict['humanDecisions'];
  /**
   * Non-null when the reply could not be parsed at all. That is a HARNESS
   * malfunction (D3) — the caller turns it into outcome "error", never "failed".
   */
  parseError: string | null;
}

/**
 * Parse the judge's reply into one verdict per contract criterion.
 *
 * Fail-closed by construction: the result is seeded with `unknown` for every
 * criterion, and only an entry that parses cleanly can upgrade one. A completely
 * unparseable reply yields all-unknown AND a `parseError`, which the caller
 * reports as outcome "error" — an illegible judge says nothing about the
 * product, so it must not be signed as a product failure (D3).
 */
export function parseJudgeOutput(
  rawStdout: string,
  contract: AcceptanceContract,
): ParsedJudgeOutput {
  const byId = new Map<string, CriterionVerdict>(
    contract.criteria.map((c) => [
      c.id,
      unknownVerdict(c.id, 'The judge did not return a verdict for this criterion.'),
    ]),
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = parseCliJsonReply(rawStdout, "judge's reply");
  } catch (err) {
    const reason = `Judge output could not be parsed (${err instanceof Error ? err.message : String(err)}), so no criterion has affirmative evidence.`;
    for (const id of byId.keys()) byId.set(id, unknownVerdict(id, reason));
    return { criterionVerdicts: [...byId.values()], humanDecisions: [], parseError: reason };
  }

  const raw = Array.isArray(parsed.criterionVerdicts) ? parsed.criterionVerdicts : [];
  for (const entry of raw) {
    const e = entry as Record<string, unknown>;
    const id = typeof e.criterionId === 'string' ? e.criterionId : null;
    if (!id || !byId.has(id)) continue; // unknown ids are ignored, never invented
    const status = String(e.status);
    if (!STATUSES.has(status)) continue; // keeps the seeded "unknown"
    byId.set(id, {
      criterionId: id,
      status: status as CriterionVerdict['status'],
      reasoning:
        typeof e.reasoning === 'string' && e.reasoning.trim() !== ''
          ? e.reasoning
          : '(no reasoning given)',
      evidence: Array.isArray(e.evidence)
        ? e.evidence.filter((x): x is string => typeof x === 'string')
        : [],
    });
  }

  const humanDecisions = (Array.isArray(parsed.humanDecisions) ? parsed.humanDecisions : [])
    .map((d) => d as Record<string, unknown>)
    .filter((d) => typeof d.question === 'string' && d.question.trim() !== '')
    .map((d) => ({
      question: String(d.question),
      context: typeof d.context === 'string' ? d.context : '',
      // The id of a call already open on this task, as the judge named it. Kept
      // in the verdict; verdict.ts is what declines to write a second card.
      duplicateOf:
        typeof d.duplicateOf === 'string' && d.duplicateOf.trim() !== ''
          ? d.duplicateOf.trim()
          : null,
    }));

  return { criterionVerdicts: [...byId.values()], humanDecisions, parseError: null };
}

/**
 * The pass gate, in code. Passed requires ALL of:
 *   - every criterion "met" (so "unknown" and "not-met" both fail);
 *   - no blocker-severity finding anywhere in the panel;
 *   - no invalid run among the load-bearing charters (spec-auditor, saboteur).
 * An invalid naive-user run does not auto-fail — it degrades the evidence, and
 * the judge is instructed to say so.
 */
export function computeOutcome(
  criterionVerdicts: CriterionVerdict[],
  reports: PersonaReport[],
): { outcome: 'passed' | 'failed'; reasons: string[] } {
  const reasons: string[] = [];

  const notMet = criterionVerdicts.filter((v) => v.status !== 'met');
  if (notMet.length > 0) {
    reasons.push(
      `${notMet.length} criterion(a) not met: ${notMet.map((v) => `${v.criterionId}=${v.status}`).join(', ')}`,
    );
  }

  const blockers = reports.flatMap((r) =>
    r.findings.filter((f) => f.severity === 'blocker').map((f) => `${r.charter}: ${f.summary}`),
  );
  if (blockers.length > 0)
    reasons.push(`${blockers.length} blocker finding(s): ${blockers.join(' | ')}`);

  const brokenCharters = reports
    .filter((r) => r.invalid && LOAD_BEARING_CHARTERS.has(r.charter))
    .map((r) => r.charter);
  if (brokenCharters.length > 0) {
    reasons.push(`invalid run(s) for load-bearing charter(s): ${brokenCharters.join(', ')}`);
  }

  return { outcome: reasons.length === 0 ? 'passed' : 'failed', reasons };
}

/** The signed payload: everything except the signature itself. */
function unsignedPayload(verdict: VerificationVerdict): Omit<VerificationVerdict, 'signature'> {
  const { signature: _signature, ...rest } = verdict;
  return rest;
}

function signVerdict(unsigned: VerificationVerdict): VerificationVerdict {
  return { ...unsigned, signature: sign(unsignedPayload(unsigned)) };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export async function runJudge(opts: JudgeOptions): Promise<VerificationVerdict> {
  /**
   * A signed verdict that says "the harness broke", not "the product failed"
   * (D3). Same shape as any other verdict so it persists and verifies normally;
   * `outcome: "error"` is what distinguishes it, and the reason travels in every
   * criterion's reasoning so the evidence UI can show it.
   */
  const harnessError = (reason: string, causeKind: RunFailureCause): VerificationVerdict => {
    console.error(`[harness/judge] HARNESS ERROR — ${reason}`);
    return signVerdict({
      runId: opts.runId,
      taskId: opts.taskId,
      journeyId: opts.journeyId ?? null,
      projectId: opts.projectId ?? null,
      contractId: opts.contract.id,
      contractVersion: opts.contract.version,
      outcome: 'error',
      criterionVerdicts: opts.contract.criteria.map((c) =>
        unknownVerdict(c.id, `Harness error: ${reason}`),
      ),
      humanDecisions: [],
      judgeModel: opts.judgeModel ?? '(unresolved)',
      causeKind,
      commitSha: opts.commitSha ?? null,
      createdAt: new Date().toISOString(),
      signature: null,
    });
  };

  // Signature first: a tampered or unverifiable contract is a harness error, and
  // never — in either direction — a statement about the product.
  if (!verifyContract(opts.contract)) {
    return harnessError(
      `contract ${opts.contract.id} failed signature verification — refusing to judge against an unverifiable oracle`,
      'harness',
    );
  }

  const model = assertJudgeModel(opts.judgeModel, opts.builderModel);
  const runner = opts.runner ?? new AgentRunner(opts.runDir);

  // A slot claimed at the door is spent here, not queued for. Failing that, the
  // panel's sessions are already spent by the time we get here, so waiting for
  // quota beats throwing the evidence away. The kill switch still aborts.
  const backend =
    opts.claimedSlot ??
    (await awaitClaimedSlot('judge', { label: `judge for ${opts.runId}`, ref: opts.runId }));

  // Read here rather than in buildJudgePrompt, which stays pure: whoever starts
  // the run does not have to know the decisions store exists (H6a).
  const openDecisions = opts.openDecisions ?? openDecisionsForTask(opts.taskId);

  let result: Awaited<ReturnType<AgentRunner['spawnAgent']>>;
  try {
    result = await runner.spawnAgent({
      prompt: buildJudgePrompt({ ...opts, openDecisions }),
      maxTurns: opts.maxTurns,
      timeoutMinutes: opts.timeoutMinutes,
      skipPermissions: false,
      // Read-only, and rooted at the evidence dir: the judge may inspect evidence,
      // never touch the product or the repo.
      allowedTools: ['Read'],
      role: 'judge',
      cwd: opts.runDir,
      backend,
      model,
    });
  } catch (err) {
    // Includes the fail-closed throw from runner.buildArgs when the routed
    // backend cannot express "read-only" (D8).
    return harnessError(
      `judge spawn threw: ${err instanceof Error ? err.message : String(err)}`,
      'backend',
    );
  }

  if (result.exitCode !== 0 || result.timedOut) {
    // The stderr tail is the only surviving evidence of WHY once the ephemeral
    // env is torn down (attempt-5 lesson: a bare "exit 1" cost a full re-run).
    const stderrTail = result.stderr?.trim().slice(-400);
    return harnessError(
      `judge spawn failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}) on backend ${backend}${stderrTail ? ` — stderr: ${stderrTail}` : ''}`,
      'backend',
    );
  }

  const { criterionVerdicts, humanDecisions, parseError } = parseJudgeOutput(
    result.stdout,
    opts.contract,
  );
  if (parseError) return harnessError(parseError, 'parse');

  const { outcome, reasons } = computeOutcome(criterionVerdicts, opts.reports);
  if (outcome === 'failed') console.error(`[harness/judge] outcome failed: ${reasons.join('; ')}`);

  return signVerdict({
    runId: opts.runId,
    taskId: opts.taskId,
    journeyId: opts.journeyId ?? null,
    projectId: opts.projectId ?? null,
    contractId: opts.contract.id,
    contractVersion: opts.contract.version,
    outcome,
    criterionVerdicts,
    humanDecisions,
    judgeModel: model,
    commitSha: opts.commitSha ?? null,
    createdAt: new Date().toISOString(),
    signature: null,
  });
}
