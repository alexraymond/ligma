/**
 * Brownfield adoption (UX spec F2, build brief §7 D3).
 *
 * `POST /api/projects/adopt` starts an adoption run — watchable like any other
 * run. It infers a boot recipe from the repo's own files, boots an ephemeral
 * env, lets an exploratory persona propose journeys, and keeps its confusion
 * log as the first UX audit. Nothing is written into the repo until the human
 * answers the review sheet.
 */

import type { BootRecipe } from './knowledge';
import type { ProjectShape } from './shapes';

export type AdoptionStatus =
  | 'running'
  /** Inference finished; the review sheet is waiting for a human. */
  | 'awaiting-review'
  /** Review applied: `.ligma/` written, project created. */
  | 'applied'
  /** Harness malfunction — never "this repo is broken" (D3). */
  | 'error';

/** A journey the exploratory persona proposes. Not yet a Journey — unaccepted. */
export interface ProposedAdoptionJourney {
  title: string;
  goal: string;
  steps: string[];
  tags: string[];
  /** What the persona saw that made it propose this. */
  rationale: string;
}

/** One thing the exploratory persona could not work out. The first UX audit. */
export interface ConfusionEntry {
  severity: 'blocker' | 'major' | 'minor' | 'note';
  summary: string;
  evidence: string[];
}

export interface AdoptionRun {
  /** "arun_<timestamp>". */
  id: string;
  repoPath: string;
  /** Set once the review is applied. */
  projectId: string | null;
  status: AdoptionStatus;
  /** Inferred, human-confirmable. */
  shape: ProjectShape | null;
  boot: BootRecipe | null;
  /** Why the recipe looks like that — shown on the review sheet. */
  bootRationale: string;
  proposedJourneys: ProposedAdoptionJourney[];
  confusionLog: ConfusionEntry[];
  /** The env the crawl ran against, for the run view. */
  envId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /**
   * A recipe derived from the repo's facts alone, computed by `GET
   * /api/adoption/:runId` and never stored. What the correction editor
   * pre-fills when a run failed before inference produced anything to correct.
   */
  bootDraft?: BootRecipe | null;
}

// ─── Review sheet ────────────────────────────────────────────────────────────

export interface JourneyDecision {
  /** Index into `AdoptionRun.proposedJourneys`. */
  index: number;
  action: 'accept' | 'reject';
  /** Edited copy to accept instead of the proposal. Ignored on reject. */
  edited?: ProposedAdoptionJourney;
}

export interface AdoptionReviewRequest {
  /** Confirmed (possibly corrected) boot recipe. Omit to accept as inferred. */
  boot?: BootRecipe;
  shape?: ProjectShape;
  /** Project name; defaults to the repo directory name. */
  name?: string;
  /** One decision per proposal — batch, one screen (F2 step 3). */
  journeys: JourneyDecision[];
}

export interface AdoptionReviewResponse {
  runId: string;
  projectId: string;
  repoPath: string;
  acceptedJourneyIds: string[];
  rejected: number;
}

export interface AdoptRequest {
  repoPath: string;
}
