'use client';

import { apiFetch } from '@/lib/api-client';
import type {
  BaselineListResponse,
  Journey,
  JourneyBaseline,
  JourneyListResponse,
} from '@ligma/api';
import { useCallback, useEffect, useState } from 'react';

/**
 * A project's journeys and its characterization baselines.
 *
 * Two reads because they live in two different places for a reason: journeys are
 * in the repo's `.ligma/` (visible to the builder), baselines are central and
 * tool-denied (twin-primitives §3). Keeping the fetches separate keeps that
 * separation visible in the code rather than papering over it with one endpoint.
 */
export function useJourneys(projectId: string) {
  const [data, setData] = useState<JourneyListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/journeys`);
      const json = (await res.json()) as JourneyListResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Could not load journeys');
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const journeys: Journey[] = data?.journeys ?? [];
  return { journeys, repoPath: data?.repoPath ?? null, loading, error, refetch };
}

export type VerdictOutcome = 'passed' | 'failed' | 'error';

/**
 * The outcome of each named run's verdict, or absent when it has none.
 *
 * The run listing deliberately does not carry it (the manifest is written before
 * the judge speaks), and the UI must not guess: a pill that says "passed"
 * because a verdict *file exists* is exactly the unbacked green check the seam
 * rules forbid. So we read the verdicts — a handful of small fetches.
 *
 * A per-id fetch failure resolves to the same "absent" the caller already
 * treats as "no verdict to show" (`journeys-panel.tsx`'s `outcome === undefined`
 * branch) rather than a false "passed"/"failed" — this one doesn't need the
 * unknown/empty split the rest of F2 fixes, since it never renders a
 * confident claim it can't back.
 */
export function useVerdictOutcomes(runIds: string[]): Record<string, VerdictOutcome> {
  const [outcomes, setOutcomes] = useState<Record<string, VerdictOutcome>>({});
  const key = runIds.join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = key === '' ? [] : key.split(',');
    Promise.all(
      ids.map(async (id) => {
        try {
          const res = await apiFetch(`/api/verification-runs/${id}`);
          if (!res.ok) return null;
          const json = (await res.json()) as { verdict?: { outcome?: VerdictOutcome } | null };
          return json.verdict?.outcome ? ([id, json.verdict.outcome] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setOutcomes(
        Object.fromEntries(pairs.filter((p): p is readonly [string, VerdictOutcome] => p !== null)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return outcomes;
}

/**
 * A project's characterization baselines. A failed read is reported through
 * `error`, distinct from a genuinely empty list — "no baselines yet" and
 * "couldn't load them" are different claims (project-health-board.tsx's rule),
 * and Knowledge's baselines browser needs to tell them apart.
 */
export function useBaselines(projectId: string) {
  const [baselines, setBaselines] = useState<JourneyBaseline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${projectId}/baselines`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load baselines (${res.status})`);
        return res.json() as Promise<BaselineListResponse>;
      })
      .then((json) => {
        if (cancelled) return;
        setBaselines(json.baselines ?? []);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load baselines');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { baselines, loading, error };
}
