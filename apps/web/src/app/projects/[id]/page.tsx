'use client';

import { WidgetSkeleton } from '@/components/skeletons';
import { studioVisible } from '@/components/studio/api';
import { useProjects, useTasks } from '@/hooks/use-data';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { defaultStagePath } from './default-stage';

/**
 * The Overview page is gone (UX-REDESIGN §11 — one primary surface per
 * project, not a landing page plus eight tabs). This route now exists only to
 * send a visit to whichever stage the project actually needs first
 * (`defaultStagePath`, CONTRACTS-phase3 "Fixed shapes"): Studio for a
 * design-shaped project with nothing built yet, Build once there's something
 * to build, Brief otherwise.
 *
 * The old page's content (health board, goals, quick actions) is not ported
 * here — the health board moves to Proof (Agent L2); nothing else survives,
 * per the contract's explicit "do not copy content anywhere, just redirect".
 */
export default function ProjectOverviewRedirect() {
  const projectId = useParams<{ id: string }>().id;
  const router = useRouter();
  const { projects } = useProjects();
  const { tasks, loading: tasksLoading } = useTasks();

  const project = projects.find((p) => p.id === projectId);
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  // The parent layout already returns its own "loading/not found" UI and
  // withholds `children` until `project` resolves (`layout.tsx`), so by the
  // time this mounts `project` is real — this only has to wait on tasks.
  const ready = Boolean(project) && !tasksLoading;

  useEffect(() => {
    if (!ready || !project) return;
    router.replace(
      defaultStagePath(projectId, {
        designShaped: studioVisible(project.shape),
        taskCount: projectTasks.length,
      }),
    );
  }, [ready, project, projectId, projectTasks.length, router]);

  return <WidgetSkeleton rows={4} />;
}
