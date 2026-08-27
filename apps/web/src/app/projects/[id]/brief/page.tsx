'use client';

import { ErrorState } from '@/components/error-state';
import { FailureCard, classifyCause } from '@/components/failure';
import { AnsweredTurn, QuestionFormCard } from '@/components/question-form';
import { WidgetSkeleton } from '@/components/skeletons';
import { StagePanelHost } from '@/components/stage-panels';
import { PromoteSheet } from '@/components/studio';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { showError, showSuccess } from '@/lib/toast';
import {
  type Brief,
  type DiscoveryAnswers,
  type RunFailureCause,
  editFlagsStale,
  openForm,
} from '@ligma/api';
import { AlertTriangle, Images, Lock, Pencil, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

/**
 * The Brief stage (UX spec F1 step 2, §3): what you asked for, refined by
 * discovery, then locked into an artifact.
 *
 * Discovery is presented as a **thread** (build brief §16 Phase 2): the
 * composer's ask opens it, each `DiscoveryTurn` renders as one exchange —
 * the system's form, then what was answered — and the open form (if any)
 * sits at the end, exactly where the next message would go. This is a
 * re-presentation, not a data change: `QuestionFormCard` and `AnsweredTurn`
 * still own the form scaffolding (the Still-needed header, Skip, You decide,
 * the typed inputs) verbatim, and the store shapes underneath are untouched.
 *
 * Editable until a contract compiles against it. After that an edit flags the
 * dependents stale and raises a Deck card — it never invalidates them (the
 * pinned default, build brief §2), and the banner here says so out loud rather
 * than letting the user find out from a broken build. Amending an already
 * *answered* question (in the thread's history) goes through the same
 * consequence machinery once the brief is locked — see `amend` below.
 */
/**
 * The stage's frame: the References affordance and the drawer host, wrapped
 * around every state this page can be in. A project with no brief is exactly
 * the one whose references matter, so `?panel=references` has to open there
 * too — the drawer cannot live only in the happy path.
 */
function BriefFrame({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link
          href={`/projects/${projectId}/brief?panel=references`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <Images className="h-3.5 w-3.5" /> References
        </Link>
      </div>
      {children}
      <StagePanelHost projectId={projectId} panels={['references']} />
    </div>
  );
}

export default function BriefPage() {
  const projectId = useParams<{ id: string }>().id;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  /**
   * The last discovery pass that failed, and the request that would re-run it.
   *
   * A toast was the wrong home for this: discovery deferred by the governor is
   * a normal, retryable state of the thread, and a notification that has
   * already faded cannot be acted on. The card sits in the thread with the one
   * move that recovers it — the same POST, sent again.
   */
  const [failure, setFailure] = useState<{
    error: string;
    causeKind?: RunFailureCause | null;
    resumesAt?: string | null;
    retry: () => void;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/brief`);
      if (res.status === 404) {
        setBrief(null);
        setError(null);
        return;
      }
      const json = (await res.json()) as { brief?: Brief; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Could not load the brief');
      setBrief(json.brief ?? null);
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

  async function post(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    try {
      const res = await apiFetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        brief?: Brief;
        error?: string;
        causeKind?: RunFailureCause | null;
        resumesAt?: string | null;
      };
      // A 502 still carries the saved brief: the answers landed, the agent
      // didn't. `error` is a harness malfunction, never "your brief failed".
      if (json.brief) setBrief(json.brief);
      if (!res.ok) {
        setFailure({
          error: json.error ?? 'The daemon turned that down',
          causeKind: json.causeKind,
          resumesAt: json.resumesAt,
          retry: () => void post(path, body, method),
        });
        return false;
      }
      setFailure(null);
      return true;
    } catch (err) {
      // The call itself did not land, so there is no classified cause to show.
      showError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Amend one already-answered question — the thread history's Edit
   * affordance. Unlike `post` above this never refuses on a locked brief: the
   * daemon route applies the change regardless and reports back whether it
   * also raised the stale flag, which `AnsweredTurn` surfaces inline next to
   * the edited answer. The one thing worth reflecting up here is that same
   * flag, so the page's own "Dependents are stale" banner does not need a
   * full reload to catch up with it.
   */
  async function amend(formId: string, questionId: string, answer: string | string[]) {
    const res = await apiFetch(`/api/projects/${projectId}/brief/amend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId, questionId, answer }),
    });
    const json = (await res.json()) as { ok?: boolean; staleFlagged?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      showError(json.error ?? 'Could not save that change');
      return null;
    }
    if (json.staleFlagged) {
      setBrief((b) =>
        b ? { ...b, staleFlaggedAt: b.staleFlaggedAt ?? new Date().toISOString() } : b,
      );
    }
    return { staleFlagged: json.staleFlagged ?? false };
  }

  if (loading) return <WidgetSkeleton rows={4} />;
  if (error)
    return (
      <BriefFrame projectId={projectId}>
        <ErrorState message={error} onRetry={() => void load()} />
      </BriefFrame>
    );

  if (!brief) {
    return (
      <BriefFrame projectId={projectId}>
        <Card className="border-dashed">
          <CardContent className="p-6 text-sm text-muted-foreground space-y-2">
            <p>This project has no brief.</p>
            <p>
              Projects started from the Home composer arrive with one. An adopted repo gets its
              brief the first time you ask for something new — until then its knowledge lives in{' '}
              <Link className="underline" href={`/projects/${projectId}/knowledge`}>
                Knowledge
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </BriefFrame>
    );
  }

  const form = openForm(brief);
  const answered = brief.turns.filter((t) => t.answers !== null);
  const editable = brief.status !== 'discovery';

  return (
    <BriefFrame projectId={projectId}>
      {brief.staleFlaggedAt && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-4 flex gap-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Dependents are stale.</p>
              <p className="text-muted-foreground">
                This brief changed after it locked. The designs and tasks built from it still exist
                and still run — they are flagged, not invalidated. The{' '}
                <Link className="underline" href="/deck">
                  Deck
                </Link>{' '}
                is holding the card that decides what happens next.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">The ask</h2>
              <p className="text-xs text-muted-foreground">
                {brief.status === 'discovery'
                  ? 'Discovery is still running — the brief locks once its questions are answered.'
                  : brief.status === 'locked'
                    ? 'Locked. Editable until a contract compiles against it.'
                    : 'Compiled into a signed contract. Edits from here flag dependents stale.'}
                {brief.shape && ` · shape: ${brief.shape}`}
              </p>
            </div>
            {editable && draft === null && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setDraft(brief.prompt)}
              >
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            )}
          </div>

          {draft === null ? (
            <p className="text-sm whitespace-pre-wrap">{brief.prompt}</p>
          ) : (
            <div className="space-y-2">
              <Textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
              {editFlagsStale(brief) && (
                <p className="text-xs text-amber-600">
                  Saving flags every design and task compiled from this brief as stale, and raises a
                  Deck card.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy || draft.trim() === ''}
                  onClick={async () => {
                    if (
                      await post(
                        `/api/projects/${projectId}/brief`,
                        { prompt: draft.trim() },
                        'PATCH',
                      )
                    ) {
                      setDraft(null);
                      showSuccess('Brief updated');
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          )}

          {brief.constraints.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {brief.constraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The discovery thread: one exchange per turn, oldest first, then
          whatever is still open. */}
      <div className="space-y-3" aria-label="Discovery thread">
        {answered.map((turn) => (
          <div key={turn.form.id} className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              System asked · you answered
            </p>
            <AnsweredTurn
              form={turn.form}
              answers={turn.answers as DiscoveryAnswers}
              editable
              onAmend={(questionId, answer) => amend(turn.form.id, questionId, answer)}
            />
          </div>
        ))}

        {failure && (
          <FailureCard
            failureClass={classifyCause(failure.causeKind)}
            detail={failure.error}
            resumeAt={failure.resumesAt ?? null}
            note="Your answers are saved — only the discovery pass did not run."
            action={{ label: 'Try discovery again', onClick: failure.retry }}
          />
        )}

        {form && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              System asks
            </p>
            <QuestionFormCard
              form={form}
              busy={busy}
              onSubmit={(answers) =>
                void post(`/api/projects/${projectId}/brief/answers`, { formId: form.id, answers })
              }
            />
          </div>
        )}

        {brief.status === 'discovery' && (
          <p className="text-xs">
            <button
              type="button"
              className="text-muted-foreground underline hover:text-foreground"
              disabled={busy}
              onClick={async () => {
                // The same lock this stage's own "Lock the brief" button uses
                // (below) — ending discovery early, whether or not a form is
                // still open, so manual editing (the Edit button above) opens up.
                if (await post(`/api/projects/${projectId}/brief`, { lock: true }, 'PATCH')) {
                  setDraft(brief.prompt);
                  showSuccess('Discovery ended — write the brief yourself below.');
                }
              }}
            >
              I&apos;ll write the brief myself
            </button>
          </p>
        )}

        {!form && brief.status === 'discovery' && (
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Discovery has what it needs. Locking makes this the Brief stage artifact.
              </p>
              <Button
                className="gap-1.5"
                disabled={busy}
                onClick={async () => {
                  if (await post(`/api/projects/${projectId}/brief`, { lock: true }, 'PATCH')) {
                    showSuccess('Brief locked');
                  }
                }}
              >
                <Lock className="h-3.5 w-3.5" /> Lock the brief
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Promote straight from the brief — the headless entrance to the *same*
          review sheet an approved design opens (UX spec F1 step 4). Two
          entrances, one sheet: importing the Studio's component is what stops
          this path drifting into a second, lesser flow. */}
      {brief.status !== 'discovery' && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {brief.shape === 'headless'
                ? 'No design stage for this shape — promote straight from the brief.'
                : 'Promote from the brief, or from an approved design in the Studio. Same sheet either way.'}
            </p>
            <Button className="gap-1.5" onClick={() => setPromoting(true)}>
              <Rocket className="h-3.5 w-3.5" /> Promote to build
            </Button>
          </CardContent>
        </Card>
      )}

      <PromoteSheet
        projectId={projectId}
        source={{ brief: brief.id }}
        open={promoting}
        onOpenChange={setPromoting}
        onPromoted={() => void load()}
      />

      {/* What this made — no object is a dead end (seam rule §8.3). */}
      {brief.status !== 'discovery' && (
        <p className="text-xs text-muted-foreground">
          From here:{' '}
          <Link className="underline" href={`/projects/${projectId}/board`}>
            the tasks it compiled into
          </Link>{' '}
          ·{' '}
          <Link className="underline" href={`/projects/${projectId}/verify`}>
            what has been proven
          </Link>
        </p>
      )}
    </BriefFrame>
  );
}
