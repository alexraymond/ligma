'use client';

import { apiFetch } from '@/lib/api-client';
import type { TaskOutcome } from '@ligma/api';
import { useEffect, useState } from 'react';

/**
 * `GET /api/tasks/:id/outcome` — what this task actually produced, and whether
 * it is still moving.
 *
 * A failed read is reported via `error`, never folded into a null outcome: "this
 * task produced nothing" and "we could not read what it produced" are different
 * claims, and only the first is about the build.
 *
 * ponytail: fetched once per task, not polled. Every field it serves is either
 * settled (the builder's report, past verification runs) or carries its own
 * absolute timestamp (`deferred.resumesAt`), so an open drawer never shows a
 * number that silently rots. Add a poll when something on this panel starts
 * changing while you watch it.
 */
export function useTaskOutcome(taskId: string): {
  outcome: TaskOutcome | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{
    outcome: TaskOutcome | null;
    loading: boolean;
    error: string | null;
  }>({
    outcome: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ outcome: null, loading: true, error: null });

    (async () => {
      try {
        const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/outcome`);
        if (!res.ok) throw new Error(`Failed to load the outcome (${res.status})`);
        const body = (await res.json()) as TaskOutcome;
        if (!cancelled) setState({ outcome: body, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({
            outcome: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  return state;
}
