/**
 * Failure-class classification (UX spec F5, §7 "one error model").
 *
 * Every function here is a pure map from a structured daemon field — a status
 * enum, a boolean, a severity — to a `FailureClass`. None of them look at an
 * error *message*: regex/keyword-matching prose to guess what went wrong is
 * exactly the pattern the build brief forbids, because the daemon already
 * tells the client what kind of thing happened via typed fields. A message
 * string is carried through call sites as supplementary detail, never as the
 * classification input.
 *
 * `null` means "not a failure" — callers use it to skip rendering a card at
 * all (e.g. a `"passed"` verdict, a `"running"` run).
 *
 * That daemon field now exists on one wire — `PromotePreview.causeKind`, a
 * `RunFailureCause` decided by the daemon at the site that knows — so
 * `classifyCause` below is the first producer of `"auth"` and `"backend"`.
 * Every other call site still lands where its own typed field puts it.
 */

import type { RunFailureCause } from '@ligma/api';

export type FailureClass =
  | 'auth'
  | 'deferred'
  | 'parse'
  | 'backend'
  | 'boot'
  | 'harness'
  | 'parked'
  | 'unknown';

/**
 * `parked` has no classifier and never will: it is not something that went
 * wrong, it is the daemon declining to start a task until a human does
 * something (unanswered decisions, attempts spent). Sites that know they are
 * parked pass it explicitly, with the daemon's own sentence as the detail.
 */

/**
 * `RunFailureCause` (the daemon's own classification) → failure class.
 *
 * The two renames are the whole content of this map: the governor's
 * `"rate-limit"` is the calm `deferred` card (it is a queue, not a fault), and
 * `"env"` is `boot` (the recipe is what recovers it). Everything else is
 * already the same word on both sides. An absent cause is `unknown` — a site
 * that did not classify must not be dressed up as one that did.
 */
export function classifyCause(cause: RunFailureCause | null | undefined): FailureClass {
  switch (cause) {
    case 'rate-limit':
      return 'deferred';
    case 'env':
      return 'boot';
    case 'auth':
    case 'parse':
    case 'backend':
    case 'harness':
      return cause;
    default:
      return 'unknown';
  }
}

/** `RunStatus` (`@ligma/api`) → failure class. `null` for `running` / `completed`. */
export function classifyRunStatus(
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'deferred',
): FailureClass | null {
  if (status === 'deferred') return 'deferred';
  if (status === 'failed' || status === 'timeout') return 'harness';
  return null;
}

/**
 * A whole run row, which is the same map plus one thing the status alone cannot
 * say: **a run the human stopped is not a failure of any class.** The daemon
 * records that as a structured `interruptedAt`, so this stays a map from typed
 * fields — it does not read the error message to guess intent.
 */
export function classifyRun(run: {
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'deferred';
  interruptedAt?: string;
}): FailureClass | null {
  return run.interruptedAt ? null : classifyRunStatus(run.status);
}

/** `VerificationVerdict.outcome` / a journey run's execution status. `"failed"` is a real product verdict, not a card. */
export function classifyOutcome(outcome: 'passed' | 'failed' | 'error'): FailureClass | null {
  return outcome === 'error' ? 'harness' : null;
}

/** `VerificationRunManifest.status`. */
export function classifyManifestStatus(
  status: 'running' | 'complete' | 'error',
): FailureClass | null {
  return status === 'error' ? 'harness' : null;
}

/**
 * `AdoptionStatus`.
 *
 * `"boot"`, not `"harness"`: an adoption dies standing the repo up — the wrong
 * install for the lockfile, an appDir that is not the app, a dev server that
 * never gets healthy. Calling that a harness malfunction told the human it was
 * our fault and that retrying identically was safe, when the fix was the boot
 * recipe all along (D3 attempt 3, crit_goal). The env class carries the action
 * that actually recovers it.
 */
export function classifyAdoptionStatus(
  status: 'running' | 'awaiting-review' | 'applied' | 'error',
): FailureClass | null {
  return status === 'error' ? 'boot' : null;
}

/** `CritiqueStatus`. */
export function classifyCritiqueStatus(
  status: 'idle' | 'running' | 'scored' | 'interrupted' | 'error',
): FailureClass | null {
  return status === 'error' ? 'harness' : null;
}

/** `DesignTurnDoneEvent.stopReason`. */
export function classifyStopReason(
  stopReason: 'stop' | 'aborted' | 'max_turns' | 'error',
): FailureClass | null {
  return stopReason === 'error' ? 'harness' : null;
}

/** `PersonaReport.invalid` — the agent's output failed structured parsing. */
export function classifyInvalidReport(invalid: boolean): FailureClass | null {
  return invalid ? 'parse' : null;
}

/** An env-preflight check (mirrors `scripts/env/preflight.ts`'s wire shape). */
export function classifyPreflightCheck(check: {
  status: 'pass' | 'warning' | 'fail';
  severity: 'info' | 'warning' | 'blocking';
}): FailureClass | null {
  return check.status === 'fail' && check.severity === 'blocking' ? 'boot' : null;
}

/** `ProjectKnowledge.bootStatus` (`@ligma/api`'s `BootStatus`). */
export function classifyBootStatus(status: 'missing' | 'invalid' | 'ready'): FailureClass | null {
  return status === 'ready' ? null : 'boot';
}
