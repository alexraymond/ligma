'use client';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { FailureCard } from '@/components/failure';
import {
  ExecutionPill,
  VERIFICATION,
  VerificationPill,
  taskVerificationState,
} from '@/components/status-pill';
import { TaskForm, type TaskFormData } from '@/components/task-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tip';
import { VerificationReport } from '@/components/verification-report';
import { useActiveRuns } from '@/hooks/use-active-runs';
import { useActivityLog, useAgents, useInbox } from '@/hooks/use-data';
import { useRunChanges, useRunPrompt } from '@/hooks/use-run-artifacts';
import { type OutputLine, useRunOutput } from '@/hooks/use-run-output';
import { useTaskOutcome } from '@/hooks/use-task-outcome';
import { useVerificationRuns } from '@/hooks/use-verification-runs';
import { getAgentIcon } from '@/lib/agent-icons';
import { apiFetch } from '@/lib/api-client';
import { criteriaSlice, latestContract } from '@/lib/criteria';
import { codeMovedSince, currentShaForProject } from '@/lib/staleness';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type {
  AcceptanceContract,
  ActiveRun,
  AgentRole,
  Goal,
  Project,
  Task,
  TaskComment,
} from '@ligma/api';
import { getQuadrant } from '@ligma/api';
import type { VerificationRunManifest } from '@ligma/api';
import {
  Activity,
  CheckCircle2,
  Clock,
  Eye,
  Link2,
  ListChecks,
  MessageSquare,
  PackageCheck,
  Palette,
  Rocket,
  Send,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

function VerificationSection({
  runs,
  verificationAttempts,
}: {
  runs: VerificationRunManifest[];
  verificationAttempts?: number;
}) {
  const [open, setOpen] = useState(false);

  if (runs.length === 0) return null;
  const latest = runs[0];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:text-foreground text-muted-foreground transition-colors">
        <ShieldCheck className="h-4 w-4" />
        <span className="text-sm font-medium">Verification</span>
        <Badge variant="outline" className="text-[10px]">
          {latest.status === 'complete' ? 'reviewed' : latest.status}
        </Badge>
        {!!verificationAttempts && verificationAttempts > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {verificationAttempts} verification attempt{verificationAttempts > 1 ? 's' : ''}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {/* The full tabbed report had no in-app entry point before this link. */}
        <Link
          href={`/verification/${latest.id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Open the full verdict, timeline and evidence
          <ArrowUpRight className="h-3 w-3" />
        </Link>
        <VerificationReport runId={latest.id} compact />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Outcome — did this task produce anything, and is it still moving?
 *
 * The surface the live incident had no answer on. A builder that wrote a whole
 * paper/ and code/ tree reported "No additional notes." and listed not one file;
 * a verification the quota governor deferred said so only in the daemon log, so
 * a waiting project read as a dead one. Everything here comes from
 * `GET /api/tasks/:id/outcome`, which assembles it from stores that already
 * exist and writes nothing.
 *
 * A missing summary is stated as missing, with the log path to go read. The
 * polite blank was the bug.
 */
function OutcomeSection({ task }: { task: Task }) {
  const [open, setOpen] = useState(true);
  const { outcome, loading, error } = useTaskOutcome(task.id);

  const attempts = outcome?.verificationAttempts ?? 0;
  const failedRuns = (outcome?.verificationRuns ?? []).filter((r) => r.status === 'error');
  const unmet = (outcome?.latestVerdict?.criterionVerdicts ?? []).filter((c) => c.status !== 'met');

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:text-foreground text-muted-foreground transition-colors">
        <PackageCheck className="h-4 w-4" />
        <span className="text-sm font-medium">Outcome</span>
        {outcome?.parkedReason && (
          <Badge
            variant="outline"
            className="border-amber-500/50 text-[10px] text-amber-700 dark:text-amber-500"
          >
            parked
          </Badge>
        )}
        {outcome?.deferred && (
          <Badge
            variant="outline"
            className="border-violet-500/40 text-[10px] text-violet-600 dark:text-violet-400"
          >
            waiting on quota
          </Badge>
        )}
        {!!outcome?.builder.artifacts.length && (
          <Badge variant="outline" className="text-[10px]">
            {outcome.builder.artifacts.length} file{outcome.builder.artifacts.length > 1 ? 's' : ''}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {loading && <p className="text-xs text-muted-foreground py-1">Loading…</p>}
        {error && (
          <ErrorState variant="compact" title="Could not load the outcome" detail={error} />
        )}

        {outcome && (
          <>
            {/* Status line: where the task stands, and how many times it has been tested. */}
            <p className="text-xs text-muted-foreground">
              {outcome.kanban} · verification {outcome.verificationStatus}
              {attempts > 0 &&
                ` · ${attempts}/${outcome.maxVerificationAttempts} attempt${attempts > 1 ? 's' : ''}`}
            </p>

            {/* The park the daemon log used to keep to itself — 413 lines of
                "not dispatched: N pending decisions are unanswered" and no UI at
                all. A park is not a failure and not a deferral: nothing broke,
                and nothing resumes on a clock. It ends when the human acts, so
                the card says what to act on and links to where. */}
            {outcome.parkedReason && (
              <FailureCard
                failureClass="parked"
                detail={outcome.parkedReason}
                action={
                  outcome.pendingDecisions > 0
                    ? {
                        label: `Answer ${outcome.pendingDecisions} pending decision${outcome.pendingDecisions > 1 ? 's' : ''}`,
                        href: '/deck',
                      }
                    : undefined
                }
                note={
                  outcome.pendingDecisions > 0 ? undefined : (
                    <span>
                      Nothing is pending on this task — it will pick itself up on the next poll.
                    </span>
                  )
                }
              />
            )}

            {/* The deferral the daemon log used to keep to itself. Same calm F5
                copy every other deferred surface uses. */}
            {outcome.deferred && (
              <FailureCard
                failureClass="deferred"
                variant="inline"
                resumeAt={outcome.deferred.resumesAt}
                note={
                  <span>
                    Verification is queued, not stuck — the quota governor is holding it (
                    {outcome.deferred.reason}).
                  </span>
                }
              />
            )}

            {/* What the builder said it did. */}
            {outcome.builder.summary ? (
              <p className="text-xs whitespace-pre-wrap">{outcome.builder.summary}</p>
            ) : outcome.builder.runId ? (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                <p className="font-medium">Builder returned no summary</p>
                <p className="mt-0.5 break-all text-muted-foreground">
                  {outcome.builder.outputLogPath
                    ? `See the run output log ${outcome.builder.outputLogPath}`
                    : 'No run output log was captured either.'}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No builder has reported on this task yet.
              </p>
            )}

            {/* The files it says it wrote — the half that was invisible. */}
            {outcome.builder.artifacts.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">Artifacts written</p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                  {outcome.builder.artifacts.map((file) => (
                    <li key={file} className="break-all">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Last lines of the run, so "no summary" still has something to read. */}
            {!outcome.builder.summary && outcome.builder.outputTail.length > 0 && (
              <pre className={cn(ARTIFACT_BOX, 'h-28 whitespace-pre-wrap break-words')}>
                {outcome.builder.outputTail.join('\n')}
              </pre>
            )}

            {/* Verification runs that broke, with the class of break. An error is
                a harness malfunction, never a verdict on the work. */}
            {failedRuns.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Verification runs that did not finish
                </p>
                <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                  {failedRuns.map((run) => (
                    <li key={run.id}>
                      <span className="font-mono">{run.id}</span>
                      {run.errorKind && (
                        <Badge variant="outline" className="ml-1.5 text-[10px]">
                          {run.errorKind}
                        </Badge>
                      )}
                      {run.error && <span className="block break-words">{run.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* What the judge actually found, criterion by criterion. */}
            {unmet.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Criteria not met in the latest verdict
                </p>
                <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                  {unmet.map((c) => (
                    <li key={c.criterionId}>
                      <span className="text-foreground">{c.text ?? c.criterionId}</span> —{' '}
                      {c.status}
                      <span className="block">{c.reasoning}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The criteria the builder was shown, and how many it was not.
 *
 * The drawer used to render `task.acceptanceCriteria` — all of them — under a
 * heading the spec reserves for the *visible* slice, which quietly told the
 * human that the builder had seen the holdout too. The split lives in the signed
 * contract, so that is what this reads.
 */
function CriteriaSection({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const [contract, setContract] = useState<AcceptanceContract | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch(`/api/contracts/${encodeURIComponent(task.id)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { contracts?: AcceptanceContract[] };
        if (live) setContract(latestContract(body.contracts));
      } catch {
        // No contract readable from here — the slice falls back honestly below.
      }
    })();
    return () => {
      live = false;
    };
  }, [task.id]);

  const slice = criteriaSlice(contract, task.acceptanceCriteria);
  if (slice.visible.length === 0 && slice.heldOut === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:text-foreground text-muted-foreground transition-colors">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-sm font-medium">Acceptance criteria</span>
        <Badge variant="outline" className="text-[10px]">
          {slice.visible.length} visible
        </Badge>
        {slice.heldOut > 0 && (
          <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600">
            {slice.heldOut} held out
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {slice.visible.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {slice.visible.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">{slice.note}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * What made this, and what it made (seam rule §8.3).
 *
 * A task promoted from an approved design had no way back to it, which is the
 * dead end the rule exists to forbid. The verdict half is already covered by
 * the verification section below.
 */
function LinksSection({ task, runCount }: { task: Task; runCount: number }) {
  const designHref =
    task.projectId && task.designId
      ? `/projects/${task.projectId}/studio?design=${task.designId}`
      : null;
  if (!designHref && runCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      {designHref && (
        <Link
          href={designHref}
          className="inline-flex items-center gap-1 underline underline-offset-2"
        >
          <Palette className="h-3 w-3" />
          The design this was built from
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
      {runCount > 0 && (
        <Link href="/runs" className="inline-flex items-center gap-1 underline underline-offset-2">
          <Terminal className="h-3 w-3" />
          {runCount} run{runCount > 1 ? 's' : ''} in Runs
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

const quadrantLabels: Record<string, { label: string; color: string }> = {
  do: { label: 'DO', color: 'bg-quadrant-do/20 text-quadrant-do border-quadrant-do/30' },
  schedule: {
    label: 'SCHEDULE',
    color: 'bg-quadrant-schedule/20 text-quadrant-schedule border-quadrant-schedule/30',
  },
  delegate: {
    label: 'DELEGATE',
    color: 'bg-quadrant-delegate/20 text-quadrant-delegate border-quadrant-delegate/30',
  },
  eliminate: {
    label: 'ELIMINATE',
    color: 'bg-quadrant-eliminate/20 text-quadrant-eliminate border-quadrant-eliminate/30',
  },
};

function RunOutputSection({ runId, isRunning }: { runId: string; isRunning: boolean }) {
  const { lines, isComplete } = useRunOutput(runId, true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ExecutionPill
          state={isRunning && !isComplete ? 'running' : 'done'}
          label={isRunning && !isComplete ? 'Live' : 'Complete'}
          className="text-[10px]"
        />
        <span className="text-[10px] text-muted-foreground">{lines.length} lines</span>
      </div>
      <div
        ref={scrollRef}
        className="h-48 overflow-auto rounded-md border bg-muted/30 font-mono text-xs p-2"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">
            {isRunning ? 'Waiting for output...' : 'No output captured'}
          </p>
        ) : (
          lines.map((line: OutputLine, i: number) => (
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

/** Same scroll-box chrome as `RunOutputSection`'s log — one look across the three tabs. */
const ARTIFACT_BOX = 'h-48 overflow-auto rounded-md border bg-muted/30 font-mono text-xs p-2';

/**
 * {stat, diff} captured at run end (Phase 2 fixed shape) — monospace, its own
 * horizontal scroller since a diff line runs long. `commitSha`/`stat`/`diff`
 * are nulled rather than omitted when nothing was captured (absent ≠ empty);
 * a run that predates Phase 2 looks the same on the wire, so both render the
 * same honest "nothing recorded" message rather than an empty box.
 */
function ChangesTab({ runId, currentSha }: { runId: string; currentSha: string | null }) {
  const { data, loading, error, notRecorded } = useRunChanges(runId, true);

  if (loading) return <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>;
  if (error) return <ErrorState variant="compact" title="Could not load changes" detail={error} />;

  const nothingCaptured =
    !data || (data.commitSha === null && data.stat === null && data.diff === null);
  if (notRecorded || nothingCaptured) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        No changes recorded for this run.
      </p>
    );
  }

  // SHA comparison replaces the 7-day timer everywhere else in Phase 2
  // (staleness.ts) — same rule here: `null` (unknowable) shows no badge.
  const moved = codeMovedSince(data.commitSha, currentSha);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          Built at{' '}
          {data.commitSha ? (
            <code className="font-mono">{data.commitSha.slice(0, 12)}</code>
          ) : (
            'an unrecorded commit'
          )}
        </span>
        {moved === true && (
          <Badge variant="outline" className={cn('text-[10px]', VERIFICATION.waived.className)}>
            code moved since
          </Badge>
        )}
        {data.capturedAt && <span>captured {formatDateTime(data.capturedAt)}</span>}
      </div>
      {data.stat && (
        <pre className="overflow-x-auto rounded-md border bg-muted/30 font-mono text-xs p-2 whitespace-pre">
          {data.stat}
        </pre>
      )}
      {data.diff ? (
        <pre className={cn(ARTIFACT_BOX, 'overflow-x-auto whitespace-pre')}>{data.diff}</pre>
      ) : (
        <p className="text-xs text-muted-foreground py-2">No diff captured.</p>
      )}
    </div>
  );
}

/** The persisted builder prompt (Phase 2 fixed shape) — monospace, collapsed to a scroll box. */
function PromptTab({ runId }: { runId: string }) {
  const { data, loading, error, notRecorded } = useRunPrompt(runId, true);

  if (loading) return <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>;
  if (error) return <ErrorState variant="compact" title="Could not load prompt" detail={error} />;
  if (notRecorded || !data?.prompt) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        No prompt recorded (run predates phase 2).
      </p>
    );
  }

  return <pre className={cn(ARTIFACT_BOX, 'whitespace-pre-wrap break-words')}>{data.prompt}</pre>;
}

/**
 * Changes · Log · Prompt — proof binding to facts for the task's latest run.
 * Log is the pre-existing `RunOutputSection`, unchanged, just relocated from
 * its own collapsible into the default tab; Radix only mounts the active
 * tab's content, which is what keeps Changes/Prompt from fetching until
 * opened. Never auto-switches — `defaultValue` only sets the first render.
 */
function RunArtifactTabs({
  latestRun,
  currentSha,
}: { latestRun: ActiveRun; currentSha: string | null }) {
  return (
    <Tabs defaultValue="log">
      <TabsList>
        <TabsTrigger value="changes">Changes</TabsTrigger>
        <TabsTrigger value="log">
          Log
          {latestRun.status === 'running' && (
            <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
          )}
        </TabsTrigger>
        <TabsTrigger value="prompt">Prompt</TabsTrigger>
      </TabsList>
      <TabsContent value="changes">
        <ChangesTab runId={latestRun.id} currentSha={currentSha} />
      </TabsContent>
      <TabsContent value="log">
        <RunOutputSection runId={latestRun.id} isRunning={latestRun.status === 'running'} />
      </TabsContent>
      <TabsContent value="prompt">
        <PromptTab runId={latestRun.id} />
      </TabsContent>
    </Tabs>
  );
}

interface TaskDetailPanelProps {
  task: Task;
  projects: Project[];
  goals: Goal[];
  allTasks?: Task[];
  onUpdate: (data: TaskFormData) => void;
  onDelete: () => void;
  onClose: () => void;
  /**
   * Field-level task update (the same `update()` `useTasks()` returns) — used
   * for "mark reviewed" and "add comment", which must not close the panel the
   * way `onUpdate` does. Routes through the real store (checked response,
   * optimistic update, revert-on-failure) instead of a bespoke raw `fetch`
   * that silently discarded failures (W7).
   */
  updateTaskFields: (id: string, updates: Partial<Task>) => Promise<Task>;
}

export function TaskDetailPanel({
  task,
  projects,
  goals,
  allTasks,
  onUpdate,
  onDelete,
  onClose,
  updateTaskFields,
}: TaskDetailPanelProps) {
  // W21: a global Escape used to close the panel unconditionally, discarding
  // whatever was mid-edit in the form below — Escape is also how a Select
  // dropdown closes itself, so it fires far more often than "I want to leave".
  const [formDirty, setFormDirty] = useState(false);
  const { events } = useActivityLog();
  const { messages } = useInbox();
  const { agents } = useAgents();
  const { runs } = useActiveRuns();
  const { runs: verificationRuns } = useVerificationRuns(task.id);
  const latestVerificationRunId = verificationRuns[0]?.id ?? null;
  const verificationState = taskVerificationState(task);
  const [commentText, setCommentText] = useState('');
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Find runs for this task (most recent first)
  const taskRuns = runs
    .filter((r) => r.taskId === task.id)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const latestRun = taskRuns[0] ?? null;
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const activeAgents = agents.filter((a) => a.status === 'active');
  const deployableAgents = activeAgents.filter((a) => a.id !== 'me');

  // Focus management: move focus into panel on open, restore on close
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    return () => {
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    };
  }, [task]);

  // Close on Escape key — but not over an unsaved edit (W21).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (formDirty && !window.confirm('Discard unsaved changes to this task?')) return;
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, formDirty]);

  const handleUpdate = useCallback(
    (data: TaskFormData) => {
      onUpdate(data);
      onClose();
    },
    [onUpdate, onClose],
  );

  const handleDeploy = useCallback(
    (role: AgentRole) => {
      const deployData: TaskFormData = {
        title: task.title,
        description: task.description,
        importance: task.importance,
        urgency: task.urgency,
        kanban: task.kanban === 'not-started' ? 'in-progress' : task.kanban,
        projectId: task.projectId,
        milestoneId: task.milestoneId,
        assignedTo: role,
        collaborators: task.collaborators ?? [],
        tags: task.tags.join(', '),
        notes: task.notes,
        subtasks: task.subtasks ?? [],
        blockedBy: task.blockedBy ?? [],
        estimatedMinutes: task.estimatedMinutes ?? null,
        dueDate: task.dueDate ?? null,
        acceptanceCriteria: (task.acceptanceCriteria ?? []).join('\n'),
      };
      const agent = agents.find((a) => a.id === role);
      const agentLabel = agent?.name ?? role;
      toast.success(`Deployed to ${agentLabel}`, { icon: '🚀' });
      onUpdate(deployData);
      onClose();
    },
    [task, agents, onUpdate, onClose],
  );

  const handleMarkReviewed = useCallback(async () => {
    try {
      await updateTaskFields(task.id, { reviewed: true });
      toast.success('Marked as reviewed');
      onClose();
    } catch {
      toast.error('Failed to mark reviewed');
    }
  }, [task.id, onClose, updateTaskFields]);

  const handleAddComment = useCallback(async () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;

    const newComment: TaskComment = {
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      author: 'me',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    const existingComments = task.comments ?? [];
    try {
      // Goes through the real store (checked response, optimistic + revert on
      // failure) instead of a raw fetch that never checked `res.ok` and
      // mutated the `task` prop directly — a failed write used to show
      // "Comment added" and vanish on the next poll.
      await updateTaskFields(task.id, { comments: [...existingComments, newComment] });
      setCommentText('');
      toast.success('Comment added');
    } catch {
      toast.error('Failed to add comment');
    }
  }, [commentText, task.id, task.comments, updateTaskFields]);

  const quadrant = getQuadrant(task);
  const qi = quadrantLabels[quadrant];
  const project = projects.find((p) => p.id === task.projectId);

  // Summary stats
  const subtaskCount = task.subtasks?.length ?? 0;
  const subtaskDone = task.subtasks?.filter((s) => s.done).length ?? 0;
  const depCount = task.blockedBy?.length ?? 0;
  const criteriaCount = task.acceptanceCriteria?.length ?? 0;

  // Timeline: merge activity events + inbox messages for this task
  const taskEvents = events
    .filter((e) => e.taskId === task.id)
    .map((e) => ({
      id: e.id,
      type: 'event' as const,
      actor: e.actor,
      summary: e.summary,
      timestamp: e.timestamp,
    }));
  const taskMessages = messages
    .filter((m) => m.taskId === task.id)
    .map((m) => ({
      id: m.id,
      type: 'message' as const,
      actor: m.from,
      summary: `${m.type}: ${m.subject}`,
      timestamp: m.createdAt,
    }));
  const timeline = [...taskEvents, ...taskMessages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Comments
  const comments = task.comments ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm cursor-pointer"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Task details"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-full md:max-w-lg flex-col border-l bg-card shadow-2xl animate-in slide-in-from-right duration-200 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-xs', qi.color)}>
              {qi.label}
            </Badge>
            {verificationState && (
              <VerificationPill
                status={verificationState}
                verdictHref={
                  latestVerificationRunId ? `/verification/${latestVerificationRunId}` : null
                }
              />
            )}
            {/* Mark reviewed — shown for done agent tasks not yet reviewed; reads as "acknowledged" next to verification status */}
            {task.kanban === 'done' &&
              task.assignedTo &&
              task.assignedTo !== 'me' &&
              !task.reviewed && (
                <Tip content="Mark as reviewed — removes from Attention Required">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1 border-green-500/50 text-green-500 hover:bg-green-500/10"
                    onClick={handleMarkReviewed}
                  >
                    <Eye className="h-3 w-3" />
                    Mark Reviewed
                  </Button>
                </Tip>
              )}
            {project && (
              <Badge
                variant="outline"
                className="text-xs"
                style={{ borderColor: project.color, color: project.color }}
              >
                {project.name}
              </Badge>
            )}
            {/* Quick stats badges */}
            {subtaskCount > 0 && (
              <Badge variant="secondary" className="text-xs gap-1">
                <ListChecks className="h-3 w-3" />
                {subtaskDone}/{subtaskCount}
              </Badge>
            )}
            {depCount > 0 && (
              <Badge variant="secondary" className="text-xs gap-1 border-yellow-500/30">
                <Link2 className="h-3 w-3" />
                {depCount} dep{depCount > 1 ? 's' : ''}
              </Badge>
            )}
            {criteriaCount > 0 && (
              <Badge variant="secondary" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {criteriaCount} criteria
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Deploy button */}
            <DropdownMenu>
              <Tip content="Deploy to agent">
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary hover:bg-primary/10"
                    aria-label="Deploy to agent"
                  >
                    <Rocket className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                {deployableAgents.map((agent) => {
                  const Icon = getAgentIcon(agent.id, agent.icon);
                  const isCurrentAssignee = task.assignedTo === agent.id;
                  return (
                    <DropdownMenuItem
                      key={agent.id}
                      onClick={() => handleDeploy(agent.id)}
                      className={cn(isCurrentAssignee && 'bg-accent')}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      <span className="flex-1">{agent.name}</span>
                      {isCurrentAssignee && (
                        <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                          active
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tip content="Delete task">
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteConfirm(true)}
                aria-label="Delete task"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Tip>
            <Tip content="Close panel">
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </Tip>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4">
          {/* Form */}
          <TaskForm
            initial={{
              title: task.title,
              description: task.description,
              importance: task.importance,
              urgency: task.urgency,
              kanban: task.kanban,
              projectId: task.projectId,
              milestoneId: task.milestoneId,
              assignedTo: task.assignedTo,
              collaborators: task.collaborators ?? [],
              tags: task.tags.join(', '),
              notes: task.notes,
              subtasks: task.subtasks ?? [],
              blockedBy: task.blockedBy ?? [],
              estimatedMinutes: task.estimatedMinutes ?? null,
              dueDate: task.dueDate ?? null,
              acceptanceCriteria: (task.acceptanceCriteria ?? []).join('\n'),
            }}
            projects={projects}
            goals={goals}
            allTasks={allTasks}
            currentTaskId={task.id}
            onSubmit={handleUpdate}
            onCancel={onClose}
            submitLabel="Save Changes"
            onDirtyChange={setFormDirty}
          />

          <LinksSection task={task} runCount={taskRuns.length} />

          <OutcomeSection task={task} />

          <CriteriaSection task={task} />

          {/* Comments Thread */}
          <Collapsible open={commentsOpen} onOpenChange={setCommentsOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:text-foreground text-muted-foreground transition-colors">
              <MessageSquare className="h-4 w-4" />
              <span className="text-sm font-medium">
                Comments {comments.length > 0 && `(${comments.length})`}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              {/* Existing comments */}
              {comments.length > 0 ? (
                <div className="space-y-3">
                  {comments.map((comment) => {
                    const authorAgent = agents.find((a) => a.id === comment.author);
                    const AuthorIcon =
                      comment.author === 'system'
                        ? Activity
                        : getAgentIcon(comment.author, authorAgent?.icon);
                    return (
                      <div key={comment.id} className="flex gap-2">
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <AuthorIcon className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">
                              {comment.author === 'system'
                                ? 'System'
                                : (authorAgent?.name ?? comment.author)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatDateTime(comment.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
                            {comment.content}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-1">No comments yet</p>
              )}

              {/* Add comment */}
              <div className="flex gap-2">
                <Textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment..."
                  className="min-h-[60px] text-xs resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                />
                <Tip content="Post comment">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0 self-end"
                    onClick={handleAddComment}
                    disabled={!commentText.trim()}
                    aria-label="Send comment"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </Tip>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Activity Timeline */}
          <Collapsible open={timelineOpen} onOpenChange={setTimelineOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:text-foreground text-muted-foreground transition-colors">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">
                Timeline {timeline.length > 0 && `(${timeline.length})`}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              {timeline.length > 0 ? (
                <div className="relative space-y-0 pl-3 border-l border-border">
                  {timeline.map((item) => {
                    const actorAgent = agents.find((a) => a.id === item.actor);
                    const ActorIcon =
                      item.actor === 'system'
                        ? Activity
                        : getAgentIcon(item.actor, actorAgent?.icon);
                    return (
                      <div key={item.id} className="relative pb-3 last:pb-0">
                        <div className="absolute -left-[calc(0.75rem+4.5px)] top-1 h-2 w-2 rounded-full bg-border" />
                        <div className="flex items-start gap-2">
                          <ActorIcon className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground truncate">{item.summary}</p>
                            <p className="text-[10px] text-muted-foreground/60">
                              {formatDateTime(item.timestamp)}
                            </p>
                          </div>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            {item.type === 'event' ? 'activity' : 'message'}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-1">No activity yet</p>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Changes · Log · Prompt — proof binding to facts for this task's latest run. */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 py-1 text-muted-foreground">
              <Terminal className="h-4 w-4" />
              <span className="text-sm font-medium">Run</span>
            </div>
            {latestRun ? (
              <RunArtifactTabs
                latestRun={latestRun}
                currentSha={currentShaForProject(runs, task.projectId)}
              />
            ) : (
              <p className="text-xs text-muted-foreground py-1">This task has no runs yet.</p>
            )}
          </div>

          {/* Verification */}
          <VerificationSection
            runs={verificationRuns}
            verificationAttempts={task.verificationAttempts}
          />
        </div>

        {/* Footer timestamps */}
        <div className="border-t px-4 py-2 text-xs text-muted-foreground flex justify-between">
          <span>Created: {formatRelativeTime(task.createdAt)}</span>
          <span>Updated: {formatRelativeTime(task.updatedAt)}</span>
          {task.estimatedMinutes && <span>Est: {task.estimatedMinutes}m</span>}
        </div>
      </aside>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete task?"
        description={`"${task.title}" will be permanently deleted. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={onDelete}
      />
    </>
  );
}
