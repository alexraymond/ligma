/**
 * The critique lane — a panel of judges, one lane each.
 *
 * It began as a single critic (merger spec: "critique theater (single-critic
 * first)"); this is the planned upgrade. Upstream ran five panelists behind a
 * settings toggle (OD-051/OD-053); ours runs three, always on, and each one is
 * a separate structured-output turn with its own rubric rather than one turn
 * asked to hold five hats at once:
 *
 *  - `craft-rules` — the original critic, unchanged: the vendored `craft/`
 *    rule slugs plus the design system's manifest.
 *  - `design-system-fidelity` — the selected package's own tokens, read order
 *    and component inventory (`./design-system-context`, the same material the
 *    generator now receives), so the rubric is the package itself rather than
 *    a model's memory of it. Skipped as not-applicable when no package is in
 *    use — there is nothing to be faithful to.
 *  - `accessibility` — the body of `craft/accessibility-baseline.md`.
 *
 * Three properties are non-negotiable:
 *
 *  - **Governed.** Every lane is a spawn, and every spawn passes the governor
 *    (build brief §4 principle 9 — "no exceptions" explicitly includes critic
 *    passes). Each lane claims its own `judge` slot; the panel is trimmed to
 *    what the window can afford *before* it starts, never halfway through.
 *  - **Fail-honest.** A lane that crashes, is denied, times out, or never
 *    submits produces `skipped`/`error` and a null score — never a low one.
 *    `error ≠ failed` (principle 12), and a denied lane is silence, not a
 *    zero: it is excluded from the mean rather than dragging it down.
 *  - **Stated.** The overall score is the simple mean of the lanes that
 *    actually scored, and the per-lane verdicts ride along on the report so
 *    the UI can show which lanes those were.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type CritiqueLaneReport,
  type CritiqueReport,
  DESIGN_SSE_EVENTS,
  type DesignCriticEvent,
  type DesignManifest,
} from '@ligma/api';
import { runTurn } from '@ligma/core/agent';
import { logger } from '../engine/logger';
import { GovernorAbort, remainingForRole } from '../engine/quota-governor';
import { awaitClaimedSlot } from '../harness/spawn-slot';
import { REPO_ROOT } from '../paths';
import { craftDir, craftRuleSlugs } from './craft';
import { writeCritiqueTranscript } from './critic-transcript';
import { designSystemContext } from './design-system-context';
import { emitStudio } from './events';
import { sourceDir } from './paths';
import { getStudioProvider } from './provider';
import { type SubmittedCritique, createCriticToolRegistry } from './tools';

/** The bar a design must clear to be worth approving. */
export const CRITIQUE_THRESHOLD = 75;

/** The panel, in the order it sits. Lane 1 alone is the original single critic. */
export const CRITIQUE_LANES = ['craft-rules', 'design-system-fidelity', 'accessibility'] as const;

export type CritiqueLaneId = (typeof CRITIQUE_LANES)[number];

const CRITIC_MODEL = process.env.LIGMA_STUDIO_CRITIC_MODEL ?? 'claude-sonnet-4-5';

/** Waiting 20 minutes for a slot to *grade* a design is not worth the wall time. */
const CRITIC_MAX_WAIT_MS = 3 * 60 * 1000;

/**
 * The craft rule slugs available to score against.
 *
 * The generator is shown the rule *bodies* the design system declares
 * (`./craft`, D7 OD-081); the critic is given the full slug list, because a
 * grader that can only cite the rules it was handed cannot notice a design
 * breaking one nobody selected.
 */
export { craftRuleSlugs as craftRules };

/**
 * Which lanes to run. `LIGMA_STUDIO_CRITIQUE_LANES` is a comma-separated lane
 * list; unset means the full panel.
 *
 * ponytail: an env knob rather than a `daemon-config.json` block — the studio
 * has no config section today and `LIGMA_STUDIO_CRITIC_MODEL` above is the
 * house pattern for tuning this pass. Promote it into `DaemonConfig.studio`
 * when a second studio knob wants to join it.
 */
export function configuredLanes(): CritiqueLaneId[] {
  const raw = process.env.LIGMA_STUDIO_CRITIQUE_LANES;
  if (raw === undefined) return [...CRITIQUE_LANES];
  const wanted = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name): name is CritiqueLaneId => (CRITIQUE_LANES as readonly string[]).includes(name));
  // An unusable list degrades to the single critic, never to no critique at
  // all: a typo in an env var must not silently stop grading designs.
  return wanted.length > 0 ? wanted : [CRITIQUE_LANES[0]];
}

/**
 * The lanes the governor window can afford this turn, longest-first.
 *
 * Asked *before* the first spawn (`remainingForRole` is a pure read) because
 * the alternative is finding out on lane 3 with two slots already spent. The
 * first lane always survives the trim — it is exactly the single-critic pass,
 * and the governor still gets the final word on it when it claims.
 */
function affordableLanes(planned: CritiqueLaneId[]): CritiqueLaneId[] {
  const remaining = remainingForRole('judge');
  if (remaining >= planned.length) return planned;
  return planned.slice(0, Math.max(1, remaining));
}

// ─── Rubrics ─────────────────────────────────────────────────────────────────

/** The design system's own statement of intent, when one is in use. */
async function designSystemBrief(slug: string | null): Promise<string> {
  if (!slug) return '';
  try {
    const manifest = await readFile(
      path.join(REPO_ROOT, 'design-systems', slug, 'manifest.json'),
      'utf-8',
    );
    return `\n\nThe design system in use is "${slug}". Its manifest:\n${manifest.slice(0, 4000)}`;
  } catch {
    return `\n\nThe design system in use is "${slug}" (its manifest could not be read — do not invent its rules).`;
  }
}

const PANEL_PREAMBLE = [
  'You are one panelist on the studio critique panel. You grade a design; you never edit it.',
  'Read the design source with `list_files` and `read_file`, then call `submit_critique` exactly once.',
  'Judge what is actually in the files. Never award points for intent, and never invent a rule that was not given to you.',
  `The threshold is ${CRITIQUE_THRESHOLD}. Say so honestly if the design is below it.`,
  'Score only your own lane. Another panelist covers the rest; a score you pad to cover their ground is a lie about yours.',
  '',
].join('\n');

/**
 * One lane's system prompt, or null when the lane has nothing to score (which
 * is a skip, not a zero).
 */
async function laneRubric(lane: CritiqueLaneId, manifest: DesignManifest): Promise<string | null> {
  const designSystem = manifest.designSystem;

  if (lane === 'craft-rules') {
    const rules = await craftRuleSlugs();
    return [
      PANEL_PREAMBLE,
      'Your lane is CRAFT. Typography, colour, spacing, hierarchy, state coverage, motion.',
      rules.length > 0
        ? `Score against these craft rules (use the slug verbatim as \`rule\`): ${rules.join(', ')}.`
        : 'Score against general craft: typography, colour, spacing, state coverage.',
      await designSystemBrief(designSystem),
    ].join('\n');
  }

  if (lane === 'design-system-fidelity') {
    if (!designSystem) return null;
    const context = await designSystemContext(designSystem);
    return [
      PANEL_PREAMBLE,
      `Your lane is DESIGN-SYSTEM FIDELITY against "${designSystem}". Nothing else.`,
      'The package below is your entire rubric: its tokens are the only palette, scale and radii this',
      'design is entitled to, and its components are the patterns it should be reproducing rather than',
      'reinventing. A hard-coded value where the package ships a token is the defect this lane exists to',
      'catch; so is a component rebuilt from scratch beside the one the package already provides.',
      'Use `design-system:<aspect>` as `rule` — one entry per aspect you assessed (tokens, components,',
      'typography, spacing, …). Cite the token or component by name.',
      await designSystemBrief(designSystem),
      context ||
        '\n(The package ships no readable token/component artifacts — score the manifest above only.)',
    ].join('\n');
  }

  // accessibility
  const rulebook = await readOptional(path.join(craftDir(), 'accessibility-baseline.md'));
  return [
    PANEL_PREAMBLE,
    'Your lane is ACCESSIBILITY. Contrast, semantics, focus visibility, keyboard reachability,',
    'touch-target size, motion safety, and the accessible name of every control.',
    rulebook
      ? 'The rulebook below is your rubric. Use `accessibility:<aspect>` as `rule` (contrast, semantics,\ntouch-targets, focus, …) and cite the element you measured.'
      : 'Score WCAG 2.2 AA. Use `accessibility:<aspect>` as `rule` and cite the element you measured.',
    rulebook
      ? `\n<craft-rule slug="accessibility-baseline">\n${rulebook.trim()}\n</craft-rule>`
      : '',
  ].join('\n');
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf-8');
  } catch {
    return null;
  }
}

// ─── The judge turn (the one seam a test replaces) ───────────────────────────

export interface LaneJudgeRequest {
  lane: CritiqueLaneId;
  systemPrompt: string;
  manifest: DesignManifest;
  signal: AbortSignal;
}

export interface LaneJudgeResult {
  /** Null when the panelist talked but never called `submit_critique`. */
  verdict: SubmittedCritique | null;
  /** Mirrors the agent loop's `TurnDone.stopReason`. */
  stopReason: string;
}

/** Runs one lane's structured-output turn. Injectable so tests spend no model turns. */
export type LaneJudge = (request: LaneJudgeRequest) => Promise<LaneJudgeResult>;

/** Claims one lane's governor slot. Injectable for the same reason. */
export type LaneSlotClaim = (lane: CritiqueLaneId, designId: string) => Promise<string>;

const claimJudgeSlot: LaneSlotClaim = (lane, designId) =>
  awaitClaimedSlot('judge', {
    label: `studio critique (${lane}) for ${designId}`,
    ref: `studio-critique/${designId}/${lane}`,
    maxWaitMs: CRITIC_MAX_WAIT_MS,
  });

const spawnLaneJudge: LaneJudge = async ({ systemPrompt, manifest, signal }) => {
  let verdict: SubmittedCritique | null = null;
  const cwd = sourceDir(manifest.projectId, manifest.id);
  const registry = createCriticToolRegistry(cwd, (submitted) => {
    verdict = submitted;
  });

  const provider = await getStudioProvider()({
    systemPrompt,
    prompt: `Critique the design "${manifest.title}". Its brief was: ${manifest.sourcePrompt || '(none given)'}`,
    registry,
    cwd,
    signal,
    model: CRITIC_MODEL,
  });

  let stopReason = 'stop';
  for await (const event of runTurn({ provider, tools: registry, signal })) {
    if (event.type === 'turn_done') stopReason = event.stopReason;
  }
  return { verdict, stopReason };
};

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * The panel's one verdict. The score is the simple mean of the lanes that
 * scored — a skipped or errored lane contributes nothing, in either direction.
 */
export function aggregateCritique(
  lanes: CritiqueLaneReport[],
  designSystem: string | null,
  startedAt: string,
): CritiqueReport {
  const rules = lanes.flatMap((lane) => lane.rules);
  const base = {
    threshold: CRITIQUE_THRESHOLD,
    rules,
    designSystem,
    startedAt,
    finishedAt: new Date().toISOString(),
    lanes,
  };

  const scored = lanes.filter((lane) => lane.status === 'scored' && lane.score !== null);
  if (scored.length > 0) {
    const mean = scored.reduce((sum, lane) => sum + (lane.score ?? 0), 0) / scored.length;
    return { ...base, status: 'scored', score: Math.round(mean), error: null };
  }
  if (lanes.some((lane) => lane.status === 'interrupted')) {
    return { ...base, status: 'interrupted', score: null, error: null };
  }
  const why = lanes.map((lane) => `${lane.lane}: ${lane.error ?? lane.status}`).join('; ');
  return { ...base, status: 'error', score: null, error: why || 'no critique lane ran' };
}

// ─── The pass ────────────────────────────────────────────────────────────────

export interface CritiquePassDeps {
  /** Test seam — defaults to a real governed model turn. */
  judge?: LaneJudge;
  /** Test seam — defaults to the governor's atomic claim. */
  claimSlot?: LaneSlotClaim;
}

function emitCritic(designId: string, event: DesignCriticEvent): void {
  emitStudio(designId, DESIGN_SSE_EVENTS.critic, event);
}

function skippedLane(
  lane: CritiqueLaneId,
  reason: 'quota' | 'not-applicable',
  message: string,
): CritiqueLaneReport {
  return { lane, status: 'skipped', score: null, rules: [], skipReason: reason, error: message };
}

/**
 * Run one critique pass — every configured lane, in order. Never throws: a
 * malfunction comes back as an errored lane (and, if every lane failed, an
 * errored report), because a thrown critic would otherwise fail the whole turn
 * and lose a design that is perfectly fine.
 */
export async function runCritiquePass(
  manifest: DesignManifest,
  turnId: string,
  signal: AbortSignal,
  deps: CritiquePassDeps = {},
): Promise<CritiqueReport> {
  const startedAt = new Date().toISOString();
  const designId = manifest.id;
  const designSystem = manifest.designSystem;
  const judge = deps.judge ?? spawnLaneJudge;
  const claimSlot = deps.claimSlot ?? claimJudgeSlot;
  const base = {
    designId,
    turnId,
    threshold: CRITIQUE_THRESHOLD,
    rule: null,
    score: null,
    error: null,
    lane: null as string | null,
  };

  // Every event emitted below also lands in `transcript`, persisted in the
  // `finally` below regardless of which of this function's exits is taken —
  // that persisted `.ndjson` is what the critique lane's Replay control reads
  // back (`./critic-transcript`).
  const transcript: DesignCriticEvent[] = [];
  const record = (event: DesignCriticEvent): void => {
    transcript.push(event);
    emitCritic(designId, event);
  };

  record({ ...base, phase: 'start', status: 'running' });

  const planned = configuredLanes();
  const affordable = affordableLanes(planned);
  const reports: CritiqueLaneReport[] = [];

  try {
    for (const lane of planned) {
      if (signal.aborted) {
        reports.push({ lane, status: 'interrupted', score: null, rules: [], error: null });
      } else if (!affordable.includes(lane)) {
        const message = `skipped — the governor window can afford ${affordable.length} of ${planned.length} critique lane(s) this turn`;
        logger.warn('studio', `Critique lane ${lane} for ${designId} ${message}`);
        reports.push(skippedLane(lane, 'quota', message));
      } else {
        reports.push(await runLane(lane, manifest, signal, judge, claimSlot, base, record));
      }
      const laneReport = reports[reports.length - 1]!;
      record({ ...base, phase: 'lane', status: 'running', lane: laneReport.lane, laneReport });
    }

    const report = aggregateCritique(reports, designSystem, startedAt);
    record({
      ...base,
      phase: 'end',
      status: report.status,
      score: report.score,
      error: report.error,
    });
    return report;
  } finally {
    try {
      await writeCritiqueTranscript(manifest.projectId, designId, turnId, transcript);
    } catch (err) {
      logger.warn(
        'studio',
        `Critique transcript for ${designId}/${turnId} could not be written: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** One panelist, start to verdict. Never throws — every exit is a report. */
async function runLane(
  lane: CritiqueLaneId,
  manifest: DesignManifest,
  signal: AbortSignal,
  judge: LaneJudge,
  claimSlot: LaneSlotClaim,
  base: Omit<DesignCriticEvent, 'phase' | 'status'>,
  record: (event: DesignCriticEvent) => void,
): Promise<CritiqueLaneReport> {
  const designId = manifest.id;
  record({ ...base, phase: 'start', status: 'running', lane });

  let systemPrompt: string | null;
  try {
    systemPrompt = await laneRubric(lane, manifest);
  } catch (err) {
    const message = `rubric could not be assembled: ${err instanceof Error ? err.message : String(err)}`;
    return { lane, status: 'error', score: null, rules: [], error: message };
  }
  if (systemPrompt === null) {
    // Nothing to score against. Costs no slot and says so in words.
    return skippedLane(
      lane,
      'not-applicable',
      'no design system in use — nothing to score fidelity against',
    );
  }

  try {
    const backend = await claimSlot(lane, designId);
    logger.info('studio', `Critique lane ${lane} for ${designId} claimed a ${backend} judge slot`);
  } catch (err) {
    // A governor denial is a harness condition, not a design defect.
    if (err instanceof GovernorAbort) {
      const message = `skipped — ${err.message}`;
      logger.warn('studio', message);
      return skippedLane(lane, 'quota', message);
    }
    const message = `could not claim a governor slot: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn('studio', message);
    return { lane, status: 'error', score: null, rules: [], error: message };
  }

  try {
    const { verdict, stopReason } = await judge({ lane, systemPrompt, manifest, signal });

    if (signal.aborted) {
      return { lane, status: 'interrupted', score: null, rules: verdict?.rules ?? [], error: null };
    }
    if (verdict === null) {
      // The panelist talked but never graded. That is a malfunction, and the
      // one thing we must not do is guess a number from whatever it said.
      return {
        lane,
        status: 'error',
        score: null,
        rules: [],
        error: `lane finished (${stopReason}) without calling submit_critique — no score was produced`,
      };
    }

    for (const rule of verdict.rules)
      record({ ...base, phase: 'rule', status: 'running', rule, lane });
    record({ ...base, phase: 'score', status: 'running', score: verdict.score, lane });
    return { lane, status: 'scored', score: verdict.score, rules: verdict.rules, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('studio', `Critique lane ${lane} for ${designId} malfunctioned: ${message}`);
    return { lane, status: 'error', score: null, rules: [], error: message };
  }
}
