'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { OnboardingHint } from '@/components/onboarding';
import { PipelineStrip, projectStages } from '@/components/pipeline-strip';
import { RunButton } from '@/components/run-button';
import { WidgetSkeleton } from '@/components/skeletons';
import { TalkLauncher } from '@/components/talk/talk-drawer';
import { Badge } from '@/components/ui/badge';
import { useProjects, useTasks } from '@/hooks/use-data';
import { useProjectPipeline } from '@/hooks/use-project-pipeline';
import { isStudioRoute } from '@/lib/nav';
import { browserRailStorage, recordProjectVisit } from '@/lib/rail';
import { useActiveRunsContext as useActiveRuns } from '@/providers/active-runs-provider';
import { useParams, usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The project space (UX spec §4, §11 "one primary surface, drawers for the
 * rest, one header row"). The global rail stays exactly where it was — this
 * adds the project header and the one stage bar: Brief · Studio · Build ·
 * Proof (CONTRACTS-phase3). The old sibling tab row is gone — the bar is the
 * only nav, so it can't disagree with a second row about what stages exist.
 */
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const projectId = useParams<{ id: string }>().id;
  const pathname = usePathname();
  const { tasks } = useTasks();
  const { projects, loading: projectsLoading } = useProjects();
  const { isProjectRunning, runProject } = useActiveRuns();
  const { brief, designs, error: pipelineError } = useProjectPipeline(projectId);

  const project = projects.find((p) => p.id === projectId);
  const projectTasks = tasks.filter((t) => t.projectId === projectId);

  // MRU + "last project" (CONTRACTS-phase3 "Rail storage") — one write site,
  // the project layout, so every visit counts regardless of which stage it
  // lands on. `browserRailStorage()` is null on the server and in a browser
  // that refuses storage; both are a no-op, not an error.
  useEffect(() => {
    if (!project) return;
    const storage = browserRailStorage();
    if (storage) recordProjectVisit(storage, projectId);
  }, [project, projectId]);

  // Studio is a full-viewport workspace on its existing route (spec
  // 2026-08-26-studio-fullscreen-workspace-design): no breadcrumb, header,
  // progress bar or stage bar — `StudioSurface`'s slim bar carries the way back
  // out. Ahead of the `!project` branch on purpose: the studio route does its
  // own loading and 404 (`studio/page.tsx`), so this must not flash a
  // breadcrumb over it while the project list is still in flight.
  if (isStudioRoute(pathname)) return <>{children}</>;

  if (!project) {
    // Absence has to be established, not assumed: until the list has actually
    // arrived, "not found" is a claim we cannot back — and a project created a
    // second ago is exactly the case that lands here first.
    return (
      <div className="space-y-4">
        <BreadcrumbNav
          items={[
            { label: 'Projects', href: '/projects' },
            { label: projectsLoading ? 'Loading' : 'Not Found' },
          ]}
        />
        {projectsLoading ? (
          <WidgetSkeleton rows={3} />
        ) : (
          <p className="text-muted-foreground">Project not found.</p>
        )}
      </div>
    );
  }

  const done = projectTasks.filter((t) => t.kanban === 'done').length;
  const progress = projectTasks.length > 0 ? Math.round((done / projectTasks.length) * 100) : 0;

  const stages = projectStages(projectId, projectTasks, {
    brief,
    designs,
    adopted: project.tags.includes('adopted'),
    shape: project.shape,
    pipelineError: pipelineError !== null,
  });

  return (
    <div className="space-y-4">
      <BreadcrumbNav items={[{ label: 'Projects', href: '/projects' }, { label: project.name }]} />

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="h-4 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <h1 className="truncate text-xl font-bold" title={project.name}>
            {project.name}
          </h1>
          <Badge variant="outline" className="shrink-0 text-xs capitalize">
            {project.status}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Talk is available in every stage of every project (UX spec §10) —
              so it hangs off the project header, not off any one stage. */}
          <TalkLauncher projectId={projectId} />
          <RunButton
            isRunning={isProjectRunning(projectId)}
            onClick={() => runProject(projectId)}
            size="md"
            title={
              isProjectRunning(projectId) ? 'Project tasks running...' : 'Run all project tasks'
            }
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {progress}% · {projectTasks.length} tasks
        </span>
      </div>

      <OnboardingHint
        id="first-project"
        title="This is your pipeline"
        body="Each stage shows live status — click one to jump straight to it. Only the stages this project actually uses render here."
      />
      <PipelineStrip stages={stages} />

      {children}
    </div>
  );
}
