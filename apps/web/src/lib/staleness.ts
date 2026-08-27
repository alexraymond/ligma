/**
 * Staleness rendering (UX spec §6 "health board", §7 `stale` verification
 * state) — a verdict does not stay proof forever; after long enough it no
 * longer says anything about the code as it stands today.
 *
 * Only wired where a last-verified timestamp is already on the wire:
 * `VerificationRunManifest.finishedAt` (journeys, and tasks via their latest
 * run). `Task` itself carries no `verifiedAt` — see the P4-B report for that
 * gap; nothing here invents one.
 */

/**
 * A verdict older than this no longer proves today's code — a week is long
 * enough that unrelated work has almost certainly landed since.
 * ponytail: fixed threshold, no per-project override; revisit if a project
 * ships faster than that and staleness starts firing on verdicts that are
 * still accurate.
 */
export const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function isStale(
  finishedAt: string | null | undefined,
  now: number = Date.now(),
  thresholdMs = STALE_THRESHOLD_MS,
): boolean {
  if (!finishedAt) return false;
  const at = new Date(finishedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at > thresholdMs;
}

/**
 * Tooltip text carrying the actual timestamp — the pill says "stale", this says
 * since when. Signed evidence always carries its year (unlike `lib/time.ts`'s
 * relative/short-date formatting, which is right for casual lists but would
 * make a verdict's date ambiguous the moment "stale" is more than a few months old).
 */
export function staleTip(finishedAt: string): string {
  return `Verified ${new Date(finishedAt).toLocaleString()} — this predates recent work and no longer proves it.`;
}

/**
 * Has the code moved since a verdict was signed? (Phase 2, UX-REBUILD-BRIEF
 * §Phase 2: "Proof marks 'code moved since' when HEAD differs; the 7-day timer
 * remains only where no SHA exists.")
 *
 * `null` means unknowable — either side is missing (a repo-less project, a
 * verdict from before Phase 2, or no builder run yet to read a current SHA
 * off) — never coerced to true/false. Callers fall back to the age-based
 * `isStale` timer only on `null`, never on a SHA the caller merely failed to
 * fetch.
 */
export function codeMovedSince(
  verdictSha: string | null | undefined,
  currentSha: string | null | undefined,
): boolean | null {
  if (!verdictSha || !currentSha) return null;
  return verdictSha !== currentSha;
}

/** Which check produced a `staleDecision`'s verdict — the badge and tip differ by reason. */
export type StaleReason = 'moved' | 'age' | 'fresh';

export interface StaleDecision {
  stale: boolean;
  /**
   * "moved" — a SHA comparison fired (replaces the timer). "age" — no SHA on
   * either side, so the 7-day timer decided. "fresh" — no SHA and under the
   * timer.
   */
  reason: StaleReason;
}

/**
 * The one staleness call a verdict-bearing row makes. SHA comparison replaces
 * the timer whenever both sides carry one; the timer is the fallback for
 * SHA-less verdicts only, never a second vote once a SHA comparison exists.
 */
/**
 * A project's current HEAD is not served anywhere yet — `Project` carries no
 * live SHA, and adding a daemon route for one is out of scope here (Agent H
 * owns no daemon routes). The best available proxy is the most recent
 * builder run's `commitSha` (rev-parsed at spawn, in `active-runs.json`).
 *
 * Weak signal, by design: it lags any commit made outside the harness, and is
 * `null` whenever no builder run has happened yet for the project — callers
 * fall back to the age timer in that case (see `staleDecision`), never to a
 * guessed SHA.
 */
export function currentShaForProject(
  runs: readonly { projectId: string | null; commitSha?: string | null; startedAt: string }[],
  projectId: string | null,
): string | null {
  if (!projectId) return null;
  const latest = [...runs]
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  return latest?.commitSha ?? null;
}

export function staleDecision(
  args: {
    finishedAt: string | null | undefined;
    verdictSha: string | null | undefined;
    currentSha: string | null | undefined;
  },
  now: number = Date.now(),
): StaleDecision {
  const moved = codeMovedSince(args.verdictSha, args.currentSha);
  if (moved !== null) return { stale: moved, reason: 'moved' };
  const agedOut = isStale(args.finishedAt, now);
  return { stale: agedOut, reason: agedOut ? 'age' : 'fresh' };
}
