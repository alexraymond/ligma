/**
 * The visible slice of a task's acceptance criteria (UX spec §6 Board: "task
 * drawer shows criteria (visible slice)").
 *
 * ~70% of criteria are held out from the builder (principle 4), and the split is
 * decided once, at compile time, inside the signed contract. `task.acceptanceCriteria`
 * carries all of them undifferentiated, so a drawer rendering that list is
 * showing the human something the builder never saw and calling it the same
 * thing. The contract is the only place that knows which is which.
 */

import type { AcceptanceContract } from '@ligma/api';

export interface CriteriaSlice {
  /** The criteria the builder was shown, verbatim. */
  visible: string[];
  /** How many the panel tests but the builder never saw. */
  heldOut: number;
  /** One line stating the split, or why there isn't one yet. */
  note: string;
  /** True when no contract exists and the list is the task's own, unsplit. */
  uncompiled: boolean;
}

/**
 * `contract` is the latest compiled version for this task, or null when nothing
 * has been compiled yet — a task created by hand, or one whose promote has not
 * happened. That case is stated rather than hidden: an uncompiled list is not a
 * visible slice, it is just a list.
 */
export function criteriaSlice(
  contract: AcceptanceContract | null,
  taskCriteria: string[] | undefined,
): CriteriaSlice {
  const own = taskCriteria ?? [];

  if (!contract) {
    return {
      visible: own,
      heldOut: 0,
      note:
        own.length === 0
          ? 'No acceptance criteria — this task will be marked waived rather than verified.'
          : 'No contract compiled yet, so nothing is held out: the builder would see all of these.',
      uncompiled: true,
    };
  }

  const visible = contract.criteria.filter((c) => !c.holdout);
  const heldOut = contract.criteria.length - visible.length;
  return {
    visible: visible.map((c) => c.text),
    heldOut,
    note:
      heldOut === 0
        ? 'Nothing is held out — the builder sees every criterion.'
        : `${heldOut} more held out from the builder — the panel tests all ${contract.criteria.length}.`,
    uncompiled: false,
  };
}

/** The highest version in a contracts listing — versions are append-only. */
export function latestContract(
  contracts: AcceptanceContract[] | undefined,
): AcceptanceContract | null {
  return (contracts ?? []).reduce<AcceptanceContract | null>(
    (latest, c) => (latest === null || c.version > latest.version ? c : latest),
    null,
  );
}
