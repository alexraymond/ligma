/**
 * spawn-slot.ts — wait for a governor slot and BOOK it in the same atomic step.
 *
 * The harness cannot use `awaitSpawn`: it polls `canSpawn`, which reserves
 * nothing, so the caller has to `recordSpawn` afterwards. That is check-then-act
 * — two personas in one panel (maxParallelPersonas > 1) can both observe the last
 * slot free and both take it, overrunning the very window the governor exists to
 * protect. `claimSpawn` decides and books inside one file lock, so this loop
 * waits on the atomic primitive instead and no caller records anything separately.
 *
 * Waiting rather than aborting is deliberate and unchanged: by the time a persona
 * or the judge asks, the panel has already spent sessions, and half a panel is
 * evidence of nothing. Only the kill switch (or running out of patience) throws.
 */

import { logger } from '../engine/logger';
import { GovernorAbort, claimSpawn, deferralFields } from '../engine/quota-governor';
import type { Backend, GovernorRole } from '../engine/types';

const DEFAULT_MAX_WAIT_MS = 20 * 60 * 1000;
const DEFAULT_POLL_MS = 30 * 1000;

export async function awaitClaimedSlot(
  role: GovernorRole,
  opts: {
    /** Human-readable subject of the wait, for logs and the abort message. */
    label: string;
    /** Ledger reference recorded with the booking. */
    ref?: string | null;
    backend?: Backend;
    maxWaitMs?: number;
    pollMs?: number;
  },
): Promise<Backend> {
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    // Allowed ⇒ the slot is already booked. Do NOT call recordSpawn as well.
    const decision = claimSpawn(role, { backend: opts.backend, ref: opts.ref ?? null });
    if (decision.allowed) return decision.backend;

    if (decision.reason === 'kill-switch') {
      throw new GovernorAbort(
        `governor kill switch active — aborting ${opts.label}`,
        deferralFields(decision),
      );
    }
    if (Date.now() >= deadline) {
      throw new GovernorAbort(
        `governor denied ${opts.label} for ${Math.round(maxWaitMs / 60000)}min (last reason: ${decision.reason})`,
        deferralFields(decision),
      );
    }
    logger.warn(
      'governor',
      `${opts.label} waiting on quota: ${decision.reason}, retry in ${Math.round(decision.retryInMs / 1000)}s`,
    );
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(pollMs, Math.max(1, decision.retryInMs))),
    );
  }
}
