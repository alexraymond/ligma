'use client';

import { useSmartPoll } from '@/hooks/use-smart-poll';
import { apiFetch } from '@/lib/api-client';
import { type OutputLine, type RunOutputChunk, SSE_EVENTS, apiPath } from '@ligma/api';
import { useCallback, useEffect, useRef, useState } from 'react';

export type { OutputLine };

const POLL_INTERVAL = 2000; // fallback only — 2 seconds

/**
 * A run's captured output, streamed.
 *
 * `GET /api/runs/:id/output/stream` has existed and been proven by the CLI
 * (`apps/cli/src/commands/tail.ts`) since it was added; the web polled the
 * sibling `…/output` route on a 2s timer instead. Both carry the same
 * `RunOutputChunk`, so this subscribes and keeps the poller as the fallback —
 * the same order of preference, and the same fallback, the CLI uses.
 *
 * `offsetRef` is the cursor both paths share: whatever the stream delivered
 * before it broke is where the poller resumes, so no line is fetched twice and
 * none is skipped.
 */
export function useRunOutput(runId: string | null, enabled: boolean) {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  /** False once the stream fails — from then on this run is polled. */
  const [streaming, setStreaming] = useState(true);
  const offsetRef = useRef(0);

  // Reset state when runId changes
  useEffect(() => {
    setLines([]);
    setIsComplete(false);
    setStreaming(true);
    offsetRef.current = 0;
  }, [runId]);

  const apply = useCallback((chunk: RunOutputChunk) => {
    if (chunk.lines.length > 0) setLines((prev) => [...prev, ...chunk.lines]);
    offsetRef.current = chunk.nextOffset;
    if (chunk.done) setIsComplete(true);
  }, []);

  useEffect(() => {
    if (!enabled || !runId || isComplete || !streaming) return;
    if (typeof EventSource === 'undefined') {
      setStreaming(false); // SSR / no browser stream support — poll instead
      return;
    }

    const source = new EventSource(
      `${apiPath('runOutputStream', { id: runId })}?offset=${offsetRef.current}`,
    );

    source.addEventListener(SSE_EVENTS.output, (event) => {
      apply(JSON.parse((event as MessageEvent<string>).data) as RunOutputChunk);
    });
    // `end` is a close signal carrying no lines — every line already arrived as
    // an `output` frame (apps/daemon/src/routes/stream.ts).
    source.addEventListener(SSE_EVENTS.end, () => {
      setIsComplete(true);
      source.close();
    });
    // EventSource would retry a dropped connection by itself, but a non-2xx or
    // a wrong content-type closes it for good and the panel would just stop
    // moving. Hand the run to the poller instead: it resumes from the cursor
    // and reports its own completion.
    source.onerror = () => {
      source.close();
      setStreaming(false);
    };

    return () => source.close();
  }, [runId, enabled, isComplete, streaming, apply]);

  const fetchOutput = useCallback(
    async (isStale: () => boolean) => {
      if (!runId) return;
      const requestOffset = offsetRef.current;

      try {
        const res = await apiFetch(
          `/api/runs/${encodeURIComponent(runId)}/output?offset=${requestOffset}`,
        );
        // A newer runId superseded this in-flight request — its offset/lines
        // belong to the run we've already moved on from. Applying them here
        // would corrupt offsetRef and append the old run's lines to the new one.
        if (isStale()) return;

        if (!res.ok) {
          if (res.status === 404) {
            setIsComplete(true);
          }
          return;
        }

        apply((await res.json()) as RunOutputChunk);
      } catch {
        // Silently fail on poll errors
      }
    },
    [runId, apply],
  );

  useSmartPoll(fetchOutput, {
    intervalMs: POLL_INTERVAL,
    enabled: enabled && !!runId && !isComplete && !streaming,
    key: runId,
  });

  return { lines, isComplete };
}
