'use client';

import { FailureCard, classifyManifestStatus } from '@/components/failure';
import { ExecutionPill, VerificationPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { type VerdictOutcome, useVerdictOutcomes } from '@/hooks/use-journeys';
import { SMOKE_SCHEDULES, setJourneySchedule, startJourneyRun } from '@/lib/journeys';
import { isStale, staleTip } from '@/lib/staleness';
import { showError, showSuccess } from '@/lib/toast';
import type { Journey, VerificationRunManifest } from '@ligma/api';
import { ArrowUpRight, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

/**
 * The journeys list (UX spec §6 Verify): named user flows validated
 * independently of any task, each with "Prove it".
 *
 * One status pill per row, chosen from whichever axis has something to say:
 * the **execution** pill (whether the run itself worked) while no verdict
 * exists yet, the **verification** pill (whether the product did) once one
 * does. A run cannot reach a verdict without finishing, so once verification
 * has an answer it already implies execution succeeded — showing both was a
 * green "done" execution check sitting beside a red "failed" verdict for the
 * same run (M3: "a journey both done and failed"), even though neither value
 * was wrong on its own. A harness `error` is never drawn as a product
 * `failed` (principle 12), and the green check only ever appears attached to
 * its verdict link.
 */
export function JourneysPanel({
  projectId,
  journeys,
  runs,
  repoPath,
  onRan,
}: {
  projectId: string;
  journeys: Journey[];
  /** Verification runs for this project, newest first. */
  runs: VerificationRunManifest[];
  repoPath: string | null;
  onRan?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const latestFor = new Map<string, VerificationRunManifest>();
  for (const run of runs) {
    if (run.journeyId && !latestFor.has(run.journeyId)) latestFor.set(run.journeyId, run);
  }
  const outcomes = useVerdictOutcomes(
    [...latestFor.values()].filter((r) => r.verdictPath).map((r) => r.id),
  );

  async function proveIt(journeyId: string) {
    setBusy(journeyId);
    try {
      await startJourneyRun(projectId, journeyId);
      showSuccess('Journey run started — watch it in Runs');
      onRan?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * The smoke cadence, editable (§6 "schedule").
   *
   * The daemon has persisted this since Phase 3 and the row only ever *showed*
   * it, so setting one meant hand-editing `.ligma/journeys/*.json` — load-bearing
   * behaviour with no control, which brief §3 forbids outright.
   */
  async function changeSchedule(journeyId: string, cron: string | null) {
    setBusy(journeyId);
    try {
      await setJourneySchedule(projectId, journeyId, cron);
      showSuccess(cron === null ? 'Smoke schedule turned off' : 'Smoke schedule saved');
      onRan?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (journeys.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {repoPath ? (
            'No journeys yet. Adoption proposes them from a crawl, and Promote generates them from a brief.'
          ) : (
            <>
              This project has no repo path, so it has no .ligma/ to keep journeys in.{' '}
              <Link href={`/projects/${projectId}/brief`} className="underline underline-offset-2">
                Ask for something new in the Brief
              </Link>{' '}
              to adopt one.
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {journeys.map((journey) => {
        const run = latestFor.get(journey.id);
        const outcome = run ? outcomes[run.id] : undefined;
        const stale =
          run !== undefined &&
          outcome !== undefined &&
          outcome !== 'error' &&
          isStale(run.finishedAt);
        const runFailureClass = run ? classifyManifestStatus(run.status) : null;
        return (
          <div key={journey.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{journey.title}</p>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {journey.origin === 'discovery' ? 'proposed by crawl' : 'human'}
                  </Badge>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    smoke:
                    <select
                      aria-label={`Smoke schedule for ${journey.title}`}
                      value={journey.schedule ?? ''}
                      disabled={busy !== null}
                      onChange={(e) =>
                        void changeSchedule(
                          journey.id,
                          e.target.value === '' ? null : e.target.value,
                        )
                      }
                      className="h-6 rounded border bg-background px-1 text-[10px]"
                    >
                      {SMOKE_SCHEDULES.map((option) => (
                        <option key={option.label} value={option.cron ?? ''}>
                          {option.label}
                        </option>
                      ))}
                      {/* A cron set by hand that matches no preset stays selectable
                          rather than being silently rewritten to "Off". */}
                      {journey.schedule &&
                        !SMOKE_SCHEDULES.some((o) => o.cron === journey.schedule) && (
                          <option value={journey.schedule}>{journey.schedule}</option>
                        )}
                    </select>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">{journey.goal}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {run && showsExecutionPill(outcome) && <ExecutionPill state={executionOf(run)} />}
                {run && outcome && (
                  <VerificationPill
                    // A harness `error` proved nothing about the product, so it
                    // reads as unverified rather than as a defect. A `passed`
                    // verdict old enough to predate recent work reads as `stale`
                    // instead — still linked, but no longer an honest green check.
                    status={outcome === 'error' ? 'unverified' : stale ? 'stale' : outcome}
                    verdictHref={`/verification/${run.id}`}
                    tip={stale && run.finishedAt ? staleTip(run.finishedAt) : undefined}
                  />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => void proveIt(journey.id)}
                >
                  <Play className="h-3 w-3" /> Prove it
                </Button>
              </div>
            </div>
            {run && (
              <p className="mt-2 text-xs text-muted-foreground">
                Last run {run.startedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                <Link href={`/verification/${run.id}`} className="underline underline-offset-2">
                  evidence <ArrowUpRight className="inline h-3 w-3" />
                </Link>
              </p>
            )}
            {runFailureClass && (
              <div className="mt-2">
                <FailureCard failureClass={runFailureClass} detail={run?.error} variant="inline" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A journey run's *execution* state. `error` is the harness malfunctioning, and
 * it is deliberately not the same word — or colour — as a failed product.
 */
function executionOf(run: VerificationRunManifest): 'running' | 'done' | 'error' {
  if (run.status === 'running') return 'running';
  return run.status === 'error' ? 'error' : 'done';
}

/**
 * Whether the execution pill still has something to say. A verdict cannot
 * exist without the run having finished, so once `outcome` is set the
 * verification pill already speaks for execution too — showing both was a
 * green "done" execution check next to a red "failed" verdict for the exact
 * same run (M3: "a journey both done and failed"). Exported so the fix is
 * pinned by a test rather than only by the JSX that calls it.
 */
export function showsExecutionPill(outcome: VerdictOutcome | undefined): boolean {
  return outcome === undefined;
}
