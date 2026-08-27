'use client';

import { useCallback, useEffect, useState } from 'react';
import { isHintSeen, markHintSeen } from './hints';

/**
 * `active` gates whether this milestone has been *reached* (e.g. a design is
 * open); the persisted "seen" flag gates whether it has already been *shown*.
 * `visible` is true only when both hold, and flips to false the instant
 * `dismiss()` runs — no re-showing later in the same session.
 *
 * Defaults to hidden until the effect confirms the flag, so a returning user
 * never sees a one-frame flash of a hint they already dismissed.
 */
export function useOnboardingHint(
  id: string,
  active: boolean,
): { visible: boolean; dismiss: () => void } {
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSeen(isHintSeen(window.localStorage, id));
  }, [id]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') markHintSeen(window.localStorage, id);
    setSeen(true);
  }, [id]);

  return { visible: active && !seen, dismiss };
}
