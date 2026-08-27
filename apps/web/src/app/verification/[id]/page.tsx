'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { OnboardingHint } from '@/components/onboarding';
import {
  VERIFICATION_TABS,
  VerificationReport,
  type VerificationTab,
} from '@/components/verification-report';
import { useTasks } from '@/hooks/use-data';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { VerificationRunManifest } from '@ligma/api';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

/**
 * Just enough of the run to build a human title — id, task/journey scope and
 * start time. `VerificationReport` fetches the full detail (verdict, personas,
 * artifacts) separately once the tab body mounts; this is a second, much
 * smaller GET so the breadcrumb/heading don't have to wait on that.
 */
function useRunHeader(runId: string): VerificationRunManifest | null {
  const [run, setRun] = useState<VerificationRunManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRun(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/verification-runs/${encodeURIComponent(runId)}`);
        if (!res.ok) return;
        const detail = (await res.json()) as { run: VerificationRunManifest };
        if (!cancelled) setRun(detail.run);
      } catch {
        // The heading falls back to the run id below; the tab body reports
        // the real error once it does its own fetch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return run;
}

/** "what was verified" — a task's title, a journey, or (once nothing else is
 * known yet) nothing, so callers can fall back to the plain heading. */
function subjectLabel(
  run: VerificationRunManifest | null,
  taskTitle: string | undefined,
): string | null {
  if (!run) return null;
  if (run.taskId) return taskTitle ?? 'a deleted task';
  if (run.journeyId) return 'a journey';
  return null;
}

async function copyRunId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    showSuccess('Run id copied');
  } catch {
    showError('Could not copy — your browser blocked clipboard access');
  }
}

/**
 * The tab lives in the URL (?tab=timeline), not in component state: a link to the
 * timeline or the screenshot wall is shareable, and back/forward move between
 * tabs because each is a real history entry.
 *
 * Tabs are <Link>s, not a JS tab widget: the anchor IS the state change, so there
 * is no click handler to get wrong and nothing to keep in sync with the URL.
 *
 * The run id comes from useParams(), not `use(params)` — awaiting the params
 * promise in this tree re-suspends the whole page on every tab switch.
 */
function TabbedReport({ id }: { id: string }) {
  const pathname = usePathname();
  const requested = useSearchParams().get('tab');
  const tab: VerificationTab = VERIFICATION_TABS.includes(requested as VerificationTab)
    ? (requested as VerificationTab)
    : 'verdict';

  return (
    <>
      <div
        role="tablist"
        className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground"
      >
        {VERIFICATION_TABS.map((t) => (
          <Link
            key={t}
            role="tab"
            aria-selected={t === tab}
            href={`${pathname}?tab=${t}`}
            scroll={false}
            className={cn(
              'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium capitalize transition-all',
              t === tab ? 'bg-background text-foreground shadow' : 'hover:text-foreground',
            )}
          >
            {t}
          </Link>
        ))}
      </div>
      <VerificationReport runId={id} tab={tab} />
    </>
  );
}

export default function VerificationRunPage() {
  const { id } = useParams<{ id: string }>();
  const run = useRunHeader(id);
  const { tasks } = useTasks();
  const taskTitle = run?.taskId ? tasks.find((t) => t.id === run.taskId)?.title : undefined;
  const subject = subjectLabel(run, taskTitle);
  const when = run ? formatDateTime(run.startedAt) : null;

  return (
    // Walkthrough p1: the shell's <main> already insets every page (p-4 md:p-6) —
    // this page was doubling that inset on top, landing ~160px further right
    // than every other surface.
    <div className="max-w-4xl space-y-4">
      {/* The breadcrumb leaf is what was verified, not the run's storage id —
          the id is still one click away, in the heading below (M6/M7). */}
      <BreadcrumbNav items={[{ label: 'Verification' }, { label: subject ?? 'Run' }]} />
      <div>
        <h1 className="text-lg font-semibold">
          {subject ? `Verifying ${subject}` : 'Verification run'}
        </h1>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {when && <span>{when}</span>}
          {when && <span aria-hidden>·</span>}
          <button
            type="button"
            onClick={() => copyRunId(id)}
            className="font-mono underline decoration-dotted underline-offset-2 hover:text-foreground"
            title="Copy the full run id"
          >
            {id}
          </button>
        </p>
      </div>
      <OnboardingHint
        id="first-verdict"
        title="This is a verdict"
        body="Signed evidence, not a claim — screenshots and criterion results below prove (or disprove) the contract. Every verdict links back to its run and task."
      />
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground py-4">Loading verification report...</p>
        }
      >
        <TabbedReport id={id} />
      </Suspense>
    </div>
  );
}
