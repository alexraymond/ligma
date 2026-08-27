/**
 * Verified-ness as the one pill vocabulary says it (UX spec §5 F3, §7) — for a
 * whole project on Home, and for one task on the Board.
 *
 * The daemon sends numbers and a timestamp; the decay is applied here, against
 * the same threshold every other staleness site uses. Deliberately never green:
 * a percentage is an aggregate over many verdicts and has no single verdict to
 * link, and a green check without a verdict link is the one thing §8.8 forbids.
 * The honest range is grey ("not fully proven") and amber ("proven, but a while
 * ago") — which is exactly what `unverified` and `stale` already mean.
 */

import { type VerificationPillStatus, taskVerificationState } from '@/components/status-pill';
import { isStale, staleTip } from '@/lib/staleness';
import type { ProjectHealth, Task } from '@ligma/api';

export interface HealthPill {
  status: VerificationPillStatus;
  /** What the pill says instead of its state word. */
  label: string;
  tip: string;
}

/**
 * Null when the daemon sent no health for this project — a card must not invent
 * a number, and an absent field is not a zero.
 */
export function healthPill(
  health: ProjectHealth | undefined,
  now: number = Date.now(),
): HealthPill | null {
  if (!health) return null;

  if (health.verifiable === 0) {
    return {
      status: 'unverified',
      label: 'nothing to verify yet',
      tip: 'No task in this project carries acceptance criteria, so nothing here can be proven either way.',
    };
  }

  const label = `${health.percent}% verified`;
  const stale = health.lastVerifiedAt !== null && isStale(health.lastVerifiedAt, now);

  return stale
    ? { status: 'stale', label, tip: staleTip(health.lastVerifiedAt as string) }
    : {
        status: 'unverified',
        label,
        tip: `${health.verified} of ${health.verifiable} tasks with acceptance criteria carry a passing verdict.`,
      };
}

/**
 * One task's verification pill, ready to render on a board card.
 *
 * The board is where a human scans for done-ness, so it is the last place the
 * product's status vocabulary should be missing — but a card cannot fetch its
 * own verdict, which is why `lastVerificationRunId` and `lastVerifiedAt` are
 * joined onto the tasks list server-side.
 *
 * Two honesty rules, both already the law elsewhere: a `passed` with no run to
 * link stays unlinked (the pill downgrades it itself), and a `passed` old enough
 * to predate recent work reads `stale`.
 */
export function taskVerificationPill(
  task: Pick<Task, 'kanban' | 'verificationStatus' | 'lastVerificationRunId' | 'lastVerifiedAt'>,
  now: number = Date.now(),
): { status: VerificationPillStatus; verdictHref: string | null; tip?: string } | null {
  const state = taskVerificationState(task);
  if (state === null) return null;

  const verdictHref = task.lastVerificationRunId
    ? `/verification/${task.lastVerificationRunId}`
    : null;
  if (state === 'passed' && isStale(task.lastVerifiedAt, now)) {
    return { status: 'stale', verdictHref, tip: staleTip(task.lastVerifiedAt as string) };
  }
  return { status: state, verdictHref };
}
