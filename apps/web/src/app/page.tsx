'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { ErrorState } from '@/components/error-state';
import { KickoffComposer } from '@/components/kickoff-composer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tip } from '@/components/ui/tip';
import { useProjects, useTasks } from '@/hooks/use-data';
import { apiFetch } from '@/lib/api-client';
import { browserRailStorage, defaultStagePath, readLastProject } from '@/lib/rail';
import { Check, Database, LoaderCircle, Rocket, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

/**
 * Home is the no-project state and a door — not a dashboard (UX-REDESIGN §3
 * Zone 3, §16).
 *
 * With nothing in the workspace it is the composer over a welcome; with
 * projects it opens the last one you were in. The 851-line command centre that
 * used to live here retired into the surfaces that own its parts: the machine
 * card into the heartbeat and its overlay, comms into the needs-you tray,
 * projects and objectives into the portfolio grid. "There is no dashboard to
 * maintain, so there is no dashboard to go stale."
 */

/**
 * Boot progress for the first paint of a fresh install: two independent hooks,
 * each reporting its own loading state, so an empty data directory still shows
 * something moving rather than a bare skeleton.
 */
function BootProgress({ steps }: { steps: { label: string; done: boolean }[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {steps.map((step) => (
        <span key={step.label} className="flex items-center gap-1.5">
          {step.done ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          )}
          {step.label}
        </span>
      ))}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { projects, loading: projectsLoading, error: projectsError, refetch } = useProjects();
  const { tasks, loading: tasksLoading, error: tasksError } = useTasks();
  const [seeding, setSeeding] = useState(false);

  const loading = projectsLoading || tasksLoading;
  const error = projectsError ?? tasksError;
  const isEmpty = projects.length === 0 && tasks.length === 0;

  /** Where the door leads: the last project's default stage, else the portfolio. */
  const destination = useMemo(() => {
    if (isEmpty) return null;
    const storage = browserRailStorage();
    const lastId = storage ? readLastProject(storage) : null;
    const last = lastId
      ? projects.find((p) => p.id === lastId && !p.deletedAt && p.status !== 'archived')
      : undefined;
    if (!last) return '/projects';
    return defaultStagePath(
      last,
      tasks.some((t) => t.projectId === last.id),
    );
  }, [isEmpty, projects, tasks]);

  useEffect(() => {
    if (loading || error || !destination) return;
    router.replace(destination);
  }, [loading, error, destination, router]);

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      const res = await apiFetch('/api/seed-demo', { method: 'POST' });
      if (res.ok) {
        toast.success('Demo data loaded! Refreshing...');
        setTimeout(() => window.location.reload(), 500);
      } else {
        toast.error('Failed to load demo data');
      }
    } catch {
      toast.error('Failed to load demo data');
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[]} />
        <BootProgress
          steps={[
            { label: 'Projects', done: !projectsLoading },
            { label: 'Workspace data', done: !tasksLoading },
          ]}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[]} />
        <ErrorState title="Couldn't load the workspace" detail={error} onRetry={refetch} />
      </div>
    );
  }

  if (!isEmpty) {
    // The redirect above is already in flight; this is the one frame before it.
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[]} />
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Opening your last project…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[]} />

      {/* The front door (UX spec F1): one prompt box, and the result lands in the rail. */}
      <KickoffComposer />

      <div className="flex flex-col items-center justify-center py-12 md:py-20">
        <div className="mx-auto max-w-lg space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Welcome to Ligma</h1>
            <p className="mt-2 text-muted-foreground">
              Nothing here yet. Describe what you want made above — the project appears in the rail
              on the left and opens on its brief.
            </p>
          </div>

          <Card className="bg-muted/30 text-left">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                <Users className="h-4 w-4 text-purple-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Agents do the building</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Researcher, Developer, Marketer and Business Analyst work through Claude Code and
                  report back here. You direct; they build; the Proof stage says what is actually
                  true.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="border-t border-border pt-2">
            <Tip content="Populate with sample tasks, projects, and goals">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleSeedDemo}
                disabled={seeding}
              >
                <Database className="h-3.5 w-3.5" />
                {seeding ? 'Loading...' : 'Load demo data'}
              </Button>
            </Tip>
            <p className="mt-2 text-xs text-muted-foreground">
              Try Ligma with sample projects, tasks, and agent activity
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
