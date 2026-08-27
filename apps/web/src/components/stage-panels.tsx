'use client';

/**
 * The drawer host every stage page mounts (UX-REDESIGN §11: one primary
 * surface, drawers for the rest, one header row). The six tabs the old
 * per-project nav used to spread across (References, Design Files, Notes,
 * Terminal, Runs, Knowledge) absorb into whichever stage owns them, reachable
 * as a `?panel=<name>` drawer instead of a sibling route — same right-side
 * overlay shape as Talk (`components/talk/talk-drawer.tsx`), closed by
 * clearing the param rather than navigating away, so the stage underneath is
 * exactly where the user left it.
 *
 * A stage page passes only the panel names it actually owns (CONTRACTS-phase3
 * "Panel deep links"): a `?panel=knowledge` on Build does nothing, because
 * Build's host was never given "knowledge" to render.
 */

import { KnowledgeContent } from '@/app/projects/[id]/knowledge/knowledge-content';
import { RunRow, sortRuns } from '@/components/run-row';
import { TerminalPanel } from '@/components/studio/terminal-panel';
import { Button } from '@/components/ui/button';
import { DesignFilesPanel, NotesPanel, ReferencesPanel } from '@/components/workspace';
import { useProjects, useTasks } from '@/hooks/use-data';
import { useActiveRunsContext as useActiveRuns } from '@/providers/active-runs-provider';
import { X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type PanelName = 'references' | 'design-files' | 'notes' | 'terminal' | 'runs' | 'knowledge';

const PANEL_LABEL: Record<PanelName, string> = {
  references: 'References',
  'design-files': 'Design files',
  notes: 'Notes',
  terminal: 'Terminal',
  runs: 'Runs',
  knowledge: 'Knowledge',
};

/**
 * The absorbed tabs' new address — a stage route with its drawer open. Every
 * redirect shell (`references/page.tsx`, `terminal/page.tsx`, …) targets one
 * of these; this is the one place that builds the string so the two can't
 * drift apart.
 */
export function panelHref(projectId: string, stagePath: string, panel: PanelName): string {
  return `/projects/${projectId}/${stagePath}?panel=${panel}`;
}

/** The project's own run history (old `runs/page.tsx`), now the Runs drawer's body. */
function RunsPanelContent({ projectId }: { projectId: string }) {
  const { tasks } = useTasks();
  const { runs, refetch: refetchRuns } = useActiveRuns();

  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const titles = new Map(projectTasks.map((t) => [t.id, t.title]));
  const projectRuns = sortRuns(
    runs.filter((r) => r.projectId === projectId || titles.has(r.taskId)),
  );

  if (projectRuns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No runs for this project yet. Dispatch a task from Build, or watch every agent session on{' '}
        <Link href="/runs" className="underline underline-offset-2">
          Runs
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {projectRuns.filter((r) => r.status === 'running').length} running · {projectRuns.length}{' '}
        total ·{' '}
        <Link href="/runs" className="underline underline-offset-2">
          all runs
        </Link>
      </p>
      {projectRuns.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          taskTitle={titles.get(run.taskId) ?? 'Untitled task'}
          onChanged={() => void refetchRuns()}
        />
      ))}
    </div>
  );
}

/** Terminal needs a repo to open a shell in — the old page's `notFound()` guard, kept honest as a drawer message instead. */
function TerminalPanelContent({ projectId }: { projectId: string }) {
  const { projects, loading } = useProjects();
  const project = projects.find((p) => p.id === projectId);

  if (loading) return <p className="text-sm text-muted-foreground">Loading the terminal…</p>;
  if (!project?.repoPath) {
    return <p className="text-sm text-muted-foreground">No repo — nothing to open a shell in.</p>;
  }
  return <TerminalPanel projectId={projectId} />;
}

function panelBody(panel: PanelName, projectId: string) {
  switch (panel) {
    case 'references':
      return <ReferencesPanel projectId={projectId} />;
    case 'design-files':
      return <DesignFilesPanel projectId={projectId} />;
    case 'notes':
      return <NotesPanel projectId={projectId} />;
    case 'terminal':
      return <TerminalPanelContent projectId={projectId} />;
    case 'runs':
      return <RunsPanelContent projectId={projectId} />;
    case 'knowledge':
      return <KnowledgeContent projectId={projectId} />;
  }
}

export function StagePanelHost({ projectId, panels }: { projectId: string; panels: PanelName[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('panel') as PanelName | null;
  const panel = requested && panels.includes(requested) ? requested : null;

  if (!panel) return null;

  function close() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('panel');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 cursor-pointer bg-black/40 backdrop-blur-sm"
        onClick={close}
      />
      <aside
        role="dialog"
        aria-label={PANEL_LABEL[panel]}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-full flex-col border-l bg-card shadow-2xl outline-none animate-in slide-in-from-right duration-200 md:max-w-md"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{PANEL_LABEL[panel]}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={close}
            aria-label={`Close ${PANEL_LABEL[panel]}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{panelBody(panel, projectId)}</div>
      </aside>
    </>
  );
}
