'use client';

import { ErrorState } from '@/components/error-state';
import { JourneysPanel } from '@/components/journeys-panel';
import { ProjectHealthBoard } from '@/components/project-health-board';
import { RegressionCorpus } from '@/components/regression-corpus';
import { StagePanelHost } from '@/components/stage-panels';
import {
  StatusChip,
  VERIFICATION,
  VerificationPill,
  type VerificationPillStatus,
} from '@/components/status-pill';
import { studioVisible } from '@/components/studio/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useActiveRuns } from '@/hooks/use-active-runs';
import { useProjects, useTasks } from '@/hooks/use-data';
import { useJourneys } from '@/hooks/use-journeys';
import { useVerificationRuns } from '@/hooks/use-verification-runs';
import { apiFetch } from '@/lib/api-client';
import { currentShaForProject, staleDecision, staleTip } from '@/lib/staleness';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { Task, VerificationRunManifest } from '@ligma/api';
import { ArrowUpRight, ClipboardCopy, Code2, Palette } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { stillUnproven } from './unproven';

/** One "still unproven" row: named, with its attempt counter, linked to its row below. */
function UnprovenRow({ task, hasRow }: { task: Task; hasRow: boolean }) {
  const attempts = task.verificationAttempts ?? 0;
  const label =
    attempts > 0 ? `${attempts} attempt${attempts > 1 ? 's' : ''}` : 'no attempts recorded';
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      {hasRow ? (
        <a
          href={`#task-${task.id}`}
          className="truncate underline underline-offset-2 hover:text-foreground"
        >
          {task.title}
        </a>
      ) : (
        // No row below to jump to: this task has never been through the
        // harness, so the Tasks list has nothing for it (absent ≠ empty).
        <span className="truncate">{task.title}</span>
      )}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{label}</span>
    </li>
  );
}

/**
 * The Ship panel (§16 "Show me the thing"): how the work leaves this project,
 * and what is still not proven.
 *
 * There is no "Open preview" button. The ephemeral-env registry does record a
 * URL (`apps/daemon/src/env/manifest.ts` → `EnvManifest.url`), but nothing
 * serves it: no daemon route and no web route reads that file, and the envs
 * themselves are created and torn down inside a verification or journey run.
 * A button pointing at nothing is worse than the sentence saying so.
 */
function ShipPanel({
  projectId,
  designShaped,
  unproven,
  rowIds,
}: {
  projectId: string;
  designShaped: boolean;
  unproven: Task[];
  /** Tasks that have a row in the Tasks section below — the anchors that exist. */
  rowIds: Set<string>;
}) {
  const [handoff, setHandoff] = useState<{ prompt: string; vscodeUrl: string | null } | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  // One GET serves both verbs — the route returns the compiled prompt and the
  // editor URL together (`/api/mcp/handoff-prompt/:id`).
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch(`/api/mcp/handoff-prompt/${projectId}`);
        const json = (await res.json()) as {
          prompt?: string;
          vscodeUrl?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? `Could not build the handoff (${res.status})`);
        if (live) setHandoff({ prompt: json.prompt ?? '', vscodeUrl: json.vscodeUrl ?? null });
      } catch (err) {
        if (live) setHandoffError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId]);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Ship it</h2>

        <p className="text-xs text-muted-foreground">
          No preview environment — previews come from verification runs, which build one and tear it
          down again.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {designShaped && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${projectId}/studio`}>
                <Palette className="mr-1.5 h-3.5 w-3.5" /> Share design
              </Link>
            </Button>
          )}
          {handoff?.vscodeUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={handoff.vscodeUrl}>
                <Code2 className="mr-1.5 h-3.5 w-3.5" /> Open in editor
              </a>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={handoff === null}
            onClick={async () => {
              if (!handoff) return;
              try {
                await navigator.clipboard.writeText(handoff.prompt);
                showSuccess('Handoff prompt copied');
              } catch {
                showError('Could not copy — the clipboard was refused');
              }
            }}
          >
            <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Hand off
          </Button>
        </div>

        {/* What travels, in one line (§16). */}
        <p className="text-xs text-muted-foreground">
          Hand off copies a prompt describing this project, its open tasks and its notes — no code,
          no credentials.
        </p>
        {handoffError && (
          <p className="text-xs text-amber-600">Handoff unavailable — {handoffError}</p>
        )}
        {handoff !== null && handoff.vscodeUrl === null && (
          <p className="text-xs text-muted-foreground">
            No repo path recorded for this project, so there is nothing to open in an editor.
          </p>
        )}

        <div className="space-y-1.5 border-t pt-3">
          <h3 className="text-xs font-semibold">Still unproven</h3>
          {unproven.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every task in this project has a passing or waived verdict.
            </p>
          ) : (
            <ul className="space-y-1">
              {unproven.map((task) => (
                <UnprovenRow key={task.id} task={task} hasRow={rowIds.has(task.id)} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Verify: is it actually done?
 *
 * Two halves, because the product answers to two different things. **Journeys**
 * are named user flows proven independently of any ticket — the twin-primitives
 * half, with "Prove it" on every row. **Tasks** are the delegated work, each
 * linked to the evidence that closed it. The baselines browser lives in
 * Knowledge, per the screen inventory (§6): what *is* working is repo memory,
 * what has been *proven* is here.
 */
export default function ProjectVerifyPage() {
  const projectId = useParams<{ id: string }>().id;
  const { tasks } = useTasks();
  const { projects } = useProjects();
  // Filtered server-side by projectId (F1): the unfiltered/client-filtered
  // version silently dropped this project's evidence once 50+ newer runs
  // existed workspace-wide.
  const {
    runs: projectRuns,
    error: runsError,
    refetch: refetchRuns,
  } = useVerificationRuns(undefined, projectId);

  const { journeys, repoPath, refetch } = useJourneys(projectId);
  // The only signal this project's current HEAD has, absent a live daemon
  // route for one: the most recent builder run's commitSha. Weak — it lags
  // any commit made outside the harness, and is null until a builder has run
  // at least once — but it's what lets a SHA comparison replace the 7-day
  // timer at all (see `staleness.ts#currentShaForProject`).
  const { runs: activeRuns } = useActiveRuns();
  const currentSha = currentShaForProject(activeRuns, projectId);

  /**
   * "Prove it" starts a run, so the *runs* are re-read too (F7): refetching
   * journeys alone left the row's pill and Evidence link unchanged until a
   * reload. The run list then polls itself until nothing is `running`.
   */
  const onRan = () => {
    void refetch();
    void refetchRuns();
  };

  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const unproven = stillUnproven(projectTasks);
  const latestRunFor = new Map<string, VerificationRunManifest>();
  for (const run of projectRuns) {
    // Journey runs carry no taskId — they prove the product, not a ticket.
    if (run.taskId && !latestRunFor.has(run.taskId)) latestRunFor.set(run.taskId, run);
  }

  const verifiable = projectTasks.filter(
    (t) =>
      t.kanban === 'awaiting-verification' ||
      (t.verificationStatus ?? 'unverified') !== 'unverified' ||
      latestRunFor.has(t.id),
  );

  const statusOf = (t: Task) =>
    t.kanban === 'awaiting-verification'
      ? ('in-review' as const)
      : (t.verificationStatus ?? 'unverified');

  // One decision per row, reused for both the header counts and the row
  // itself — a `passed` verdict is the only status a staleness check can ever
  // downgrade. `run.baseCommit` is the commit that run actually verified
  // (already on the wire, no extra fetch); it plays the "verdict SHA" role a
  // dedicated `VerificationVerdict.commitSha` would, without needing this
  // page to fetch each task's full verdict just to read it.
  const rows = verifiable.map((task) => {
    const run = latestRunFor.get(task.id);
    const status = statusOf(task);
    const decision =
      status === 'passed'
        ? staleDecision({
            finishedAt: run?.finishedAt,
            verdictSha: run?.baseCommit ?? null,
            currentSha,
          })
        : null;
    const effectiveStatus: VerificationPillStatus = decision?.stale ? 'stale' : status;
    return { task, run, status, decision, effectiveStatus };
  });

  const counts: Record<VerificationPillStatus, number> = {
    unverified: 0,
    'in-review': 0,
    passed: 0,
    failed: 0,
    waived: 0,
    stale: 0,
  };
  for (const row of rows) counts[row.effectiveStatus] += 1;

  return (
    <div className="space-y-6">
      {/* Summary-first (§11): the health roll-up leads, the verdict lists follow.
          It used to live on the Overview page, which this stage absorbs. */}
      <section className="space-y-2" aria-labelledby="health-heading">
        <h2 id="health-heading" className="text-sm font-semibold">
          Health
        </h2>
        <ProjectHealthBoard projectId={projectId} />
      </section>

      {/* Header counts — `stale` joins the roll-up alongside the rest of the
          vocabulary (UX-REBUILD-BRIEF §Phase 2). Zero-count states stay hidden
          rather than padding the row with "0 failed". */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {(Object.entries(counts) as [VerificationPillStatus, number][])
            .filter(([, count]) => count > 0)
            .map(([state, count]) => (
              <StatusChip
                key={state}
                state={state}
                label={`${count} ${VERIFICATION[state].label}`}
              />
            ))}
        </div>
      )}

      <ShipPanel
        projectId={projectId}
        designShaped={studioVisible(projects.find((p) => p.id === projectId)?.shape)}
        unproven={unproven}
        rowIds={new Set(rows.map((r) => r.task.id))}
      />

      <section className="space-y-2" aria-labelledby="journeys-heading">
        <h2 id="journeys-heading" className="text-sm font-semibold">
          Journeys
        </h2>
        <JourneysPanel
          projectId={projectId}
          journeys={journeys}
          runs={projectRuns}
          repoPath={repoPath}
          onRan={onRan}
        />
      </section>

      <section className="space-y-2" aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="text-sm font-semibold">
          Tasks
        </h2>
        {runsError && (
          <ErrorState
            variant="compact"
            title="Could not load verification evidence"
            detail={`Task statuses below may be missing their latest run. ${runsError}`}
          />
        )}
        {verifiable.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {runsError
                ? "Evidence couldn't be loaded, so tasks that are only backed by a run aren't showing. Retry once the harness is reachable."
                : 'No task in this project has been through the harness yet. Tasks with acceptance criteria go to it when their builder finishes.'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map(({ task, run, decision, effectiveStatus }) => {
              const runId = run?.id;
              const stale = decision?.stale ?? false;
              const movedSinceBuild = stale && decision?.reason === 'moved';
              // SHA comparison replaces the 7-day-timer wording the moment a
              // verdict carries a SHA (staleDecision's job) — the timer's own tip
              // only ever fires for the SHA-less fallback.
              const tip = movedSinceBuild
                ? 'The code has moved since this was verified — the verdict predates the current commit.'
                : stale && run?.finishedAt
                  ? staleTip(run.finishedAt)
                  : undefined;
              return (
                <div
                  key={task.id}
                  id={`task-${task.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.verificationAttempts
                        ? `${task.verificationAttempts} attempt${task.verificationAttempts > 1 ? 's' : ''}`
                        : 'no attempts recorded'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {movedSinceBuild && (
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', VERIFICATION.waived.className)}
                      >
                        code moved since
                      </Badge>
                    )}
                    <VerificationPill
                      status={effectiveStatus}
                      verdictHref={runId ? `/verification/${runId}` : null}
                      tip={tip}
                    />
                    {runId && (
                      <Link
                        href={`/verification/${runId}`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Evidence
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="corpus-heading">
        <h2 id="corpus-heading" className="text-sm font-semibold">
          Regression corpus
        </h2>
        <RegressionCorpus
          projectId={projectId}
          journeys={journeys}
          onReplayed={() => void refetch()}
        />
      </section>

      <p className="text-xs text-muted-foreground">
        What working currently looks like — the characterization baselines — lives in{' '}
        <Link
          href={`/projects/${projectId}/verify?panel=knowledge`}
          className="underline underline-offset-2"
        >
          Knowledge
        </Link>
        .
      </p>

      {/* Proof's drawer (§11): the baselines browser, deep-linked as `?panel=knowledge`. */}
      <StagePanelHost projectId={projectId} panels={['knowledge']} />
    </div>
  );
}
