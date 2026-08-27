'use client';

import { apiFetch } from '@/lib/api-client';
import { useCollection } from '@/providers/collections-provider';
import type { VerificationRunManifest } from '@ligma/api';
import { useCallback, useEffect, useState } from 'react';

// Extracted for testability: this repo's vitest config runs hooks tests in
// the "node" environment (no jsdom/@testing-library/react — see
// use-smart-poll.test.ts), so the URL-building this hook's fix hinges on
// (F1: does a `projectId` actually reach the request?) is exercised directly
// here instead of through a render.
export function verificationRunsQuery(taskId?: string, projectId?: string): string {
  const params = new URLSearchParams();
  if (taskId) params.set('taskId', taskId);
  if (projectId) params.set('projectId', projectId);
  const query = params.toString();
  return `/api/verification-runs${query ? `?${query}` : ''}`;
}

/**
 * Evidence manifests, newest first. With a `taskId` and/or `projectId` the
 * daemon filters server-side (the unfiltered list truncates at 50 runs,
 * which silently hid a task's — or a project's — evidence once 50+ newer
 * runs existed workspace-wide); without either it's the recent runs across
 * everything.
 *
 * A failed fetch is reported via `error`, not folded into `runs: []`. "No
 * runs" and "couldn't read them" are different claims (the rule this repo
 * already states at `project-health-board.tsx`) — a caller that only reads
 * `runs` and treats empty as "unverified" would otherwise render evidence
 * that exists but merely failed to load as if it never ran at all.
 *
 * `refetch` is what "Prove it" calls (F7): the row it started used to stay
 * unchanged until a reload, because the only refetch wired to that button
 * re-read *journeys*. While any listed run is still `running` the list polls
 * itself, so the pill and Evidence link arrive on their own.
 */
const EMPTY: readonly VerificationRunManifest[] = [];
const RUNNING_POLL_INTERVAL = 5_000;

export function useVerificationRuns(
  taskId?: string,
  projectId?: string,
): {
  runs: VerificationRunManifest[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const url = verificationRunsQuery(taskId, projectId);

  const fetcher = useCallback(async (): Promise<VerificationRunManifest[]> => {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`Failed to load verification runs (${res.status})`);
    const data = (await res.json()) as { runs?: VerificationRunManifest[] };
    return data.runs ?? [];
  }, [url]);

  // Polls only while something is still running; the store drops the poller
  // again once the last run finishes. Whether to poll is the *input* to this
  // read, so it lags the result by a render and lives in state rather than
  // being read back out of the cache mid-render.
  const [polling, setPolling] = useState(false);
  const { data, loading, error, refetch } = useCollection<VerificationRunManifest[]>(
    url,
    fetcher,
    polling ? RUNNING_POLL_INTERVAL : undefined,
  );

  const runs = (data ?? EMPTY) as VerificationRunManifest[];
  const anyRunning = runs.some((run) => run.status === 'running');
  useEffect(() => {
    setPolling(anyRunning);
  }, [anyRunning]);

  return { runs, loading, error, refetch };
}
