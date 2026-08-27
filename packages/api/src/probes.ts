/**
 * The regression corpus (UX spec §6 Verify) — every failure the product has
 * ever been caught in, kept as a probe so it can be re-asked later.
 *
 * A probe is deliberately *not* a replay script. Replaying is what "Prove it"
 * already does: the journey runs, the same criterion is judged again, and the
 * baseline comparison that already exists says whether the old failure came
 * back. A probe is the record of what to look for and where it was seen —
 * journey, criterion, the failing step's own record, and the verdict that
 * recorded it — so nothing bespoke has to exist to re-run it.
 *
 * Probes live centrally (`data/projects/<id>/probes/`, beside the baselines and
 * under the same deny rules): a builder that could read the corpus would be
 * reading the list of things it is about to be tested on.
 */

/** One recorded failure, replayable through the journey it came from. */
export interface RegressionProbe {
  /** "probe_<runId>_<criterionId>" — one probe per criterion per verdict. */
  id: string;
  projectId: string;
  /** The journey to re-run to ask this question again. Null for a task verdict. */
  journeyId: string | null;
  /** The task the failing verdict belonged to. Null for a journey verdict. */
  taskId: string | null;
  criterionId: string;
  /** The criterion verbatim from the contract — what should have happened. */
  criterionText: string;
  /**
   * Run-relative path to the failing step's own record (an HTTP/PTY record or a
   * screenshot), taken from the criterion verdict's cited evidence. Null when
   * the judge cited none — an uncited failure is still worth recording.
   */
  recordPath: string | null;
  /** The judge's reasoning for the failure, so the probe says why it was filed. */
  reasoning: string;
  /** The verdict that recorded this probe — the origin link, never a dead end. */
  runId: string;
  createdAt: string;
}

/** `GET /api/projects/:id/probes`. */
export interface RegressionProbeListResponse {
  projectId: string;
  probes: RegressionProbe[];
}
