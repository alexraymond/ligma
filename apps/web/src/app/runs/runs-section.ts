import type { ActiveRun } from '@ligma/api';

export type RunsSectionState = 'error' | 'empty' | 'list';

/**
 * What the Runs card shows for its own `/api/runs` read — independent of the
 * daemon-status fetch that gates the rest of the page (walkthrough M5: "Runs
 * shows no run list at all, not even an empty state"). A failed read must
 * never look like "no runs" — `error` outranks `empty` even if the last known
 * `runs` value happens to be `[]`.
 */
export function runsSectionState(
  runs: readonly ActiveRun[],
  runsError: string | null,
): RunsSectionState {
  if (runsError) return 'error';
  return runs.length === 0 ? 'empty' : 'list';
}
