'use client';

/**
 * The Studio tab — UI shapes only.
 *
 * "Only the stages the project uses render — a headless project shows no Design
 * stage and no Studio tab at all, rather than an empty one (an unused stage is
 * noise, an absent one is information)" (UX spec §4), and CONTRACTS-phase3:
 * "headless projects never see a Studio tab". So a headless project gets a 404
 * here, not a disabled surface: the route is as absent as the tab.
 */

import { StagePanelHost } from '@/components/stage-panels';
import { studioVisible } from '@/components/studio/api';
import { StudioSurface } from '@/components/studio/studio-surface';
import { useProjects } from '@/hooks/use-data';
import { notFound, useParams } from 'next/navigation';

export default function StudioPage() {
  const projectId = useParams<{ id: string }>().id;
  const { projects, loading } = useProjects();
  const project = projects.find((p) => p.id === projectId);

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading the studio…</p>;
  }
  if (!project || !studioVisible(project.shape)) {
    notFound();
  }

  return (
    <>
      <StudioSurface projectId={projectId} />
      {/* The absorbed Design files tab (CONTRACTS-phase3). Without this host,
          `/projects/:id/studio?panel=design-files` — where
          `design-files/page.tsx` redirects — landed on the workspace and did
          nothing. The host renders as a fixed overlay sheet, so it sits over
          the full-screen canvas exactly as it does over a normal stage page.

          References rides the same host (roadmap phase 5): the mood board is a
          thing you look at *while* prompting, not only while writing the brief,
          so Studio gets its own door to it — Brief keeps its copy of the panel,
          both read the same project references. */}
      <StagePanelHost projectId={projectId} panels={['design-files', 'references']} />
    </>
  );
}
