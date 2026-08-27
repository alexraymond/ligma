/**
 * Promote-to-build — the seam between "what are we making?" and "build it".
 *
 * Two entrances, one endpoint pair (UX spec F1.4): from an approved design (UI
 * shapes) or straight from the brief (headless). Both open the same review
 * sheet, so the headless path is never a lesser version of the flow — it is the
 * same flow with an absent stage, which is the whole point of "design is a
 * stage, not a gate" (build brief §4 principle 10).
 *
 * `POST .../promote/preview` proposes; `POST .../promote` commits. Preview is
 * read-only and repeatable: it compiles nothing, signs nothing, and lands no
 * tasks. That separation is what lets the user see the holdout note and the
 * token estimate *before* the oracle freezes.
 */

import type { DesignBaselineRef } from './designs';
import type { RunFailureCause } from './types';

// ─── The proposal ────────────────────────────────────────────────────────────

/**
 * A task the promote sheet proposes. Not a `Task` — it has no id in the store
 * yet, and it carries `tempId` only so `dependsOn` can reference siblings
 * within the same proposal.
 *
 * The `tempId` is the PLANNER's own `t1..tN`, not a handle stamped on after the
 * fact: a dependency needs a vocabulary that exists at the moment the plan is
 * written, which is what execution-flow-review H1 found missing.
 */
export interface ProposedTask {
  /** Proposal-local handle, assigned by the planner. Real ids land at commit. */
  tempId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  /** Other `tempId`s in this proposal that must land first. */
  dependsOn: string[];
  /** Design files this task realises, when the proposal came from a design. */
  designFilePaths: string[];
  /**
   * The planner's own read of how uncertain this task is — `high` for novel or
   * blocking-many work, `low` for routine. Mapped to `Task.urgency` at commit,
   * which is what stops every promoted task landing in the same Eisenhower
   * quadrant and the dispatch order being plan order (H2). Optional so a
   * preview generated before this field existed still promotes (treated `low`).
   */
  risk?: 'low' | 'high';
}

/**
 * A criterion as proposed, with its holdout decision already computed.
 *
 * The split is shown before the confirm precisely because it is irreversible
 * afterwards: once the contract is signed, the builder's visible set is frozen.
 */
export interface ProposedCriterion {
  /** The task this criterion belongs to, by `ProposedTask.tempId`. */
  taskTempId: string;
  text: string;
  kind: 'criterion' | 'invariant';
  /** True = hidden from the builder. Invariants are always held out. */
  holdout: boolean;
  /** The words this was derived from. */
  quote: string;
}

/**
 * A journey the proposal suggests recording into `.ligma/journeys/`.
 *
 * Deliberately distinct from adoption's `ProposedJourney`: that one is what an
 * exploratory persona *found* in an existing repo (it carries a rationale for
 * what it saw), this one is what a promotion *intends* to build (it carries a
 * proposal-local handle so the commit step can map it to a written file).
 */
export interface PromoteProposedJourney {
  /** Proposal-local handle. */
  tempId: string;
  title: string;
  /** Goal-oriented, not step-by-step-UI ("check out with a saved card"). */
  goal: string;
  steps: string[];
}

/**
 * The governor's answer to "what will this cost, and can I afford it now?"
 *
 * Both budgets stay visible (build brief §3), so the sheet shows the estimate
 * *and* the live window — a plan that needs 12 sessions against 3 remaining is
 * a deferral the user should see coming, not discover an hour later.
 */
export interface GovernorTokenEstimate {
  /**
   * Spawns one round of this promotion needs: a builder, the project shape's
   * verification roster and a judge, per task. Read off the same roster
   * function the dispatcher's admission door uses, so the sheet and the door
   * cannot disagree.
   */
  estimatedSpawns: number;
  /**
   * The same estimate if every task exhausts `maxVerificationAttempts`. The
   * honest ceiling rather than the number that decides deferral — a plan is
   * queued off one round, but the user should see what three could cost.
   * Optional: a preview stored before this field existed has no ceiling.
   */
  maxSpawns?: number;
  /** Live window state, mirroring `GovernorStatus`. */
  windowHours: number;
  used: number;
  max: number;
  reserveFloor: number;
  remainingForAutonomy: number;
  /**
   * True when the estimate exceeds current headroom. Not an error — the daemon
   * queues denied builders and picks them up next cycle.
   */
  willDefer: boolean;
  killSwitch: boolean;
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/projects/:id/promote/preview`.
 *
 * Exactly one of `designId` / `brief` drives the proposal. Sending neither asks
 * the daemon to use the project's own brief; sending both is a client bug and
 * is rejected rather than silently preferred one way.
 */
export interface PromotePreviewRequest {
  /** An **approved** design. A drafting design is rejected — the oracle must be frozen. */
  designId?: string;
  /** Brief text for the headless entrance. */
  brief?: string;
}

export interface PromotePreview {
  projectId: string;
  /**
   * One-shot handle for this proposal, minted at preview and burned at commit.
   *
   * Promote is irreversible and expensive: without this, POSTing the same
   * reviewed preview twice landed duplicate tasks and duplicate signed
   * contracts, both dispatchable — two builders racing into one repo (process
   * audit P5). A retried request (a timed-out confirm, an agent re-sending a
   * 504) now gets a 409 instead of a second pipeline.
   *
   * Optional so a preview generated before this field existed still commits;
   * such a preview simply has no replay protection.
   */
  nonce?: string;
  /** Which entrance produced this — the sheet renders design thumbnails for `design`. */
  source: 'design' | 'brief';
  designId: string | null;
  tasks: ProposedTask[];
  criteria: ProposedCriterion[];
  /** Human-readable holdout disclosure, e.g. "the builder will see 7 of 10". */
  holdoutNote: string;
  journeys: PromoteProposedJourney[];
  governor: GovernorTokenEstimate;
  /** The frozen design baseline, when promoting from a design. */
  designBaseline: DesignBaselineRef | null;
  /** Preview generation is fail-honest: a malfunction is reported, not guessed around. */
  error: string | null;
  /**
   * What KIND of failure `error` was, decided by the daemon at the site that
   * knows — never re-derived from the message. The sheet renders the one
   * failure-card family off this, so a governor deferral reads calm ("resumes
   * ~14:30") and a dead model wire reads as a backend failure, instead of both
   * arriving as the same anonymous red string. Null when `error` is null.
   */
  causeKind?: RunFailureCause | null;
  /** For a `rate-limit` cause: when the governor expects a slot back. */
  resumesAt?: string | null;
}

// ─── Commit ──────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/projects/:id/promote`.
 *
 * The confirmed preview is echoed back rather than recomputed, so the user
 * cannot approve one breakdown and have a differently-worded one compiled.
 */
export interface PromoteRequest {
  preview: PromotePreview;
}

/** One task that landed, with the contract compiled and signed against it. */
export interface PromotedTask {
  tempId: string;
  taskId: string;
  contractId: string;
  contractVersion: number;
  /** Criteria the builder will see. The rest are held out. */
  visibleCriteria: number;
  holdoutCriteria: number;
}

// ─── Pending promotion ───────────────────────────────────────────────────────

/**
 * A preview that was generated and never confirmed.
 *
 * A contract waiting on one confirm is work waiting on the human, so it belongs
 * in the one attention queue rather than only behind a sheet the user has to
 * remember to go back to (UX spec §6 Deck: "contract promotions"). The record is
 * a summary, not the preview: the Deck card says how much is waiting and what
 * the holdout will be, and the sheet — which is where confirming happens — is
 * the one place the full breakdown is shown.
 *
 * Keyed by project + entrance (`designId`, or the brief when there is none), so
 * previewing twice from the same entrance replaces rather than accumulates.
 */
export interface PendingPromotion {
  projectId: string;
  /** `designId` for the design entrance, `"brief"` for the headless one. */
  key: string;
  source: 'design' | 'brief';
  designId: string | null;
  taskCount: number;
  criteriaCount: number;
  /** Verbatim from the preview — "the builder will see 7 of 10". */
  holdoutNote: string;
  /** The governor's spawn estimate for this promotion. */
  estimatedSpawns: number;
  createdAt: string;
}

/** `GET /api/projects/:id/promote/preview`. */
export interface PendingPromotionListResponse {
  projectId: string;
  pending: PendingPromotion[];
}

export interface PromoteResult {
  projectId: string;
  source: 'design' | 'brief';
  designId: string | null;
  tasks: PromotedTask[];
  /** Journey ids written into the target repo's `.ligma/journeys/`. */
  journeyIds: string[];
  /**
   * Journeys the commit could NOT write, by title, with the reason.
   *
   * A journey that will not write must not roll back signed contracts, so the
   * commit keeps going — but reporting a bare `journeyIds: []` alongside a 201
   * told the user their reviewed journeys had landed when they had been dropped
   * into a daemon log (process audit P6). Empty on a clean commit.
   */
  journeysDropped: Array<{ title: string; reason: string }>;
  /** True when a design baseline was ingested into every compiled contract. */
  designBaselineIngested: boolean;
}
