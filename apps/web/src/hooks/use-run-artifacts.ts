'use client';

import { apiFetch } from '@/lib/api-client';
import { useEffect, useState } from 'react';

/**
 * A run's captured prompt/changes (Phase 2 — task detail's Changes/Prompt
 * tabs). Both routes are absent-safe by design (`GET .../prompt` → 404,
 * `GET .../changes` → nulled fields for a run that predates Phase 2 or never
 * captured one) — this hook's job is to keep that "absent ≠ empty" honesty
 * intact on the way into React state, the same rule `use-verification-runs.ts`
 * states for its own reads.
 *
 * On-demand, not eager (same `enabled` gate as `use-daemon-logs.ts`): a task
 * detail panel with a Prompt/Changes tab nobody opened has no reason to hit
 * the daemon for it.
 */
export interface RunArtifactState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** A 404 — no artifact was ever captured for this run. Not an error. */
  notRecorded: boolean;
}

/** Pure so the 404→notRecorded mapping is testable without a fetch mock. */
export function classifyArtifactResponse<T>(
  status: number,
  ok: boolean,
  body: T | null,
): Pick<RunArtifactState<T>, 'data' | 'error' | 'notRecorded'> {
  if (status === 404) return { data: null, error: null, notRecorded: true };
  if (!ok) return { data: null, error: `Failed to load (${status})`, notRecorded: false };
  return { data: body, error: null, notRecorded: false };
}

const IDLE = <T>(): RunArtifactState<T> => ({
  data: null,
  error: null,
  loading: false,
  notRecorded: false,
});

function useRunArtifact<T>(
  runId: string | null,
  enabled: boolean,
  path: 'prompt' | 'changes',
): RunArtifactState<T> {
  const [state, setState] = useState<RunArtifactState<T>>(IDLE<T>());

  useEffect(() => {
    if (!enabled || !runId) {
      setState(IDLE<T>());
      return;
    }
    let cancelled = false;
    setState({ data: null, error: null, loading: true, notRecorded: false });

    (async () => {
      try {
        const res = await apiFetch(`/api/runs/${encodeURIComponent(runId)}/${path}`);
        const body = res.ok ? ((await res.json()) as T) : null;
        if (cancelled) return;
        setState({ ...classifyArtifactResponse(res.status, res.ok, body), loading: false });
      } catch (err) {
        if (cancelled) return;
        setState({
          data: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
          notRecorded: false,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId, enabled, path]);

  return state;
}

export interface RunPrompt {
  prompt: string;
}

/** `GET /api/runs/:id/prompt` — the persisted builder prompt, or `notRecorded` for a pre-Phase-2 run. */
export function useRunPrompt(runId: string | null, enabled: boolean): RunArtifactState<RunPrompt> {
  return useRunArtifact<RunPrompt>(runId, enabled, 'prompt');
}

export interface RunChanges {
  commitSha: string | null;
  capturedAt: string | null;
  stat: string | null;
  diff: string | null;
}

/** `GET /api/runs/:id/changes` — the diff captured at run end; nulled fields, never omitted, when nothing was captured. */
export function useRunChanges(
  runId: string | null,
  enabled: boolean,
): RunArtifactState<RunChanges> {
  return useRunArtifact<RunChanges>(runId, enabled, 'changes');
}
