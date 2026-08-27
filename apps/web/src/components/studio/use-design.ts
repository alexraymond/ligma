'use client';

/**
 * One design session's live state: the manifest, the file bodies, and the SSE
 * stream that keeps both moving.
 *
 * This replaces ligma-classic's `useAgentStream.ts` + the slice of its 3448-line
 * Zustand store that the Wall read (studio map §2). The throttling behaviour is
 * ported intact — see `throttle.ts` — because it is what makes generation
 * *watchable* rather than strobing. What changed is the source: Electron IPC
 * events became `EventSource` frames off
 * `GET /api/projects/:id/designs/:did/stream`.
 */

import {
  type CritiqueReport,
  DESIGN_SSE_EVENTS,
  type DesignCriticEvent,
  type DesignFileProgressEvent,
  type DesignSnapshotEvent,
  type DesignStatusEvent,
  type DesignTranscriptEntry,
  type DesignTurnDoneEvent,
} from '@ligma/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DesignState,
  designStreamUrl,
  readDesign,
  readDesignFiles,
  readTurnTranscript,
} from './api';
import { reduceCriticEvent } from './critique-events';
import { createKeyedThrottle } from './throttle';
import { mergeEntry } from './transcript';

/**
 * The Wall's connection state (mechanics F9 — the SSE stream used to be able
 * to die with no visible sign). `null` means live/healthy: no badge to show.
 * `connecting` is the initial handshake; `stalled` is "was live, then the
 * stream died" — the case the Wall needs to surface honestly, since a design
 * mid-turn otherwise just looks stuck ("writing…" that never resolves) with
 * nothing to explain why.
 */
export type DesignConnectionState =
  | { kind: 'connecting'; since: string }
  | { kind: 'stalled'; since: string };

/** Reconnect backoff bounds for a stream the browser has fully given up on (`readyState === CLOSED`). */
const INITIAL_RECONNECT_BACKOFF_MS = 2_000;
const MAX_RECONNECT_BACKOFF_MS = 30_000;

export interface DesignLive {
  state: DesignState | null;
  /** Source body by design-relative path. Empty when the daemon has no files route. */
  bodies: Record<string, string>;
  /** The file the in-flight turn most recently wrote — the Wall's "writing…" pulse. */
  writingPath: string | null;
  /** The turn conversation, append-record by append-record (`transcript.ts` folds it). */
  transcript: DesignTranscriptEntry[];
  critique: CritiqueReport | null;
  /** Rule the critic is on right now; the lane's ticker reads this. */
  criticRule: string | null;
  turnInFlight: boolean;
  error: string | null;
  loading: boolean;
  /** Null when live; set while the stream is (re)connecting or has gone silent (F9). */
  connection: DesignConnectionState | null;
  /** Forces an immediate reconnect attempt, bypassing the current backoff wait. */
  reconnect: () => void;
  refresh: () => Promise<void>;
}

const EMPTY_BODIES: Record<string, string> = {};
const EMPTY_TRANSCRIPT: DesignTranscriptEntry[] = [];

export function useDesign(projectId: string, designId: string | null): DesignLive {
  const [state, setState] = useState<DesignState | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>(EMPTY_BODIES);
  const [writingPath, setWritingPath] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<DesignTranscriptEntry[]>(EMPTY_TRANSCRIPT);
  const [criticRule, setCriticRule] = useState<string | null>(null);
  const [critique, setCritique] = useState<CritiqueReport | null>(null);
  const [turnInFlight, setTurnInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(designId !== null);

  const refresh = useCallback(async () => {
    if (!designId) return;
    try {
      const [next, files] = await Promise.all([
        readDesign(projectId, designId),
        readDesignFiles(projectId, designId),
      ]);
      setState(next);
      setCritique(next.design.critique);
      setTurnInFlight(next.turnInFlight);
      setBodies(Object.fromEntries(files.map((f) => [f.path, f.body])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, designId]);

  useEffect(() => {
    setState(null);
    setBodies(EMPTY_BODIES);
    setWritingPath(null);
    setCriticRule(null);
    setLoading(designId !== null);
    void refresh();
  }, [refresh, designId]);

  // The transcript loads once per design, not on every `refresh`: refresh is
  // called per throttled file-progress frame, and re-fetching a conversation
  // that only ever grows by append would be a request per write. Everything
  // after this arrives on the SSE lane, de-duplicated by `mergeEntry`.
  useEffect(() => {
    setTranscript(EMPTY_TRANSCRIPT);
    if (!designId) return;
    let cancelled = false;
    void readTurnTranscript(projectId, designId)
      .then((entries) => {
        // Live frames may have landed while this was in flight — persisted
        // first, then anything the stream already delivered.
        if (!cancelled) setTranscript((live) => live.reduce(mergeEntry, entries));
      })
      .catch(() => {
        // An unreachable transcript is an empty pane, not a broken studio.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, designId]);

  // Progressive render. A file-progress frame says *which* file grew, not what
  // it now contains, so the refetch is what actually rebuilds the preview — and
  // that refetch is exactly what must be throttled to ligma-classic's ~250ms
  // cadence, per key, or a 10-write turn refetches 10 times per card.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const [connection, setConnection] = useState<DesignConnectionState | null>(null);
  const reconnectRef = useRef<() => void>(() => {});
  const reconnect = useCallback(() => reconnectRef.current(), []);

  useEffect(() => {
    if (!designId) {
      setConnection(null);
      return;
    }
    // Rebound to a `const` so it stays narrowed to `string` inside `connect`,
    // a nested function TS won't otherwise trust not to see `designId` change.
    const did = designId;
    const throttle = createKeyedThrottle<string>(() => {
      void refreshRef.current();
    });

    let disposed = false;
    let source: EventSource;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = INITIAL_RECONNECT_BACKOFF_MS;
    let everOpened = false;

    const clearReopenTimer = (): void => {
      if (reopenTimer !== null) {
        clearTimeout(reopenTimer);
        reopenTimer = null;
      }
    };

    // `stalled` once this stream has been live before and then died — a
    // never-opened stream is still just `connecting` (mechanics F9: the two
    // reads are different claims to the Wall's audience).
    const markDisconnected = (): void => {
      const kind = everOpened ? 'stalled' : 'connecting';
      setConnection((prev) =>
        prev && prev.kind === kind ? prev : { kind, since: new Date().toISOString() },
      );
    };

    function connect(): void {
      clearReopenTimer();
      source = new EventSource(designStreamUrl(projectId, did));

      const on = <T>(name: string, handler: (payload: T) => void): void => {
        source.addEventListener(name, (event) => {
          try {
            handler(JSON.parse((event as MessageEvent).data) as T);
          } catch {
            /* a frame we cannot parse is a daemon bug, not a reason to tear down */
          }
        });
      };

      source.onopen = () => {
        const wasStalled = everOpened;
        everOpened = true;
        backoffMs = INITIAL_RECONNECT_BACKOFF_MS;
        setConnection(null);
        // Reconnected after a genuine gap — resync anything the stream missed
        // while it was down, rather than trusting a possibly-stale local state.
        if (wasStalled) void refreshRef.current();
      };

      source.onerror = () => {
        if (disposed) return;
        markDisconnected();
        // CLOSED means the browser has given up retrying this EventSource on
        // its own — reopen it ourselves, backing off so a dead daemon isn't
        // hammered. Any other readyState means the browser is already
        // retrying (or about to) on the same object.
        if (source.readyState === EventSource.CLOSED) {
          reopenTimer = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, MAX_RECONNECT_BACKOFF_MS);
            connect();
          }, backoffMs);
        }
      };

      on<DesignStatusEvent>(DESIGN_SSE_EVENTS.status, (payload) => {
        setTurnInFlight(payload.turnId !== null);
        setState((prev) =>
          prev ? { ...prev, design: { ...prev.design, status: payload.status } } : prev,
        );
      });

      on<DesignFileProgressEvent>(DESIGN_SSE_EVENTS.fileProgress, (payload) => {
        setWritingPath(payload.path);
        throttle.schedule(`${payload.designId}::${payload.path}`, payload.path);
      });

      on<DesignCriticEvent>(DESIGN_SSE_EVENTS.critic, (payload) => {
        // One reducer for live and replay (`critique-events.ts`). This handler
        // used to carry its own copy of it, which meant every frame the panel
        // added — per-lane verdicts among them — landed in replay and not here.
        setCriticRule(payload.rule?.rule ?? null);
        setCritique(
          (prev) =>
            reduceCriticEvent({ critique: prev, currentRule: null, currentLane: null }, payload)
              .critique,
        );
      });

      on<DesignSnapshotEvent>(DESIGN_SSE_EVENTS.snapshot, () => {
        void refreshRef.current();
      });

      on<DesignTurnDoneEvent>(DESIGN_SSE_EVENTS.turnDone, (payload) => {
        setTurnInFlight(false);
        setWritingPath(null);
        // `error` is a harness malfunction, never a product verdict — surface it
        // as one, and never as a failed design.
        if (payload.stopReason === 'error') setError(payload.error ?? 'The turn errored');
        void refreshRef.current();
      });

      on<DesignTranscriptEntry>(DESIGN_SSE_EVENTS.transcript, (payload) => {
        setTranscript((prev) => mergeEntry(prev, payload));
      });

      on<{ message: string }>(DESIGN_SSE_EVENTS.error, (payload) => setError(payload.message));
    }

    setConnection({ kind: 'connecting', since: new Date().toISOString() });
    connect();

    reconnectRef.current = () => {
      backoffMs = INITIAL_RECONNECT_BACKOFF_MS;
      source.close();
      connect();
    };

    return () => {
      disposed = true;
      reconnectRef.current = () => {};
      clearReopenTimer();
      throttle.cancelAll();
      source.close();
    };
  }, [projectId, designId]);

  return useMemo(
    () => ({
      state,
      bodies,
      writingPath,
      transcript,
      critique,
      criticRule,
      turnInFlight,
      error,
      loading,
      connection,
      reconnect,
      refresh,
    }),
    [
      state,
      bodies,
      writingPath,
      transcript,
      critique,
      criticRule,
      turnInFlight,
      error,
      loading,
      connection,
      reconnect,
      refresh,
    ],
  );
}
