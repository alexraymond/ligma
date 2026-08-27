'use client';

import { ExecutionPill, executionStateFor } from '@/components/status-pill';
import type { ActiveRun } from '@ligma/api';

const QUIET_WORKING_MINUTES = 5;
const QUIET_STALLED_MINUTES = 30;

export type RunDisplayState =
  | 'running'
  | 'working-silently'
  | 'possibly-stalled'
  | 'deferred'
  | 'completed'
  | 'failed'
  | 'timeout';

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

/**
 * How long this run has actually been silent.
 *
 * `GET /api/runs` stamps `lastOutputAt` on running rows from the mtime of the
 * run's append-only output file, so a chatty long run no longer reads as quiet
 * (D7 MC-110). `startedAt` remains the fallback for the honest cases where
 * there is no signal yet: a run that has not written its first line, and
 * daemon-session rows merged in from `daemon-status.json`, which have no
 * output file of their own.
 */
export function quietMinutes(run: ActiveRun): number {
  return minutesSince(run.lastOutputAt ?? run.startedAt);
}

export function getRunDisplayState(run: ActiveRun): RunDisplayState {
  if (run.status !== 'running') return run.status;
  const quiet = quietMinutes(run);
  if (quiet > QUIET_STALLED_MINUTES) return 'possibly-stalled';
  if (quiet > QUIET_WORKING_MINUTES) return 'working-silently';
  return 'running';
}

/**
 * A run in the app's execution vocabulary. The quiet-duration nuance survives as
 * wording and a tooltip on the same `running` pill rather than as its own colour
 * — one vocabulary, no synonyms (UX spec §7).
 */
export function RunStatusBadge({ run }: { run: ActiveRun }) {
  switch (getRunDisplayState(run)) {
    case 'working-silently':
      return (
        <ExecutionPill
          state="running"
          label="running (quiet)"
          tip={`No output for ${Math.round(quietMinutes(run))}m — normal for long autonomous builds and verification panels.`}
        />
      );
    case 'possibly-stalled':
      return (
        <ExecutionPill
          state="running"
          label="running (stalled?)"
          tip="No output in a while — worth checking the run's output for what's happening."
        />
      );
    case 'deferred':
      return (
        <ExecutionPill
          state="deferred"
          tip={run.error ?? 'Postponed by the quota governor until a window opens.'}
        />
      );
    case 'timeout':
      return (
        <ExecutionPill
          state="error"
          label="error (timeout)"
          tip="The run hit its timeout — a harness malfunction, not a product defect."
        />
      );
    case 'failed':
      return (
        <ExecutionPill
          state="error"
          tip={run.error ?? 'The run itself failed — a harness malfunction, not a product defect.'}
        />
      );
    default:
      return <ExecutionPill state={executionStateFor(run.status)} />;
  }
}
