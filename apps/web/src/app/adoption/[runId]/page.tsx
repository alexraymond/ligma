'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { ErrorState } from '@/components/error-state';
import { FailureCard, classifyAdoptionStatus } from '@/components/failure';
import { RunOutputViewer } from '@/components/run-row';
import { WidgetSkeleton } from '@/components/skeletons';
import { ExecutionPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { apiFetch } from '@/lib/api-client';
import { showError, showSuccess } from '@/lib/toast';
import {
  type AdoptionReviewResponse,
  type AdoptionRun,
  type JourneyDecision,
  PROJECT_SHAPES,
  type ProjectShape,
} from '@ligma/api';
import { Check, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

/**
 * What the correction editor opens with: the inferred recipe, or — when the run
 * died before inference produced one — the draft the daemon derives from the
 * repo's own facts. Never an empty box the human has to invent JSON into.
 */
function recipeText(run: AdoptionRun): string {
  return JSON.stringify(run.boot ?? run.bootDraft ?? {}, null, 2);
}

/**
 * The adoption review sheet (UX spec F2 step 3): confirm the boot recipe, accept
 * / edit / reject the proposed journeys — **one screen, batch actions**.
 *
 * While the run is still crawling this is just a watchable run like any other;
 * the sheet appears the moment it reaches `awaiting-review`. Nothing is written
 * into the target repo until this form is submitted.
 *
 * ponytail: the recipe is corrected as JSON rather than through six typed
 * sub-forms (port strategy is a discriminated union). This is a developer tool
 * and the recipe is six fields; a typed editor is the upgrade if it ever bites.
 */
export default function AdoptionReviewPage() {
  const runId = useParams<{ runId: string }>().runId;
  const router = useRouter();

  const [run, setRun] = useState<AdoptionRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [shape, setShape] = useState<ProjectShape | null>(null);
  const [bootDraft, setBootDraft] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, { title: string; goal: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/adoption/${runId}`);
      const json = (await res.json()) as AdoptionRun & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Adoption run not found');
      setRun((prev) => {
        // Seed the form once, the first time the sheet is answerable — a poll
        // must never wipe what the human has already typed.
        if (!prev || prev.status !== 'awaiting-review') {
          setName((n) => n || json.repoPath.split('/').filter(Boolean).pop() || '');
          setShape((s) => s ?? json.shape);
          setAccepted(new Set(json.proposedJourneys.map((_, i) => i)));
        }
        return json;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useSmartPoll(load, { intervalMs: 4000, enabled: run?.status === 'running', key: runId });

  /**
   * Go again (F2 recovery). With a recipe the daemon pins it and boots straight
   * from it; without one it re-infers. Either way the run keeps its id, so the
   * failed attempt's log is still there underneath.
   */
  async function retry(rawBoot?: string) {
    let boot: unknown;
    if (rawBoot !== undefined) {
      try {
        boot = JSON.parse(rawBoot);
      } catch {
        showError('The corrected boot recipe is not valid JSON');
        return;
      }
    }

    setBusy(true);
    try {
      const res = await apiFetch(`/api/adoption/${runId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(boot ? { boot } : {}),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'The adoption could not be retried');
      showSuccess(boot ? 'Retrying from your recipe' : 'Retrying');
      setBootDraft(null);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!run) return;
    let boot: unknown;
    if (bootDraft !== null) {
      try {
        boot = JSON.parse(bootDraft);
      } catch {
        showError('The corrected boot recipe is not valid JSON');
        return;
      }
    }
    const journeys: JourneyDecision[] = run.proposedJourneys.map((proposal, index) => {
      if (!accepted.has(index)) return { index, action: 'reject' };
      const edit = edits[index];
      return edit
        ? { index, action: 'accept', edited: { ...proposal, title: edit.title, goal: edit.goal } }
        : { index, action: 'accept' };
    });

    setBusy(true);
    try {
      const res = await apiFetch(`/api/adoption/${runId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(boot ? { boot } : {}),
          ...(shape ? { shape } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
          journeys,
        }),
      });
      const json = (await res.json()) as AdoptionReviewResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'The review could not be applied');
      showSuccess(`Adopted — ${json.acceptedJourneyIds.length} journeys written into .ligma/`);
      router.push(`/projects/${json.projectId}/knowledge`);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <WidgetSkeleton rows={5} />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!run) return null;

  const crumbs = (
    <BreadcrumbNav
      items={[{ label: 'Projects', href: '/projects' }, { label: 'Adopting a repo' }]}
    />
  );

  if (run.status === 'running') {
    return (
      <div className="space-y-4">
        {crumbs}
        <Card>
          <CardContent className="p-6 space-y-2">
            <ExecutionPill state="running" label="crawling" />
            <p className="text-sm">
              Inferring the boot recipe, booting an ephemeral env, and letting an exploratory
              persona walk <code className="text-xs">{run.repoPath}</code>.
            </p>
            <p className="text-xs text-muted-foreground">
              The review sheet opens here as soon as it has something to show. It is watchable like
              any other run on{' '}
              <Link href="/runs" className="underline underline-offset-2">
                Runs
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (run.status === 'error') {
    return (
      <div className="space-y-4">
        {crumbs}
        <FailureCard
          failureClass={classifyAdoptionStatus(run.status) ?? 'boot'}
          detail={run.error}
          action={[
            { label: 'Correct the boot recipe', onClick: () => setBootDraft(recipeText(run)) },
            { label: 'Retry', onClick: () => void retry() },
          ]}
          note={
            <>
              Nothing was written into <code>{run.repoPath}</code>. Retrying unchanged runs the same
              commands again —{' '}
              <a href="#run-log" className="underline underline-offset-2">
                the run log
              </a>{' '}
              says which one stopped it.
            </>
          }
        />

        {bootDraft !== null && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <h2 className="text-sm font-semibold">Boot recipe</h2>
              <p className="text-xs text-muted-foreground">
                {run.boot
                  ? 'What inference produced. Correct it and the retry boots from this instead of inferring again.'
                  : "Inference never got as far as a recipe, so this is drawn from the repo's own files — its lockfile, and the directory that holds the dev script."}
              </p>
              <Textarea
                rows={12}
                className="font-mono text-xs"
                aria-label="Boot recipe"
                value={bootDraft}
                onChange={(e) => setBootDraft(e.target.value)}
              />
              <Button disabled={busy} className="gap-1.5" onClick={() => void retry(bootDraft)}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Retry with this recipe
              </Button>
            </CardContent>
          </Card>
        )}

        <Card id="run-log">
          <CardContent className="p-4 space-y-1">
            <h2 className="text-sm font-semibold">Run log</h2>
            <p className="text-xs text-muted-foreground">
              What this run gathered, inferred and ran — the same stream every run on{' '}
              <Link href="/runs" className="underline underline-offset-2">
                Runs
              </Link>{' '}
              has.
            </p>
            <RunOutputViewer runId={runId} isRunning={false} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (run.status === 'applied') {
    return (
      <div className="space-y-4">
        {crumbs}
        <Card>
          <CardContent className="p-6 space-y-2 text-sm">
            <p>This review has already been applied.</p>
            {run.projectId && (
              <Link
                className="underline underline-offset-2"
                href={`/projects/${run.projectId}/knowledge`}
              >
                Open the project&apos;s Knowledge
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {crumbs}

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-semibold">Boot recipe</h2>
          <p className="text-xs text-muted-foreground">{run.bootRationale}</p>
          {bootDraft === null ? (
            <>
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">
                {JSON.stringify(run.boot, null, 2)}
              </pre>
              <Button variant="outline" size="sm" onClick={() => setBootDraft(recipeText(run))}>
                Correct it
              </Button>
            </>
          ) : (
            <Textarea
              rows={12}
              className="font-mono text-xs"
              value={bootDraft}
              onChange={(e) => setBootDraft(e.target.value)}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="adopt-name">Project name</Label>
            <Input id="adopt-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Shape</Label>
            <div className="flex gap-1.5">
              {PROJECT_SHAPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={shape === option}
                  onClick={() => setShape(option)}
                  className={
                    shape === option
                      ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary'
                      : 'rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent'
                  }
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Proposed journeys{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {accepted.size} of {run.proposedJourneys.length} accepted
              </span>
            </h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAccepted(new Set(run.proposedJourneys.map((_, i) => i)))}
              >
                Accept all
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAccepted(new Set())}>
                Reject all
              </Button>
            </div>
          </div>

          {run.proposedJourneys.length === 0 && (
            <p className="text-xs text-muted-foreground">
              The crawl proposed no journeys. You can still adopt the repo and write journeys by
              hand later.
            </p>
          )}

          {run.proposedJourneys.map((proposal, index) => {
            const on = accepted.has(index);
            const edit = edits[index] ?? { title: proposal.title, goal: proposal.goal };
            // Keyed by index, not title (W26): two AI-proposed journeys can
            // share a title, which would collide two different rows onto one
            // React key. The list itself is static — only per-item
            // accept/edit state (also keyed by index, above) changes.
            return (
              <div
                key={index}
                className={
                  on
                    ? 'rounded-lg border p-3 space-y-2'
                    : 'rounded-lg border border-dashed p-3 space-y-2 opacity-60'
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <Input
                    value={edit.title}
                    aria-label={`Title of proposal ${index + 1}`}
                    onChange={(e) =>
                      setEdits((s) => ({ ...s, [index]: { ...edit, title: e.target.value } }))
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() =>
                      setAccepted((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(index);
                        else next.add(index);
                        return next;
                      })
                    }
                  >
                    {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {on ? 'Accepted' : 'Rejected'}
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={edit.goal}
                  aria-label={`Goal of proposal ${index + 1}`}
                  onChange={(e) =>
                    setEdits((s) => ({ ...s, [index]: { ...edit, goal: e.target.value } }))
                  }
                />
                <p className="text-xs text-muted-foreground">Why: {proposal.rationale}</p>
                <ol className="list-decimal pl-5 text-xs text-muted-foreground">
                  {proposal.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {run.confusionLog.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <h2 className="text-sm font-semibold">Confusion log</h2>
            <p className="text-xs text-muted-foreground">
              What the exploratory persona could not work out. This is the project&apos;s first UX
              audit — it is appended to <code>.ligma/project.md</code> on adopt.
            </p>
            <ul className="space-y-1 text-sm">
              {run.confusionLog.map((entry, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                    {entry.severity}
                  </Badge>
                  <span>{entry.summary}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-muted-foreground">
          One confirm writes .ligma/ into the repo and creates the project.
        </p>
        <Button onClick={() => void submit()} disabled={busy} className="gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Adopt this repo
        </Button>
      </div>
    </div>
  );
}
