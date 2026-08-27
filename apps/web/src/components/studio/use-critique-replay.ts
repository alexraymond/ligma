'use client';

/**
 * Drives the critique lane's Replay control from a persisted transcript.
 *
 * Thin glue only: fetch once `enabled` flips true, then hand the events to
 * `createCritiqueReplayer` (the pure, tested pacing logic in
 * `critique-replay.ts`) and fold each one through `reduceCriticEvent` — the
 * exact reduction `use-design.ts`'s live SSE handler applies — so replay
 * produces the identical `CritiqueLiveState` the lane already knows how to
 * render. No second vocabulary, no second renderer.
 *
 * Ported from open-design's `useCritiqueReplay` (Theater), trimmed to what
 * OD-057 asks for: no gzip (the daemon reader returns parsed JSON, not a raw
 * file to decompress client-side), and a numeric speed multiplier in place
 * of the reference's `'paused' | 'instant' | 'live' | { intervalMs }` — this
 * lane only needs 1x/2x/4x.
 */

import type { DesignCriticEvent } from '@ligma/api';
import { useEffect, useRef, useState } from 'react';
import { CRITIQUE_IDLE, type CritiqueLiveState, reduceCriticEvent } from './critique-events';
import { type ReplaySpeedMultiplier, createCritiqueReplayer } from './critique-replay';

export type { ReplaySpeedMultiplier } from './critique-replay';

export type ReplayStatus = 'idle' | 'loading' | 'playing' | 'done' | 'error';

export interface UseCritiqueReplayResult {
  live: CritiqueLiveState;
  status: ReplayStatus;
  error: string | null;
}

export function useCritiqueReplay(
  enabled: boolean,
  fetchTranscript: () => Promise<DesignCriticEvent[]>,
  speed: ReplaySpeedMultiplier,
): UseCritiqueReplayResult {
  const [live, setLive] = useState<CritiqueLiveState>(CRITIQUE_IDLE);
  const [status, setStatus] = useState<ReplayStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const fetchRef = useRef(fetchTranscript);
  fetchRef.current = fetchTranscript;

  const replayerRef = useRef<ReturnType<typeof createCritiqueReplayer> | null>(null);

  // Fetch + play effect: (re)runs only when the control is opened or closed.
  useEffect(() => {
    if (!enabled) {
      replayerRef.current?.stop();
      replayerRef.current = null;
      setLive(CRITIQUE_IDLE);
      setStatus('idle');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setLive(CRITIQUE_IDLE);

    fetchRef.current().then(
      (events) => {
        if (cancelled) return;
        setStatus('playing');
        replayerRef.current = createCritiqueReplayer(events, speed, {
          onEvent: (event) => setLive((prev) => reduceCriticEvent(prev, event)),
          onDone: () => {
            if (!cancelled) setStatus('done');
          },
        });
      },
      (err) => {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      cancelled = true;
      replayerRef.current?.stop();
      replayerRef.current = null;
    };
    // `speed` intentionally excluded: a mid-playback speed change re-paces
    // the same in-flight replayer via the effect below rather than
    // refetching and restarting from the top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Re-pace a running replayer when the speed control changes.
  useEffect(() => {
    replayerRef.current?.setSpeed(speed);
  }, [speed]);

  return { live, status, error };
}
