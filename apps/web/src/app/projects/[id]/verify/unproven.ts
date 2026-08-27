/**
 * The Ship panel's honest half (§16 "Show me the thing"): what is *not* proven.
 *
 * A task counts as unproven when nothing has ruled on it (`unverified`, the
 * default for a task that never reached the harness) or the ruling went against
 * it (`failed`). `passed` and `waived` are out — waived is a human decision on
 * the record, not an open question. Failed rows sort first: a verdict against
 * you is louder than an absence of one.
 */
import type { Task } from '@ligma/api';

export function stillUnproven(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => {
      const status = t.verificationStatus ?? 'unverified';
      return status === 'unverified' || status === 'failed';
    })
    .sort(
      (a, b) =>
        Number(b.verificationStatus === 'failed') - Number(a.verificationStatus === 'failed'),
    );
}
