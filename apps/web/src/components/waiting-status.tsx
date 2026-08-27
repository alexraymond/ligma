'use client';

/**
 * The app's one vocabulary for waiting/staleness (UX spec M8, mechanics F9).
 * Before this, a stuck Running row showed one line forever, Terminal spun on
 * `connecting…` with no way out, and the Studio Wall's SSE stream could die
 * with no visible sign (F9). This is the presentational half: callers derive
 * which `WaitingState` applies (a dead pid, a closed EventSource, a governor
 * defer) and hand it timestamps; this component only renders it.
 *
 * Five states, no synonyms — `queued` · `deferred` (resumes ~HH:MM) ·
 * `running` (elapsed) · `stalled` (was running, no heartbeat) · `connecting`
 * (escalates to a retry affordance past its timeout, so it can never spin
 * forever). The style table below is a total `Record` over the state union —
 * same house style as `status-pill.tsx`'s `EXECUTION`/`VERIFICATION` tables —
 * so a state added to the union without a style is a compile error, not a
 * silent blank badge.
 */

import { resumeLabel } from '@/components/failure/failure-card';
import { EXECUTION, RunningDot } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';
import { AlertTriangle, CircleDashed, Loader2, Timer } from 'lucide-react';
import * as React from 'react';

export type WaitingState =
  | { kind: 'queued' }
  | { kind: 'deferred'; resumeAt?: string | null }
  | { kind: 'running'; since: string }
  | { kind: 'stalled'; since?: string | null }
  | { kind: 'connecting'; since: string; timeoutMs?: number; onRetry?: () => void };

export type WaitingKind = WaitingState['kind'];

/** A `connecting` state past this age offers a retry instead of spinning forever (mechanics F9). */
export const DEFAULT_CONNECTING_TIMEOUT_MS = 10_000;

// Every colour is borrowed from status-pill.tsx's EXECUTION table — seam rule 1
// says that file is the only paint site, and a waiting state maps cleanly onto
// the execution vocabulary: stalled and timed-out are harness malfunctions, so
// they wear `error`'s amber; connecting is as neutral as queued.
const STYLE: Record<WaitingKind, { className: string; icon: typeof Timer | null }> = {
  queued: { className: EXECUTION.queued.className, icon: CircleDashed },
  deferred: { className: EXECUTION.deferred.className, icon: Timer },
  // Running gets a pulsing dot instead of an icon, same rule as ExecutionPill's one working signal.
  running: { className: EXECUTION.running.className, icon: null },
  stalled: { className: EXECUTION.error.className, icon: AlertTriangle },
  // Spinner while waiting; the timed-out branch below repaints it in the stalled amber.
  connecting: { className: EXECUTION.queued.className, icon: null },
};

const TIMED_OUT_CLASSNAME = EXECUTION.error.className;

function minutesSince(iso: string, now: number): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 60_000);
}

/**
 * "running 4m" / "running 1h 4m" / "running <1m" — floored, not rounded: a run
 * that started 59 seconds ago has not yet run for a minute, so it must not
 * claim "1m" (an honest-wording rule, same spirit as walkthrough m2).
 */
export function formatElapsed(since: string, now: number): string {
  const mins = Math.floor(minutesSince(since, now));
  if (mins < 1) return 'running <1m';
  if (mins < 60) return `running ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `running ${h}h` : `running ${h}h ${m}m`;
}

/** "stalled — no response" / "stalled — no response 12m" once a last-seen timestamp exists. */
export function formatStalled(since: string | null | undefined, now: number): string {
  if (!since) return 'stalled — no response';
  return `stalled — no response ${Math.floor(minutesSince(since, now))}m`;
}

/** True once a `connecting` state has outlived its timeout — the escalation point (mechanics F9). */
export function connectingTimedOut(
  state: Extract<WaitingState, { kind: 'connecting' }>,
  now: number,
): boolean {
  const timeout = state.timeoutMs ?? DEFAULT_CONNECTING_TIMEOUT_MS;
  return now - new Date(state.since).getTime() > timeout;
}

/** The label rendered inside the badge — a pure function of state + time, so it's testable without a clock mock. */
export function waitingLabel(state: WaitingState, now: number): string {
  switch (state.kind) {
    case 'queued':
      return 'queued';
    case 'deferred':
      return resumeLabel(state.resumeAt);
    case 'running':
      return formatElapsed(state.since, now);
    case 'stalled':
      return formatStalled(state.since, now);
    case 'connecting':
      return connectingTimedOut(state, now) ? "couldn't connect" : 'connecting…';
  }
}

function Dot({ kind }: { kind: WaitingKind }) {
  if (kind === 'running') {
    return <RunningDot />;
  }
  if (kind === 'connecting') {
    return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
  }
  const Icon = STYLE[kind].icon;
  return Icon ? <Icon className="h-3 w-3" aria-hidden /> : null;
}

export interface WaitingStatusProps {
  state: WaitingState;
  /** Overrides the default tooltip. */
  tip?: string;
  className?: string;
  /** Injection point for deterministic tests/storybook; defaults to `Date.now()`. */
  now?: number;
}

export function WaitingStatus({ state, tip, className, now }: WaitingStatusProps) {
  const t = now ?? Date.now();
  const timedOut = state.kind === 'connecting' && connectingTimedOut(state, t);
  const style = STYLE[state.kind];
  const label = waitingLabel(state, t);
  const retry = state.kind === 'connecting' && timedOut ? state.onRetry : undefined;

  const badge = (
    <Badge
      variant="outline"
      className={cn('gap-1.5 text-xs', timedOut ? TIMED_OUT_CLASSNAME : style.className, className)}
    >
      {timedOut ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <Dot kind={state.kind} />}
      {label}
      {retry ? (
        <button type="button" onClick={retry} className="font-medium underline underline-offset-2">
          Retry
        </button>
      ) : null}
    </Badge>
  );

  return tip ? <Tip content={tip}>{badge}</Tip> : badge;
}
