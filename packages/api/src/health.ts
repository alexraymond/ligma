/**
 * Health — "how much of this is actually proven?", as numbers rather than a
 * feeling (UX spec §5 F3 for the portfolio card, §6 for the Overview board).
 *
 * Two grains, one source. `ProjectHealth` is the portfolio grain: one row per
 * project, cheap enough to compute for every project on every dashboard read.
 * `CriterionHealthRow` is the Overview grain: one row per criterion in the
 * project's contracts, joined to whatever the latest verdict said about it.
 *
 * Neither carries a `stale` flag. Staleness is a *rendering* decision made
 * against a threshold the client owns (`apps/web/src/lib/staleness.ts`), so the
 * wire carries the timestamp and nothing pre-judges it.
 */

import type { CriterionKind, CriterionVerdictStatus } from './harness';

/** One project's verified-ness, as served beside the project list. */
export interface ProjectHealth {
  projectId: string;
  /** Tasks carrying acceptance criteria — the ones a verdict could ever cover. */
  verifiable: number;
  /** Of those, how many currently carry a `passed` verification status. */
  verified: number;
  /** `verified / verifiable` as a whole percentage; 0 when nothing is verifiable. */
  percent: number;
  /**
   * The newest verdict behind `verified`, or null when nothing has been proven.
   * This is what health decays against — a 100% that was proven a month ago is
   * not the same claim as a 100% proven this morning.
   */
  lastVerifiedAt: string | null;
}

/** A criterion with no verdict yet is `unverified`, not a failure. */
export type CriterionHealthStatus = CriterionVerdictStatus | 'unverified';

export interface CriterionHealthRow {
  /** Contract scope: a task id, or `<projectId>__<journeyId>` for a journey. */
  scope: string;
  contractId: string;
  /** The contract's title — the human name of the thing this criterion is about. */
  title: string;
  taskId: string | null;
  journeyId: string | null;
  criterionId: string;
  text: string;
  kind: CriterionKind;
  /** True = held out from the builder. The panel still tests it. */
  holdout: boolean;
  status: CriterionHealthStatus;
  /** The judge's reasoning for `status`. Empty when nothing has ruled yet. */
  reasoning: string;
  /** The run that ruled, so the row can link its verdict. Null when none has. */
  runId: string | null;
  /** When that run finished — what the staleness decay is measured from. */
  verifiedAt: string | null;
}

/** `GET /api/projects/:id/health`. */
export interface ProjectHealthResponse {
  projectId: string;
  criteria: CriterionHealthRow[];
}
