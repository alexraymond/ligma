'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { EnvPreflightCard } from '@/components/env-preflight-card';
import { ErrorState } from '@/components/error-state';
import { FailureCard } from '@/components/failure';
import { QuotaCard } from '@/components/quota-card';
import { ExecutionPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tip } from '@/components/ui/tip';
import { useDaemon } from '@/hooks/use-daemon';
import { useDaemonLogs } from '@/hooks/use-daemon-logs';
import { useTasks } from '@/hooks/use-data';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useActiveRunsContext as useActiveRuns } from '@/providers/active-runs-provider';
import { ChevronDown, Clock, Rocket, Square, Terminal, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RunsList } from './runs-list';

function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Session-history status is a loose `string` (`use-daemon.ts`'s
 * `SessionHistoryEntry`, not the daemon's `RunStatus` enum), so this stays a
 * local mapping rather than reusing `classifyRunStatus` against a type it does
 * not actually carry. Same rule either way: `deferred` is calm, everything
 * else non-`completed` is a harness malfunction, never a product `failed`.
 */
function classifyHistoryStatus(status: string): 'deferred' | 'harness' | null {
  if (status === 'completed') return null;
  return status === 'deferred' ? 'deferred' : 'harness';
}

function LogLine({ line }: { line: string }) {
  const isError = /\[ERROR\]/i.test(line);
  const isWarn = /\[WARN\]/i.test(line);
  const isSecurity = /\[SECURITY\]/i.test(line);

  return (
    <div
      className={cn(
        'text-xs font-mono whitespace-pre-wrap break-all px-2 py-0.5',
        isError
          ? 'text-red-400'
          : isSecurity
            ? 'text-orange-400'
            : isWarn
              ? 'text-yellow-400'
              : 'text-muted-foreground',
      )}
    >
      {line}
    </div>
  );
}

export default function RunsPage() {
  const { status, config, isRunning, isLoading, error, start, stop } = useDaemon();
  const { runs, error: runsError, refetch: refetchRuns } = useActiveRuns();
  const { tasks } = useTasks();
  const [logsOpen, setLogsOpen] = useState(false);
  const { lines: logLines, total: logTotal } = useDaemonLogs(logsOpen);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Build task title lookup
  const taskTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      map.set(t.id, t.title);
    }
    return map;
  }, [tasks]);

  // Auto-scroll logs to bottom when new lines arrive
  useEffect(() => {
    if (logsOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logLines, logsOpen]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Runs' }]} />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Runs' }]} />
        <ErrorState
          title="Couldn't load the daemon"
          detail={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const completionRate =
    status.stats.tasksDispatched > 0
      ? Math.round((status.stats.tasksCompleted / status.stats.tasksDispatched) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Runs' }]} />

      {/* Status Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6" />
          <h2 className="text-2xl font-bold">Runs</h2>
          {/* The daemon's own state speaks the one execution vocabulary too —
              a stopped autopilot is neutral, not a colour of its own. */}
          {isRunning ? (
            <Tip content={status.pid ? `Daemon process ${status.pid}` : 'Daemon running'}>
              <span>
                <ExecutionPill state="running" label="Running" />
              </span>
            </Tip>
          ) : (
            <Badge variant="secondary">Stopped</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <Tip content="Stop all autonomous processing">
              <Button variant="destructive" size="sm" onClick={stop}>
                <Square className="h-4 w-4 mr-2" />
                Disengage Autopilot
              </Button>
            </Tip>
          ) : (
            <Tip content="Start autonomous agent processing">
              <Button size="sm" onClick={start}>
                <Rocket className="h-4 w-4 mr-2" />
                Launch Autopilot
              </Button>
            </Tip>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground -mt-2">
        Every agent session, live: what the autopilot dispatched, what it is streaming right now,
        what the quota governor deferred, and what the machine can boot. Schedule and execution
        limits are tuned in{' '}
        <Link href="/settings" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </p>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Uptime</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isRunning ? formatDuration(status.stats.uptimeMinutes) : '\u2014'}
            </div>
            {status.startedAt && isRunning && (
              <p className="text-xs text-muted-foreground mt-1">
                Since {formatDateTime(status.startedAt)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tasks Completed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{status.stats.tasksCompleted}</span>
              <span className="text-sm text-muted-foreground">
                / {status.stats.tasksDispatched} dispatched
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{completionRate}% success rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{status.activeSessions.length}</span>
              <span className="text-sm text-muted-foreground">
                / {config.concurrency.maxParallelAgents} max
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failures</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status.stats.tasksFailed}</div>
            {status.lastPollAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Last poll: {formatRelativeTime(status.lastPollAt)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quota — the subscription is the scarce resource, so it gets a card */}
      <QuotaCard governor={status.governor} />

      {/* Preflight — the machine's readiness to build ephemeral envs at all */}
      <EnvPreflightCard />

      {/* Task Runs \u2014 always rendered: a failed `/api/runs` read must show as an
          error, and zero runs must show as an empty state with a way out, never
          as nothing at all (walkthrough M5). Extracted so /needs-you's
          "Running" tab mounts the exact same list off its own hooks. */}
      <RunsList
        runs={runs}
        tasks={tasks}
        runsError={runsError}
        onRefetch={() => void refetchRuns()}
      />

      {/* Daemon Logs */}
      <Collapsible open={logsOpen} onOpenChange={setLogsOpen}>
        <Card>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full text-left cursor-pointer"
              >
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-muted-foreground" />
                  Daemon Logs
                </CardTitle>
                <div className="flex items-center gap-2">
                  {logTotal > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {logLines.length < logTotal
                        ? `last ${logLines.length} of ${logTotal}`
                        : `${logTotal} lines`}
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      logsOpen && 'rotate-180',
                    )}
                  />
                </div>
              </button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {logLines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No log entries yet. Start the daemon to see logs.
                </p>
              ) : (
                <ScrollArea className="h-64 rounded-md border bg-muted/30">
                  <div className="p-1">
                    {logLines.map((line, i) => (
                      <LogLine key={i} line={line} />
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Active Sessions */}
      {status.activeSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              Active Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {status.activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <ExecutionPill state="running" />
                    <div>
                      <p className="font-medium">
                        {session.command === 'task'
                          ? `Task: ${taskTitleMap.get(session.taskId ?? '') ?? 'Untitled task'}`
                          : `/${session.command}`}
                      </p>
                      <p className="text-sm text-muted-foreground" title={`PID ${session.pid}`}>
                        Agent: {session.agentId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {formatRelativeTime(session.startedAt)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent History */}
      {status.history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent History</CardTitle>
            <CardDescription>Last {Math.min(status.history.length, 20)} sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {status.history.slice(0, 20).map((entry) => {
                const failureClass = classifyHistoryStatus(entry.status);
                return (
                  <div key={entry.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium text-sm">
                            {entry.command === 'task'
                              ? `Task: ${entry.taskId}`
                              : `/${entry.command}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Agent: {entry.agentId} &middot; {formatDuration(entry.durationMinutes)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Same execution vocabulary as live runs — a timeout is an
                            `error` (the harness), never a product `failed`. */}
                        <ExecutionPill
                          state={entry.status === 'completed' ? 'done' : 'error'}
                          label={entry.status === 'completed' ? 'done' : `error (${entry.status})`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(entry.completedAt)}
                        </span>
                      </div>
                    </div>
                    {failureClass && (
                      <div className="mt-1.5">
                        <FailureCard
                          failureClass={failureClass}
                          detail={entry.error}
                          variant="inline"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
