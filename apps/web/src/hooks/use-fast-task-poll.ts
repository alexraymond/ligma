'use client';

import { useEffect } from 'react';

const FAST_POLL_INTERVAL = 5_000; // 5 seconds when tasks are running

/**
 * Polls task data more frequently while any tasks are actively running.
 * Normal task polling is 15s; this brings it to 5s during execution
 * so subtask progress appears more responsive on the UI.
 */
export function useFastTaskPoll(
  hasRunningTasks: boolean,
  refetchTasks: () => Promise<void> | void,
) {
  useEffect(() => {
    if (!hasRunningTasks) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refetchTasks();
      }
    }, FAST_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [hasRunningTasks, refetchTasks]);
}
