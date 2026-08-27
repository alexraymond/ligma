'use client';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FailureCard, classifyRun, resumeLabel } from '@/components/failure';
import { RunStatusBadge } from '@/components/run-status-badge';
import { ExecutionPill } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import { useRunOutput } from '@/hooks/use-run-output';
import { apiFetch } from '@/lib/api-client';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { ActiveRun } from '@ligma/api';
import { ChevronDown, OctagonX, Timer } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/** How long a "come back to it later" waits. Matches the engine's own ceiling. */
const DEFER_MINUTES = 60;

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** One run's live stream. Exported for the adoption failure card's run log. */
export function RunOutputViewer({ runId, isRunning }: { runId: string; isRunning: boolean }) {
  const { lines, isComplete } = useRunOutput(runId, true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-1">
        <ExecutionPill
          state={isRunning && !isComplete ? 'running' : 'done'}
          label={isRunning && !isComplete ? 'Live' : 'Complete'}
          className="text-[10px]"
        />
        <span className="text-[10px] text-muted-foreground">{lines.length} lines</span>
      </div>
      <div
        ref={scrollRef}
        className="h-64 overflow-auto rounded-md border bg-muted/30 font-mono text-xs p-2"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">
            {isRunning ? 'Waiting for output...' : 'No output captured'}
          </p>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all py-px',
                line.stream === 'stderr' ? 'text-red-400' : 'text-foreground/80',
              )}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * One run, expandable into its live stream, stoppable on its own.
 *
 * Per-run **interrupt** and **defer** (UX spec §6 Runs): before these, the only
 * stop was "Disengage Autopilot", which stops everything — a different offer
 * wearing the same word. Both confirm first, because both end work in flight.
 * Deferring is deliberately the calm one: it says when the run comes back, and
 * the row goes violet rather than red.
 */
export function RunRow({
  run,
  taskTitle,
  onChanged,
}: { run: ActiveRun; taskTitle: string; onChanged?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState<'interrupt' | 'defer' | null>(null);
  const [busy, setBusy] = useState(false);
  // An adoption run has no task to be named after — it is named by its repo.
  const title =
    run.kind === 'adoption'
      ? `Adopting ${run.repoPath?.split('/').filter(Boolean).pop() ?? 'a repo'}`
      : taskTitle;
  // An adoption run is watchable here but not stoppable here: it is not a task
  // session, so /api/runs/:id/interrupt has nothing to kill. It is stopped by
  // answering (or abandoning) its own review sheet.
  const stoppable = run.status === 'running' && run.kind !== 'adoption';

  async function stop(kind: 'interrupt' | 'defer') {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/runs/${encodeURIComponent(run.id)}/${kind}`, {
        method: 'POST',
        ...(kind === 'defer'
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ minutes: DEFER_MINUTES }),
            }
          : {}),
      });
      const body = (await res.json()) as { error?: string; resumesAt?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not stop the run');
      showSuccess(
        kind === 'defer'
          ? resumeLabel(body.resumesAt ?? null)
          : 'Stopped — the task is back on the board',
      );
      onChanged?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex items-center justify-between w-full p-3 text-left cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <p className="font-medium text-sm truncate">{title}</p>
            <p className="text-xs text-muted-foreground">
              Agent: {run.agentId}
              {' · '}
              {run.status === 'running'
                ? formatElapsed(run.startedAt)
                : run.completedAt
                  ? `${formatElapsed(run.startedAt)} total`
                  : ''}
            </p>
            {(() => {
              const failureClass = classifyRun(run);
              if (!failureClass) return null;
              return (
                <div className="mt-0.5 max-w-md">
                  <FailureCard failureClass={failureClass} detail={run.error} variant="inline" />
                </div>
              );
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {run.interruptedAt && (
            <span className="text-xs text-muted-foreground">stopped by you</span>
          )}
          {stoppable && (
            <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-violet-600 hover:bg-violet-500/10"
                disabled={busy}
                onClick={() => setConfirming('defer')}
                aria-label={`Defer ${title}`}
              >
                <Timer className="h-3 w-3" /> Defer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10"
                disabled={busy}
                onClick={() => setConfirming('interrupt')}
                aria-label={`Interrupt ${title}`}
              >
                <OctagonX className="h-3 w-3" /> Interrupt
              </Button>
            </span>
          )}
          <RunStatusBadge run={run} />
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {run.kind === 'adoption' && (
            <Link href={`/adoption/${run.id}`} className="text-xs underline underline-offset-2">
              Open the adoption sheet
            </Link>
          )}
          <RunOutputViewer runId={run.id} isRunning={run.status === 'running'} />
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming === 'defer' ? 'Defer this run?' : 'Interrupt this run?'}
        description={
          confirming === 'defer'
            ? `The session stops now and "${title}" waits ${DEFER_MINUTES} minutes before the dispatcher picks it up again. Nothing is lost and nothing failed.`
            : `The session for "${title}" is killed and the task goes back to not-started. Work it had not written is lost.`
        }
        confirmLabel={confirming === 'defer' ? 'Defer' : 'Interrupt'}
        variant={confirming === 'defer' ? 'default' : 'destructive'}
        onConfirm={() => void stop(confirming ?? 'interrupt')}
      />
    </div>
  );
}

/** Deferred runs sink below everything else — waiting, not actionable. */
export function sortRuns(runs: ActiveRun[]): ActiveRun[] {
  const deferred = runs.filter((r) => r.status === 'deferred');
  if (deferred.length === 0) return runs;
  return [...runs.filter((r) => r.status !== 'deferred'), ...deferred];
}
