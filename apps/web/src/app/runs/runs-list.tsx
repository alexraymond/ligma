'use client';

import { ErrorState } from '@/components/error-state';
import { RunRow, sortRuns } from '@/components/run-row';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActiveRun, Task } from '@ligma/api';
import { Activity } from 'lucide-react';
import Link from 'next/link';
/**
 * The Runs list, split out of `runs/page.tsx` so the /needs-you tray's
 * "Running" tab can mount the exact same rendering (props-driven, no
 * page-level data fetching in here — the caller's own `useActiveRuns` /
 * `useTasks` hooks own the fetch, this only draws what they returned).
 */
import { useMemo } from 'react';
import { runsSectionState } from './runs-section';

export function RunsList({
  runs,
  tasks,
  runsError,
  onRefetch,
}: {
  runs: ActiveRun[];
  tasks: Task[];
  runsError: string | null;
  onRefetch: () => void;
}) {
  const taskTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) map.set(t.id, t.title);
    return map;
  }, [tasks]);

  const sortedRuns = useMemo(() => sortRuns(runs), [runs]);
  const runsState = runsSectionState(sortedRuns, runsError);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-blue-500" />
          Runs
        </CardTitle>
        {runsState !== 'error' && (
          <CardDescription>
            {runs.filter((r) => r.status === 'running').length} running
            {' · '}
            {runs.length} total
            {/* F2: adopting a repo is a run like any other, so it is listed here. */}
            {runs.some((r) => r.kind === 'adoption') &&
              ` · ${runs.filter((r) => r.kind === 'adoption').length} adopting a repo`}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {runsState === 'error' ? (
          <ErrorState
            variant="compact"
            title="Couldn't load runs"
            detail={runsError}
            onRetry={onRefetch}
          />
        ) : runsState === 'empty' ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No agent sessions right now. Dispatch a task from the{' '}
            <Link href="/board" className="underline underline-offset-2">
              Board
            </Link>{' '}
            to start one.
          </p>
        ) : (
          <div className="space-y-2">
            {sortedRuns.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                taskTitle={taskTitleMap.get(run.taskId) ?? run.taskId}
                onChanged={onRefetch}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
