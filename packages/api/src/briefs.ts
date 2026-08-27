/**
 * The Brief — "what you asked for" (UX spec §3), the project's first pipeline
 * stage: the composer prompt, refined by a discovery conversation, then locked.
 *
 * Discovery is a **form in the thread**, never a chat interrogation (F1 step 2):
 * the model returns a structured `DiscoveryForm` and the UI renders it as real
 * inputs. Nothing here is ever regex'd out of prose — the wire shape is the
 * contract (build brief §8).
 *
 * A locked brief is editable until a contract compiles against it. After that,
 * an edit **flags dependents stale** (Deck card) rather than invalidating them —
 * the pinned product default in build brief §2.
 *
 * Like `deck.ts`, this module carries a few pure functions rather than types
 * alone: the daemon validates answers before storing them and the web gates the
 * submit button, and the two must agree on what "answered" means.
 */

import type { ProjectShape } from './shapes';

// ─── Discovery question forms ────────────────────────────────────────────────

/**
 * The controls a discovery question can render as.
 *
 * Thirteen, not open-design's sixteen (D7 OD-033/OD-036 port): the original six
 * — a choice (`single` as radios, `select` as a dropdown when the list is
 * long), a set of choices (`multi`), prose (`text`, `textarea`) and a quantity
 * (`number`) — plus seven low-cost native inputs ported from the reference
 * (`range`, `date`, `time`, `url`, `email`, `tel`, `switch`). `file` and
 * `color` stay out — each needs a subsystem ligma does not have (upload
 * storage, a palette picker) — and so does `direction-cards`, answered instead
 * by the design-system picker (W-16).
 *
 * Kept in lockstep with the zod enum in `apps/daemon/src/engine/discovery.ts`
 * (`questionSchema.type`) — that enum's inferred type must stay assignable to
 * this one, or the daemon's discovery pass fails to typecheck.
 */
export type DiscoveryQuestionType =
  | 'single'
  | 'multi'
  | 'select'
  | 'text'
  | 'textarea'
  | 'number'
  | 'range'
  | 'date'
  | 'time'
  | 'url'
  | 'email'
  | 'tel'
  | 'switch';

export interface DiscoveryQuestion {
  id: string;
  label: string;
  type: DiscoveryQuestionType;
  /** Choices for `single`/`multi`/`select`; empty for the prose and number types. */
  options: string[];
  required: boolean;
  /** One line of context under the label. Empty when the label says enough. */
  help: string;
}

export interface DiscoveryForm {
  id: string;
  title: string;
  description: string;
  questions: DiscoveryQuestion[];
}

/** Answers keyed by question id. `multi` answers are arrays, everything else a string. */
export type DiscoveryAnswers = Record<string, string | string[]>;

/**
 * Every discovery form carries this question, and its answer sets
 * `project.shape` (UX spec F1 step 2 — "this reads as an API service —
 * correct?"). The id is fixed so the daemon can find the answer without reading
 * the label, and its options are the shapes themselves.
 */
export const SHAPE_QUESTION_ID = 'shape';

/** Human wording for each shape, used by the form renderer and the Knowledge tab. */
export const SHAPE_LABELS: Record<ProjectShape, string> = {
  ui: 'A UI app — people will look at it and click it',
  headless: 'Headless — an API, CLI, library or service',
  mixed: 'Mixed — it has a face and a programmable surface',
  artifact: 'An artifact — a paper, a spec, a dataset or documents. Nothing runs',
};

/** One round of discovery: the form the agent asked, and what came back. */
export interface DiscoveryTurn {
  form: DiscoveryForm;
  /** null while the form is still open — this is the pending turn. */
  answers: DiscoveryAnswers | null;
  askedAt: string;
  answeredAt: string | null;
}

// ─── The brief ───────────────────────────────────────────────────────────────

export type BriefStatus =
  /** Discovery is still asking. */
  | 'discovery'
  /** Locked into the Brief stage artifact; still editable. */
  | 'locked'
  /** A contract has compiled against it — edits now flag dependents stale. */
  | 'compiled';

export interface Brief {
  /** "brf_<timestamp>" — also the name of `brief.json`'s owning project dir. */
  id: string;
  projectId: string;
  /** The composer's prompt, verbatim. Editable until compilation. */
  prompt: string;
  /** The composer's project-kind chip, or null when the user picked none. */
  kind: string | null;
  /** Confirmed by the shape question; null until discovery answers it. */
  shape: ProjectShape | null;
  status: BriefStatus;
  /** Oldest first. At most one turn has `answers === null` — the open form. */
  turns: DiscoveryTurn[];
  /** Refinements the human typed directly onto the locked brief. */
  constraints: string[];
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  compiledAt: string | null;
  /**
   * When the brief was last edited *after* compilation. Non-null means the
   * downstream designs/tasks are stale and a Deck card is owed — the edit
   * never invalidates them (build brief §2 pinned default).
   */
  staleFlaggedAt: string | null;
  /**
   * The stale-brief Deck card's "still true" answer to the drift trigger
   * (isBriefDrifted below) — suppresses the card until this time. Optional:
   * absent on every brief written before this field existed, and absent means
   * "never snoozed", never "snoozed forever" (absent ≠ empty).
   */
  staleSnoozedUntil?: string | null;
}

// ─── Pure helpers, shared by the route and the form UI ───────────────────────

/** The form still waiting on the human, or null when discovery is caught up. */
export function openForm(brief: Brief): DiscoveryForm | null {
  const pending = brief.turns.find((t) => t.answers === null);
  return pending ? pending.form : null;
}

/** An answer counts as given when it is a non-empty string or a non-empty array. */
export function isAnswered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The required-input gate, naming the missing fields *before* submit
 * (open-design's OD-034, the pattern we're porting). Returns the labels of
 * unanswered required questions — empty means the form may be submitted.
 */
export function missingRequired(form: DiscoveryForm, answers: DiscoveryAnswers): string[] {
  return form.questions.filter((q) => q.required && !isAnswered(answers[q.id])).map((q) => q.label);
}

/**
 * True when editing this brief must flag its dependents stale instead of
 * silently changing the thing a signed contract was compiled from.
 */
export function editFlagsStale(brief: Brief): boolean {
  return brief.compiledAt !== null;
}

/**
 * The sentinel answer for "you (the agent) decide" — sits beside Skip on every
 * discovery question (build brief §16 Phase 2). Skip only works on an optional
 * field (leaving it blank is itself the answer); a required field cannot be
 * left blank, so this is the escape hatch that still satisfies
 * `missingRequired` without the human picking a value themselves.
 */
export const YOU_DECIDE = 'You decide';

/**
 * The amend route's input-validation half: does this answer even have the
 * right shape for the question it claims to answer? A choice question's
 * answer must be one of its own options (or the you-decide sentinel), a
 * switch's answer must be "true"/"false", and array-ness must match `multi`
 * exactly. Free text, numbers and the native date/url/etc. types accept any
 * string — the same trust the open form already extends them.
 */
export function validateAnswerAgainstQuestion(
  question: DiscoveryQuestion,
  answer: string | string[],
): boolean {
  if (Array.isArray(answer) !== (question.type === 'multi')) return false;
  const values = Array.isArray(answer) ? answer : [answer];
  if (question.type === 'single' || question.type === 'select' || question.type === 'multi') {
    return values.every((v) => v === YOU_DECIDE || question.options.includes(v));
  }
  if (question.type === 'switch') {
    return values.every((v) => v === 'true' || v === 'false');
  }
  return true;
}

/** Brief drift thresholds (build brief §16 Phase 2) — hardcoded and tested. */
export const DRIFT_AGE_DAYS = 90;
export const DRIFT_TASK_THRESHOLD = 25;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when a brief has gone stale by neglect rather than by edit: untouched
 * for `DRIFT_AGE_DAYS` while `DRIFT_TASK_THRESHOLD`+ of the project's tasks
 * completed after it was last written, and nobody already answered "still
 * true" for this window. `completedTasksSinceUpdate` is the caller's to count
 * — this module has no fs and cannot read tasks.json itself (build brief §16).
 */
export function isBriefDrifted(
  brief: Pick<Brief, 'updatedAt' | 'staleSnoozedUntil'>,
  completedTasksSinceUpdate: number,
  now: number = Date.now(),
): boolean {
  const snoozedUntil = brief.staleSnoozedUntil ? Date.parse(brief.staleSnoozedUntil) : Number.NaN;
  if (Number.isFinite(snoozedUntil) && snoozedUntil > now) return false;
  const ageDays = (now - Date.parse(brief.updatedAt)) / DAY_MS;
  return ageDays >= DRIFT_AGE_DAYS && completedTasksSinceUpdate >= DRIFT_TASK_THRESHOLD;
}

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/** `POST /api/briefs` — the Home composer's submit. Creates the project too. */
export interface CreateBriefRequest {
  prompt: string;
  /** The project-kind chip, when one was picked. */
  kind?: string;
  /** Project name; defaults to a title derived from the prompt. */
  name?: string;
}

export interface BriefResponse {
  brief: Brief;
}

/** `POST /api/projects/:id/brief/answers` — one answered discovery form. */
export interface BriefAnswersRequest {
  /** The form being answered, so a stale second tab cannot answer the wrong one. */
  formId: string;
  answers: DiscoveryAnswers;
}

/** `PATCH /api/projects/:id/brief` — edit, lock, or answer the stale card. */
export interface BriefPatchRequest {
  prompt?: string;
  constraints?: string[];
  /** Lock the brief into the Brief stage artifact. */
  lock?: boolean;
  /** Clear the stale flag — the Deck card's answer. */
  acknowledgeStale?: boolean;
  /** Re-raise it — the Deck card's undo. */
  flagStale?: boolean;
  /** The drift card's "still true" answer — sets `staleSnoozedUntil`. */
  snooze?: boolean;
}

/**
 * `POST /api/projects/:id/brief/amend` — edit one already-answered discovery
 * question, after the fact. Distinct from `/brief/answers`: that route only
 * ever accepts the currently open form (and refuses a stale one), this route
 * only ever targets a form that has already been answered.
 */
export interface BriefAmendRequest {
  formId: string;
  questionId: string;
  answer: string | string[];
}

export interface BriefAmendResponse {
  ok: true;
  /** The ANSWERED DecisionItem this amendment appended — the audit trail. */
  decisionId: string;
  /** True when the brief was locked, so amending it also raised the stale flag. */
  staleFlagged: boolean;
}
