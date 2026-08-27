'use client';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { FailureCard, classifyBootStatus } from '@/components/failure';
import type { JourneyPayload } from '@/components/journeys-form';
import { JourneyFormDialog } from '@/components/journeys-form-dialog';
import { WidgetSkeleton } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tip } from '@/components/ui/tip';
import { useBaselines } from '@/hooks/use-journeys';
import { apiFetch } from '@/lib/api-client';
import { showError, showSuccess } from '@/lib/toast';
import {
  type Journey,
  PROJECT_SHAPES,
  type Project,
  type ProjectKnowledge,
  type ProjectShape,
  type ServerBootRecipe,
} from '@ligma/api';
import { AlertTriangle, CheckCircle2, FileWarning, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
/**
 * Knowledge: `.ligma/` rendered (UX spec §6, twin primitives §2).
 *
 * Everything here travels with the repo and is deliberately readable by the
 * builder — except the **baselines browser** at the bottom, which reads the
 * central, tool-denied store. Both are shown on one screen because the human
 * needs to see them together; only the agent's filesystem grant separates them.
 *
 * The project's shape is changeable here, which is the promise the discovery
 * question makes ("changeable later in Knowledge") being kept.
 *
 * Extracted from `page.tsx` (CONTRACTS-phase3, Agent L1 handshake) so it can
 * mount both as the route's own body and inside the Proof stage's `knowledge`
 * drawer (`stage-panels.tsx`) — one implementation, two mount points.
 */
import { useCallback, useEffect, useState } from 'react';

export function KnowledgeContent({ projectId }: { projectId: string }) {
  const [knowledge, setKnowledge] = useState<ProjectKnowledge | null>(null);
  const [shape, setShape] = useState<ProjectShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingQuirk, setAddingQuirk] = useState(false);
  const [quirkDraft, setQuirkDraft] = useState('');
  const [savingQuirk, setSavingQuirk] = useState(false);
  const [journeyDialog, setJourneyDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; journey: Journey } | null
  >(null);
  const [deletingJourney, setDeletingJourney] = useState<Journey | null>(null);
  const { baselines, error: baselinesError } = useBaselines(projectId);

  const load = useCallback(async () => {
    try {
      const [k, p] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/knowledge`),
        apiFetch(`/api/projects/${projectId}`),
      ]);
      const json = (await k.json()) as ProjectKnowledge & { error?: string };
      if (!k.ok) throw new Error(json.error ?? 'Could not read .ligma/');
      setKnowledge(json);
      if (p.ok) {
        const project = (await p.json()) as Project;
        setShape(project.shape ?? null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeShape(next: ProjectShape) {
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shape: next }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error?: string }).error ?? 'Could not change the shape',
        );
      setShape(next);
      showSuccess(`Shape is now ${next} — the pipeline follows it`);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Appends into `project.md`'s conventional Quirks section, not a new one. */
  async function addQuirk() {
    setSavingQuirk(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/knowledge/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: quirkDraft.trim(), section: 'quirks' }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error?: string }).error ?? 'Could not record the quirk',
        );
      setQuirkDraft('');
      setAddingQuirk(false);
      await load();
      showSuccess('Quirk recorded in .ligma/project.md');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingQuirk(false);
    }
  }

  /** POST for a new journey, PATCH for an edit — origin is never sent, so an edit can't flip it. */
  async function saveJourney(payload: JourneyPayload) {
    const editing = journeyDialog?.mode === 'edit' ? journeyDialog.journey : null;
    try {
      const res = await apiFetch(
        editing
          ? `/api/projects/${projectId}/journeys/${editing.id}`
          : `/api/projects/${projectId}/journeys`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error?: string }).error ?? 'Could not save the journey',
        );
      setJourneyDialog(null);
      await load();
      showSuccess(editing ? `Saved ${payload.title}` : `Created ${payload.title}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * The route only removes the .ligma/journeys/<id>.json file — it does not
   * touch verification runs or recorded baselines that cite this journey id,
   * so those survive as evidence for a journey that no longer exists.
   */
  async function deleteJourney(journey: Journey) {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/journeys/${journey.id}`, {
        method: 'DELETE',
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error?: string }).error ?? 'Could not delete the journey',
        );
      await load();
      showSuccess(`Deleted ${journey.title}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <WidgetSkeleton rows={4} />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!knowledge) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Boot recipe</h2>
              <p className="text-xs text-muted-foreground">
                {knowledge.repoPath
                  ? `${knowledge.repoPath}/.ligma/boot.json`
                  : 'No repo path — nothing to boot.'}
              </p>
            </div>
            <BootBadge status={knowledge.bootStatus} />
          </div>

          {knowledge.bootError && (
            <FailureCard
              failureClass={classifyBootStatus(knowledge.bootStatus) ?? 'boot'}
              detail={knowledge.bootError}
              note='This is why "Prove it" refuses rather than spending fifteen minutes finding out.'
            />
          )}

          {knowledge.boot && (
            <dl className="grid gap-1 text-xs sm:grid-cols-[minmax(0,10rem)_1fr]">
              <Fact label="App dir" value={knowledge.boot.appDir} />
              <Fact label="Install" value={knowledge.boot.install?.join(' ') ?? 'none'} />
              {/* An artifact project has no dev server: showing empty health fields
                  for one would describe a thing that does not exist. */}
              {knowledge.boot.dev === null ? (
                <>
                  <Fact label="Artifacts" value={knowledge.boot.artifacts.join(', ')} />
                  <Fact label="Check" value={knowledge.boot.check?.join(' ') ?? 'none'} />
                </>
              ) : (
                <>
                  <Fact label="Dev" value={knowledge.boot.dev.join(' ')} />
                  <Fact label="Port" value={describePort(knowledge.boot.portStrategy)} />
                  <Fact
                    label="Health"
                    value={`${knowledge.boot.healthPath} contains “${knowledge.boot.healthMarker}”`}
                  />
                  <Fact label="Seed" value={knowledge.boot.seed?.join(' ') ?? 'none'} />
                </>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">Shape</h2>
          <p className="text-xs text-muted-foreground">
            Which pipeline this project uses. A headless project never grows a Design stage or a
            Studio tab.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_SHAPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={shape === option}
                onClick={() => void changeShape(option)}
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">project.md</h2>
          {knowledge.projectMd.trim() === '' ? (
            <p className="text-xs text-muted-foreground">
              Nothing recorded yet. Adoption writes its confusion log here, and runs append what
              they learn.
            </p>
          ) : (
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
              {knowledge.projectMd}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Quirks</h2>
              <p className="text-xs text-muted-foreground">
                The things about this codebase that surprise whoever touches it next.
                Adoption&apos;s confusion log lands here, and so does anything a run — or you —
                learns the hard way.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddingQuirk((prev) => !prev)}
              disabled={!knowledge.repoPath}
              className="shrink-0 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {addingQuirk ? 'Cancel' : '＋ Add a quirk'}
            </button>
          </div>

          {addingQuirk && (
            <div className="space-y-2">
              <textarea
                aria-label="New quirk"
                rows={3}
                value={quirkDraft}
                onChange={(e) => setQuirkDraft(e.target.value)}
                placeholder="e.g. the seed script is not idempotent — running it twice duplicates every row"
                className="w-full rounded-md border bg-background p-2 text-xs"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={savingQuirk || quirkDraft.trim() === ''}
                  onClick={() => void addQuirk()}
                  className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {savingQuirk ? 'Saving…' : 'Record it'}
                </button>
              </div>
            </div>
          )}

          {knowledge.quirks.trim() === '' ? (
            <p className="text-xs text-muted-foreground">
              Nothing recorded yet. A repo with no quirks is either very new or very lucky.
            </p>
          ) : (
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
              {knowledge.quirks}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Journeys</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setJourneyDialog({ mode: 'create' })}
                disabled={!knowledge.repoPath}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <Plus className="h-3 w-3" /> New journey
              </button>
              <Link
                href={`/projects/${projectId}/verify`}
                className="text-xs underline underline-offset-2"
              >
                Prove them in Verify
              </Link>
            </div>
          </div>
          {knowledge.journeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">No journeys in .ligma/journeys/ yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {knowledge.journeys.map((j) => (
                <li key={j.id} className="flex items-center gap-2 group">
                  <span className="truncate flex-1">{j.title}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {j.origin}
                  </Badge>
                  <Tip content={`Edit ${j.title}`}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                      onClick={() => setJourneyDialog({ mode: 'edit', journey: j })}
                      aria-label={`Edit ${j.title}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </Tip>
                  <Tip content={`Delete ${j.title}`}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                      onClick={() => setDeletingJourney(j)}
                      aria-label={`Delete ${j.title}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </Tip>
                </li>
              ))}
            </ul>
          )}

          {knowledge.invalidJourneys.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-500">
                <FileWarning className="h-3 w-3" /> {knowledge.invalidJourneys.length} journey file
                {knowledge.invalidJourneys.length > 1 ? 's' : ''} could not be read
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {knowledge.invalidJourneys.map((bad) => (
                  <li key={bad.file}>
                    <code>{bad.file}</code> — {bad.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">Baselines</h2>
          <p className="text-xs text-muted-foreground">
            What working currently looks like, recorded centrally and never in the repo — a builder
            that could read these could teach to the test. Read-only.
          </p>
          {baselinesError ? (
            <p className="text-xs text-destructive">
              Couldn&apos;t load baselines: {baselinesError}
            </p>
          ) : baselines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No characterization baselines yet. The first panel run over a journey records one.
            </p>
          ) : (
            <div className="space-y-2">
              {baselines.map((b) => (
                <div key={`${b.journeyId}-${b.runId}`} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{b.journeyId}</span>
                    <Link
                      href={`/verification/${b.runId}`}
                      className="underline underline-offset-2"
                    >
                      recorded by {b.runId}
                    </Link>
                  </div>
                  <p className="text-muted-foreground">
                    {b.metrics.stepCount} steps · {Math.round(b.metrics.timeOnTaskMs / 1000)}s on
                    task · {b.metrics.misclicks} wrong turns ·{' '}
                    {b.metrics.goalAchieved === null
                      ? 'goal unknown'
                      : b.metrics.goalAchieved
                        ? 'goal reached'
                        : 'goal not reached'}
                  </p>
                  {b.findings.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                      {b.findings.map((f) => (
                        <li key={f.summary}>
                          <span className="uppercase">{f.severity}</span> — {f.summary}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <JourneyFormDialog
        open={journeyDialog !== null}
        onOpenChange={(next) => {
          if (!next) setJourneyDialog(null);
        }}
        journey={journeyDialog?.mode === 'edit' ? journeyDialog.journey : undefined}
        repoPath={knowledge.repoPath}
        onSubmit={(payload) => void saveJourney(payload)}
      />

      {deletingJourney && (
        <ConfirmDialog
          open={deletingJourney !== null}
          onOpenChange={(next) => {
            if (!next) setDeletingJourney(null);
          }}
          title={`Delete "${deletingJourney.title}"?`}
          description={`This removes .ligma/journeys/${deletingJourney.id}.json from the repo. Past verification runs and recorded baselines for this journey are stored separately and are not deleted — they'll stay as evidence for a journey id that no longer resolves to a file.`}
          confirmLabel="Delete"
          onConfirm={() => void deleteJourney(deletingJourney)}
        />
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function BootBadge({ status }: { status: ProjectKnowledge['bootStatus'] }) {
  if (status === 'ready') {
    return (
      <Badge variant="outline" className="gap-1 border-green-600/50 text-green-600 text-xs">
        <CheckCircle2 className="h-3 w-3" /> ready
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600 text-xs">
      <AlertTriangle className="h-3 w-3" /> {status}
    </Badge>
  );
}

function describePort(strategy: ServerBootRecipe['portStrategy']): string {
  switch (strategy.kind) {
    case 'flag':
      return `${strategy.flag} <port>`;
    case 'env':
      return `${strategy.var}=<port>`;
    case 'fixed':
      return `fixed at ${strategy.port}`;
  }
}
