/**
 * Discovery — the brief's conversation, conducted as **question forms**
 * (UX spec F1 step 2), never as a chat interrogation.
 *
 * One agent pass takes the composer prompt plus everything already answered and
 * returns either the next `DiscoveryForm` or `null` for "I know enough". The
 * pass is short, toolless-by-prompt and gated by the governor like every other
 * spawn (build brief §4 principle 9) — the same `claimSpawn` → `spawnAgent` →
 * `parseCliJsonReply` → zod shape adoption uses, because a second way to call
 * a model is a second way to escape the governor.
 *
 * The agent is *required* to include the shape-confirming question on the first
 * form, because the answer sets `project.shape` and the whole pipeline reads it.
 * Nothing is regex'd out of prose; the JSON block is the contract (brief §8).
 *
 * The brief itself is `data/projects/<id>/brief.json` — the central project dir,
 * so a builder cannot read the unrefined ask and skip the contract.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  type Brief,
  type DiscoveryAnswers,
  type DiscoveryForm,
  type DiscoveryTurn,
  type ProjectShape,
  type RunFailureCause,
  SHAPE_LABELS,
  SHAPE_QUESTION_ID,
  YOU_DECIDE,
  isAnswered,
  isProjectShape,
  validateAnswerAgainstQuestion,
} from '@ligma/api';
import { z } from 'zod';
import { parseCliJsonReply } from '../harness/personas';
import { CENTRAL_PROJECTS_DIR } from '../paths';
import { generateId } from '../store/ids';
import { loadConfig } from './config';
import { GovernorAbort, claimSpawn, deferralFields } from './quota-governor';
import { AgentRunner, modelForBackend } from './runner';
import { enforcePromptLimit } from './security';

const ASK_MAX_TURNS = 3;
const ASK_TIMEOUT_MINUTES = 5;
/** Discovery must converge; past this the brief locks on what it has. */
export const MAX_DISCOVERY_TURNS = 3;

// ─── Brief store ─────────────────────────────────────────────────────────────

function safe(id: string): string {
  const base = path.basename(id);
  if (!base || base === '.' || base === '..') throw new Error(`Unsafe id: ${id}`);
  return base;
}

export function briefPath(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, safe(projectId), 'brief.json');
}

export function readBrief(projectId: string): Brief | null {
  const file = briefPath(projectId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8')) as Brief;
}

export function writeBrief(brief: Brief): Brief {
  const file = briefPath(brief.projectId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(brief, null, 2)}\n`, 'utf-8');
  return brief;
}

export function newBrief(projectId: string, prompt: string, kind: string | null): Brief {
  const now = new Date().toISOString();
  return {
    id: generateId('brf'),
    projectId,
    prompt,
    kind,
    shape: null,
    status: 'discovery',
    turns: [],
    constraints: [],
    createdAt: now,
    updatedAt: now,
    lockedAt: null,
    compiledAt: null,
    staleFlaggedAt: null,
  };
}

// ─── The agent pass ──────────────────────────────────────────────────────────

/** Injectable so tests drive the whole flow without spend — adoption's pattern. */
export interface DiscoveryAgents {
  /** The next form, or null when discovery has learned enough. */
  ask(brief: Brief): Promise<DiscoveryForm | null>;
}

const questionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(300),
  // Kept in lockstep with `DiscoveryQuestionType` in packages/api/src/briefs.ts
  // — this enum's inferred type is assigned into that one on every discovery
  // pass, so the two lists must match exactly.
  type: z.enum([
    'single',
    'multi',
    'select',
    'text',
    'textarea',
    'number',
    'range',
    'date',
    'time',
    'url',
    'email',
    'tel',
    'switch',
  ]),
  options: z.array(z.string().min(1).max(200)).max(12).default([]),
  required: z.boolean().default(false),
  help: z.string().max(400).default(''),
});

/** The discovery reply contract. Exported so the accepted control types are testable. */
export const discoveryReplySchema = z.object({
  /** false ends discovery; the form is then ignored. */
  needMore: z.boolean(),
  form: z
    .object({
      title: z.string().min(1).max(200).default('A few questions'),
      description: z.string().max(600).default(''),
      questions: z.array(questionSchema).min(1).max(8),
    })
    .nullable()
    .default(null),
});

/**
 * The shape question, appended by us rather than trusted to the model: its id
 * and its option set are what `project.shape` is read from, so they cannot be
 * left to a generative pass.
 */
export function shapeQuestion(): {
  id: string;
  label: string;
  type: 'single';
  options: string[];
  required: true;
  help: string;
} {
  return {
    id: SHAPE_QUESTION_ID,
    label: 'What is this, shaped like?',
    type: 'single',
    options: Object.values(SHAPE_LABELS),
    required: true,
    help: 'This decides the pipeline — a headless project never gets a Studio stage. Changeable later in Knowledge.',
  };
}

/** Map a shape answer back to the shape. Label lookup, never a keyword match. */
export function shapeFromAnswer(answer: string | string[] | undefined): ProjectShape | null {
  if (typeof answer !== 'string') return null;
  for (const [shape, label] of Object.entries(SHAPE_LABELS)) {
    if (label === answer && isProjectShape(shape)) return shape;
  }
  return isProjectShape(answer) ? answer : null;
}

/** The "you decide" sentinel, rendered for a downstream prompt or constraint
 *  list rather than echoed as if it were the human's own words. */
function describeAnswer(a: string | string[] | undefined): string {
  if (Array.isArray(a))
    return a.map((v) => (v === YOU_DECIDE ? '(left to you to decide)' : v)).join(', ');
  if (a === YOU_DECIDE) return '(left to you to decide)';
  return a ?? '(skipped)';
}

export function buildDiscoveryPrompt(brief: Brief): string {
  const answered = brief.turns
    .filter((t) => t.answers !== null)
    .flatMap((t) =>
      t.form.questions.map((q) => {
        const a = t.answers?.[q.id];
        return `- ${q.label}: ${describeAnswer(a)}`;
      }),
    );

  const lines = [
    'You are running discovery for a new software product. Your job is to ask the',
    'few questions that would change how the product gets built — nothing else.',
    '',
    `The person asked for:\n${brief.prompt}`,
    brief.kind ? `\nThey tagged it as: ${brief.kind}` : '',
    answered.length > 0 ? `\nAlready answered:\n${answered.join('\n')}` : '',
    '',
    'Ask at most 5 questions. Prefer finite choices over free text. Never ask what',
    '',
    'Control types: "single" (radios, 2-6 choices), "select" (dropdown, 7+ choices),',
    '"multi" (checkboxes), "text" (one line), "textarea" (prose), "number" (a quantity),',
    '"range" (a bounded slider), "date", "time", "url", "email", "tel" (a formatted',
    'one-liner), "switch" (yes/no). The choice types require "options"; every other',
    'type ignores it.',
    'you could decide yourself, and never ask the same thing twice. Do not ask what',
    'shape the product is — that question is added for you.',
    '',
    'Do not use any tools. Reply with NOTHING but a single fenced JSON block in',
    'exactly this shape:',
    '```json',
    '{',
    '  "needMore": true,',
    '  "form": {',
    '    "title": "A few questions",',
    '    "description": "So the build starts from the right assumptions.",',
    '    "questions": [',
    '      { "id": "auth", "label": "Who signs in?", "type": "single",',
    '        "options": ["Nobody — it is public", "One admin", "Many accounts"],',
    '        "required": true, "help": "" }',
    '    ]',
    '  }',
    '}',
    '```',
    'Set "needMore" to false and "form" to null when you have enough to write a brief.',
  ];
  return enforcePromptLimit(lines.filter((l) => l !== '').join('\n'));
}

/**
 * The user's locked scoping answers, verbatim — every discovery answer except
 * the shape question (that routes the pipeline, it does not scope the
 * product) plus every free-text constraint typed onto the locked brief.
 *
 * Downstream prompt-builders (studio, promote) must carry these as hard
 * constraints rather than paraphrasing or dropping them: "no rounding" typed
 * by a human answering a form is a fact the plan does not get to soften.
 * Structured in, structured out — nothing here is parsed from prose.
 */
export function lockedConstraints(brief: Brief): string[] {
  const answers = brief.turns
    .filter((t) => t.answers !== null)
    .flatMap((t) =>
      t.form.questions
        .filter((q) => q.id !== SHAPE_QUESTION_ID)
        .map((q) => {
          const a = t.answers?.[q.id];
          // "You decide" is a delegation, not a fact the human typed — it must
          // never ride along as a hard constraint the plan cannot soften.
          if (
            !isAnswered(a) ||
            a === YOU_DECIDE ||
            (Array.isArray(a) && a.every((v) => v === YOU_DECIDE))
          ) {
            return null;
          }
          return `${q.label}: ${Array.isArray(a) ? a.join(', ') : a}`;
        }),
    )
    .filter((line): line is string => line !== null);
  return [...answers, ...brief.constraints];
}

/**
 * How a failed discovery pass reaches the client.
 *
 * Additive to the 502 both brief routes already answered with — the same
 * `brief` and `error`, plus the class the one failure-card family renders.
 * A governor denial reports itself (calm, with a resume time); anything else
 * is the pass malfunctioning, which the amber "not a verdict on your brief"
 * card already says better than a red one would.
 */
export function discoveryFailure(err: unknown): {
  error: string;
  causeKind: RunFailureCause;
  resumesAt: string | null;
} {
  const error = err instanceof Error ? err.message : String(err);
  if (err instanceof GovernorAbort)
    return { error, causeKind: err.causeKind, resumesAt: err.resumesAt };
  return { error, causeKind: 'harness', resumesAt: null };
}

export function liveDiscoveryAgents(cwd: string): DiscoveryAgents {
  return {
    async ask(brief) {
      // The claim does NOT wait. Both entrances to this are HTTP requests the
      // browser is holding open — the composer's submit and the answers POST —
      // and the old 20-minute `awaitClaimedSlot` outlived even the web proxy's
      // ceiling, so a governor decision already made arrived as a hung request
      // instead of an answer. `GovernorAbort` carries the cause; the routes
      // re-raise it as a deferral the brief thread can render and retry.
      const decision = claimSpawn('builder', { ref: `brief/${brief.id}` });
      if (!decision.allowed) {
        throw new GovernorAbort(
          `the governor is holding sessions back (${decision.reason}) — discovery did not run`,
          deferralFields(decision),
        );
      }
      const result = await new AgentRunner(cwd).spawnAgent({
        prompt: buildDiscoveryPrompt(brief),
        maxTurns: ASK_MAX_TURNS,
        timeoutMinutes: ASK_TIMEOUT_MINUTES,
        skipPermissions: false,
        role: 'discovery',
        cwd,
        backend: decision.backend,
        model: modelForBackend(decision.backend, loadConfig().execution.workerModel),
      });
      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(
          `discovery failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''})`,
        );
      }
      const parsed = discoveryReplySchema.parse(parseCliJsonReply(result.stdout, 'discovery'));
      if (!parsed.needMore || !parsed.form) return null;
      return { id: generateId('frm'), ...parsed.form };
    },
  };
}

/**
 * A fixed two-question form, no model involved.
 *
 * ponytail: one env switch instead of a DI container. The web e2e run boots the
 * daemon with `LIGMA_DISCOVERY_STUB=1` so a nav crawl can submit the composer
 * without spawning an agent. Unit tests pass their own `agents` and never reach
 * this. Upgrade path if stubs ever need to vary: a fixtures dir keyed by prompt.
 */
export function stubDiscoveryAgents(): DiscoveryAgents {
  return {
    async ask(brief) {
      if (brief.turns.length > 0) return null;
      return {
        id: 'frm_stub',
        title: 'A few questions',
        description: 'Stubbed discovery — no agent was spawned.',
        questions: [
          {
            id: 'audience',
            label: 'Who is this for?',
            type: 'text',
            options: [],
            required: true,
            help: '',
          },
        ],
      };
    },
  };
}

/** The agents a route should use: the stub under the e2e switch, else live. */
export function discoveryAgents(): DiscoveryAgents | undefined {
  return process.env.LIGMA_DISCOVERY_STUB === '1' ? stubDiscoveryAgents() : undefined;
}

// ─── The turn ────────────────────────────────────────────────────────────────

export interface DiscoveryOptions {
  agents?: DiscoveryAgents;
  cwd?: string;
}

/**
 * Run one discovery pass and append the form it produced. Returns the brief with
 * an open turn, or unchanged when discovery is finished. The shape question is
 * carried on the first form and never asked twice.
 */
export async function askNextForm(brief: Brief, opts: DiscoveryOptions = {}): Promise<Brief> {
  if (brief.status !== 'discovery') return brief;
  if (brief.turns.some((t) => t.answers === null)) return brief;

  const shapeAsked = brief.turns.some((t) =>
    t.form.questions.some((q) => q.id === SHAPE_QUESTION_ID),
  );
  if (brief.turns.length >= MAX_DISCOVERY_TURNS && shapeAsked) return brief;

  const agents = opts.agents ?? liveDiscoveryAgents(opts.cwd ?? process.cwd());
  const form = await agents.ask(brief);

  // Discovery is done, but the shape must still be confirmed by a human — it is
  // the one answer the pipeline cannot infer its way around.
  const questions = form ? [...form.questions] : [];
  if (!shapeAsked) questions.unshift(shapeQuestion());
  if (questions.length === 0) return brief;

  const asked: DiscoveryForm = form
    ? { ...form, questions }
    : {
        id: generateId('frm'),
        title: 'One last thing',
        description: 'Confirm the shape and the brief is ready to lock.',
        questions,
      };

  const turn: DiscoveryTurn = {
    form: asked,
    answers: null,
    askedAt: new Date().toISOString(),
    answeredAt: null,
  };
  return { ...brief, turns: [...brief.turns, turn], updatedAt: turn.askedAt };
}

/**
 * Record answers to the open form. Returns the brief and the shape the answers
 * confirmed, if any — the caller PATCHes the project with it, because the
 * project store is not this module's to write.
 */
export function applyAnswers(
  brief: Brief,
  formId: string,
  answers: DiscoveryAnswers,
): { brief: Brief; shape: ProjectShape | null } {
  const index = brief.turns.findIndex((t) => t.answers === null);
  if (index === -1) throw new Error('No open discovery form');
  if (brief.turns[index].form.id !== formId) {
    throw new Error('That form is no longer the open one');
  }
  const now = new Date().toISOString();
  const turns = brief.turns.map((t, i) => (i === index ? { ...t, answers, answeredAt: now } : t));
  const shape = shapeFromAnswer(answers[SHAPE_QUESTION_ID]) ?? brief.shape;
  return {
    brief: { ...brief, turns, shape, updatedAt: now },
    shape: shape === brief.shape ? null : shape,
  };
}

/**
 * Amend one already-answered question — the thread's "edit this answer"
 * affordance. Deliberately the mirror image of `applyAnswers`: that one only
 * accepts the currently *open* form (and refuses a stale one with "That form
 * is no longer the open one"), this one only ever targets a turn that has
 * already `answered` — the open form still goes through `applyAnswers`.
 *
 * A locked brief is not a reason to refuse the edit; it is the reason
 * `staleFlaggedAt` gets set here, which is the Deck card that tells the human
 * their locked brief just moved under the designs and tasks built from it
 * (build brief §16 Phase 2 — the amend path).
 */
export function applyAmendment(
  brief: Brief,
  formId: string,
  questionId: string,
  answer: string | string[],
): { brief: Brief; shape: ProjectShape | null; staleFlagged: boolean; questionLabel: string } {
  const index = brief.turns.findIndex((t) => t.answers !== null && t.form.id === formId);
  if (index === -1) throw new Error('That form is no longer the open one');
  const turn = brief.turns[index];
  const question = turn.form.questions.find((q) => q.id === questionId);
  if (!question) throw new Error(`Unknown question: ${questionId}`);
  if (!validateAnswerAgainstQuestion(question, answer)) {
    throw new Error(`That answer does not fit "${question.label}"`);
  }

  const now = new Date().toISOString();
  const turns = brief.turns.map((t, i) =>
    i === index
      ? { ...t, answers: { ...(t.answers as DiscoveryAnswers), [questionId]: answer } }
      : t,
  );

  // Re-derive the shape exactly like applyAnswers: the shape question is
  // answerable like any other, and the whole pipeline reads project.shape.
  const shape =
    questionId === SHAPE_QUESTION_ID ? (shapeFromAnswer(answer) ?? brief.shape) : brief.shape;

  // Only a locked brief raises the flag — a brief still in discovery has
  // nothing downstream to flag yet, and a raised flag is never lowered by a
  // later amendment (same rule the manual PATCH edit already keeps).
  const staleFlaggedAt =
    brief.status === 'locked' ? (brief.staleFlaggedAt ?? now) : brief.staleFlaggedAt;

  return {
    brief: { ...brief, turns, shape, updatedAt: now, staleFlaggedAt },
    shape: shape === brief.shape ? null : shape,
    staleFlagged: staleFlaggedAt !== brief.staleFlaggedAt,
    questionLabel: question.label,
  };
}
