'use client';

/**
 * TerminalPanel — the Studio Terminal tab (OD-135), over ligma's own pty-bridge.
 *
 * The reference (`open-design`'s `TerminalViewer.tsx`) wraps xterm.js against a
 * real interactive pty: keystrokes stream to a live shell, output streams back
 * character by character, an in-flight command can be interrupted or prompted.
 * None of that is available here, and it is not a porting gap so much as a
 * different backend: xterm.js is not a dependency anywhere in this repo (only
 * checked, never added — see the handoff note in this file's sibling routes),
 * and ligma's `pty-bridge.ts` was built for scripted CLI personas, not a human
 * shell. Its `run` action spawns one command, closes stdin immediately, and
 * only answers once the process has exited (or hit its 2-minute timeout) — no
 * mid-command output, no way to answer an interactive prompt.
 *
 * So v1 is honest about what it is: a command console. Type a line, press
 * Enter, wait for the whole result, read it in a `<pre>`. That is the "minimal
 * pre-based streaming view" the task allowed for when xterm isn't present —
 * "streaming" here means each command's full output arrives as one SSE frame,
 * not a live character feed. Multiple tabs on the same session (or a page
 * reload) still share one transcript via the daemon's replay buffer, the same
 * reconnect contract the reference uses.
 *
 * Waiting vocabulary (walkthrough M8 — "Terminal says `connecting…` forever"):
 * the header used to show a bare spinner with no escalation, so a session that
 * never opened looked identical at second 1 and at minute 10. `WaitingStatus`'s
 * `connecting` state now owns that spot — past `DEFAULT_CONNECTING_TIMEOUT_MS`
 * it repaints itself as "couldn't connect" with a Retry button, wired to
 * `retry` below (bumps `reconnectKey`, which tears down and re-runs the whole
 * connect effect). A hard failure (`unavailable`) gets the shared `ErrorState`
 * idiom instead of a one-line muted string, same Retry affordance.
 */

import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { type WaitingState, WaitingStatus } from '@/components/waiting-status';
import { showError } from '@/lib/toast';
import { TerminalSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createTerminal, killTerminal, sendTerminalInput, terminalStreamUrl } from './terminal-api';

type Phase = 'connecting' | 'live' | 'ended' | 'unavailable';

/** Bounds the transcript so an hours-long session doesn't grow the DOM forever. */
export const MAX_BUFFER_CHARS = 200_000;

/** Appends a chunk, trimming from the front once the buffer gets too long. */
export function appendOutput(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  return next.length > MAX_BUFFER_CHARS ? next.slice(next.length - MAX_BUFFER_CHARS) : next;
}

/**
 * The header's `connecting` badge state — pulled out so the wiring (M8: this
 * must carry a retry, not just a spinner) is exercised directly in a test
 * without needing a live `EventSource`.
 */
export function connectingWaitingState(since: string, onRetry: () => void): WaitingState {
  return { kind: 'connecting', since, onRetry };
}

export function TerminalPanel({ projectId }: { projectId: string }) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [buffer, setBuffer] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingSince, setConnectingSince] = useState(() => new Date().toISOString());
  const [reconnectKey, setReconnectKey] = useState(0);
  const sessionRef = useRef<string | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  /** Tears down whatever's in flight and starts a fresh connect attempt. */
  const retry = (): void => setReconnectKey((k) => k + 1);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;

    setPhase('connecting');
    setError(null);
    setBuffer('');
    setConnectingSince(new Date().toISOString());

    void (async () => {
      let session: { id: string };
      try {
        session = await createTerminal(projectId);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase('unavailable');
        }
        return;
      }
      if (disposed) {
        // Unmounted while the create call was in flight — kill what we just spawned.
        void killTerminal(projectId, session.id);
        return;
      }
      sessionRef.current = session.id;

      const es = new EventSource(terminalStreamUrl(projectId, session.id));
      source = es;
      es.addEventListener('open', () => setPhase((prev) => (prev === 'ended' ? prev : 'live')));
      es.addEventListener('data', (evt) => {
        try {
          const frame = JSON.parse((evt as MessageEvent).data) as string;
          setBuffer((prev) => appendOutput(prev, frame));
        } catch {
          // Malformed chunk — more will follow.
        }
      });
      es.addEventListener('exit', () => {
        setPhase('ended');
        es.close();
      });
      es.addEventListener('error', () => {
        setPhase((prev) =>
          prev === 'ended' ? prev : es.readyState === EventSource.CLOSED ? 'unavailable' : prev,
        );
      });
    })();

    return () => {
      disposed = true;
      source?.close();
      // Killed on unmount (tab close, navigating away) — this session has no
      // reattach story worth keeping it alive for, unlike the reference's
      // long-running dev-server case.
      const id = sessionRef.current;
      if (id) void killTerminal(projectId, id);
    };
  }, [projectId, reconnectKey]);

  // Ticks while connecting so `WaitingStatus`'s timeout escalation actually
  // repaints — otherwise "couldn't connect" would only appear on the next
  // unrelated render (mechanics F9's "never spin forever" applies here too).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== 'connecting') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [buffer]);

  const submit = async (): Promise<void> => {
    const id = sessionRef.current;
    const line = input;
    if (!id || !line || busy) return;
    setBusy(true);
    try {
      await sendTerminalInput(projectId, id, line);
      // Cleared only on success — a failed send used to clear it anyway,
      // silently losing whatever the user typed (W11).
      setInput('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to send to the terminal');
    } finally {
      setBusy(false);
    }
  };

  const stopped = phase === 'ended' || phase === 'unavailable';

  return (
    <div
      className="flex h-full min-h-[24rem] flex-col rounded-md border"
      data-testid="terminal-panel"
    >
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <TerminalSquare className="size-3.5" />
        <span>Terminal</span>
        {phase === 'connecting' ? (
          <WaitingStatus
            state={connectingWaitingState(connectingSince, retry)}
            now={now}
            className="ml-auto"
          />
        ) : null}
        {phase === 'ended' ? <span className="ml-auto">session ended</span> : null}
      </div>
      {phase === 'unavailable' ? (
        <ErrorState
          variant="compact"
          title="Couldn't reach the terminal"
          detail={error}
          onRetry={retry}
          className="min-h-0 flex-1"
        />
      ) : (
        <pre
          ref={preRef}
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-muted p-2 font-mono text-[11px] leading-snug"
        >
          {buffer}
        </pre>
      )}
      <form
        className="flex items-center gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="font-mono text-xs text-muted-foreground">$</span>
        <input
          className="flex-1 bg-transparent font-mono text-xs outline-none disabled:opacity-50"
          value={input}
          disabled={stopped || busy}
          placeholder={busy ? 'running…' : 'type a command'}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" size="sm" variant="ghost" disabled={stopped || busy || !input}>
          Run
        </Button>
      </form>
    </div>
  );
}
