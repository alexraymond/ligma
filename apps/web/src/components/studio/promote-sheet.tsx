'use client';

/**
 * The Promote-to-build review sheet — one sheet, two entrances.
 *
 * UX spec F1.4: "the seam that must feel like one motion, with two entrances —
 * from an approved design (UI) or **directly from the brief** (headless).
 * Either way it opens the same single review sheet: the generated task
 * breakdown, acceptance criteria (with the holdout note), proposed journeys,
 * estimated token budget from the governor. One confirm → contract compiled and
 * signed."
 *
 * ── Reuse ───────────────────────────────────────────────────────────────────
 * This component is the shared one. The brief entrance (P3-E) imports it from
 * `@/components/studio/promote-sheet` and passes `source={{ brief }}` instead
 * of `source={{ designId }}`; everything else — preview fetch, holdout note,
 * governor read-out, confirm — is identical, which is what stops the headless
 * path being a lesser version of the flow.
 */

import { FailureCard, classifyCause } from '@/components/failure';
import { OnboardingHint } from '@/components/onboarding';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PromotePreview, PromoteResult } from '@ligma/api';
import { AlertTriangle, EyeOff, GitBranch, ListChecks, Rocket } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { promote, promotePreview } from './api';

/** Which entrance opened the sheet. Exactly one field is set. */
export type PromoteSource =
  | { designId: string; brief?: undefined }
  | { brief: string; designId?: undefined };

/**
 * The isolation sentence (UX-REDESIGN §16) — but the true version. Checked
 * against apps/daemon/src/engine/task-env.ts (`builderCwd`) and
 * apps/daemon/src/engine/run-task.ts's spawn (`cwd: builderCwd(...)`): a
 * builder's cwd IS the project's own repoPath, not a worktree copy — a real
 * git checkout with real, uncommitted file writes. Only verification/proof
 * (apps/daemon/src/harness/run-verification.ts, run-journey.ts) boots from a
 * throwaway `createEnv()` worktree snapshot, so proving a build never
 * disturbs the working tree a builder just wrote into. Nothing anywhere calls
 * `git push` — GitHub only changes if the person promoting pushes it there.
 */
export const PROMOTE_ISOLATION_SENTENCE =
  "Builders write straight into this project's own repo on disk once a task runs — not a separate copy. " +
  'Verification boots each build from an isolated snapshot instead, so proving it never disturbs that working ' +
  'copy. Nothing here ever pushes to GitHub — that stays yours to do.';

/**
 * Reversibility (UX-REDESIGN §16). Checked against apps/daemon/src/studio/promote.ts
 * (`commitPromote` is documented as "the irreversible half" — the compiled,
 * signed contract stays recorded) and apps/daemon/src/routes/tasks/route.ts's
 * DELETE handler (a promoted task can be deleted, soft or hard) plus the
 * paused-project dispatch gate (5e607ec, F1).
 */
export const PROMOTE_REVERSIBILITY_LINE =
  "The signed contract stays on record after this — that part doesn't undo. But the tasks it creates can " +
  'still be deleted from the Board, and pausing the project stops any new one from starting.';

export interface PromoteSheetProps {
  projectId: string;
  source: PromoteSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromoted?: (result: PromoteResult) => void;
}

function GovernorLine({ governor }: { governor: PromotePreview['governor'] }) {
  return (
    <div className="rounded border p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">Governor estimate</span>
        <span className="font-mono tabular-nums">
          {governor.estimatedSpawns} spawn{governor.estimatedSpawns === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        window {governor.used}/{governor.max} over {governor.windowHours}h · reserve floor{' '}
        {governor.reserveFloor} · {governor.remainingForAutonomy} left for autonomy
      </p>
      {governor.killSwitch ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Kill switch is on — nothing will spawn until it is cleared.
        </p>
      ) : governor.willDefer ? (
        // Deferred is calm, not alarming (UX spec §7) — it is "waiting its turn".
        <p className="mt-1.5 text-amber-600">
          Over current headroom — the daemon will queue these builders and pick them up next cycle.
        </p>
      ) : null}
    </div>
  );
}

export function PromoteSheet({
  projectId,
  source,
  open,
  onOpenChange,
  onPromoted,
}: PromoteSheetProps) {
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const designId = source.designId;
  const brief = source.brief;

  const load = useCallback(async () => {
    setPreview(null);
    setError(null);
    try {
      setPreview(await promotePreview(projectId, designId ? { designId } : { brief }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, designId, brief]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const confirm = async (): Promise<void> => {
    if (!preview) return;
    setBusy(true);
    try {
      // The confirmed preview is echoed back rather than recomputed, so the
      // user cannot approve one breakdown and have another compiled.
      const result = await promote(projectId, preview);
      onOpenChange(false);
      onPromoted?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const criteriaFor = (tempId: string) =>
    (preview?.criteria ?? []).filter((c) => c.taskTempId === tempId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Promote to build</DialogTitle>
          <DialogDescription>
            This freezes what &ldquo;done&rdquo; means for these tasks, signs it, and puts them on
            the Board so building can start &mdash; under the hood, a compiled and signed contract
            with a frozen oracle.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 rounded border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          <p>{PROMOTE_ISOLATION_SENTENCE}</p>
          <p>{PROMOTE_REVERSIBILITY_LINE}</p>
        </div>

        {/*
          Both failure shapes go through the one card family (UX spec F5), never
          a bare string: `error` is the call itself failing (the daemon
          unreachable, a transport error — no structured class exists, so
          `unknown` is honest), `preview.error` is the daemon answering with a
          classified failure it decided at the site that knew. d1-attempt-1's
          personas read a raw "500 Internal Server Error" here with no action;
          every class below carries the one move that recovers it.
        */}
        {error ? (
          <FailureCard
            failureClass="unknown"
            detail={error}
            action={{ label: 'Retry', onClick: () => void load() }}
          />
        ) : null}
        {preview === null && error === null ? (
          <p className="text-sm text-muted-foreground">Building the proposal…</p>
        ) : null}
        {preview?.error ? (
          <FailureCard
            failureClass={classifyCause(preview.causeKind)}
            detail={preview.error}
            resumeAt={preview.resumesAt ?? null}
            note="Nothing was compiled or signed — the contract is still unfrozen."
            action={{ label: 'Retry', onClick: () => void load() }}
          />
        ) : null}

        {preview ? (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {preview.source === 'design' ? 'from an approved design' : 'from the brief'}
              </Badge>
              {preview.designBaseline ? (
                <span>baseline frozen at version {preview.designBaseline.versionId}</span>
              ) : (
                <span>criteria and journeys only — no design baseline</span>
              )}
            </div>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <ListChecks className="h-4 w-4" aria-hidden />
                Tasks ({preview.tasks.length})
              </h3>
              <ul className="space-y-2">
                {preview.tasks.map((task) => (
                  <li key={task.tempId} className="rounded border p-3">
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                    {task.designFilePaths.length > 0 ? (
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {task.designFilePaths.join(' · ')}
                      </p>
                    ) : null}
                    <ul className="mt-2 space-y-1">
                      {criteriaFor(task.tempId).map((criterion, index) => (
                        <li
                          key={`${task.tempId}-${index}`}
                          className="flex items-start gap-2 text-xs"
                        >
                          {criterion.holdout ? (
                            <EyeOff
                              className="mt-0.5 h-3 w-3 shrink-0 text-amber-600"
                              aria-label="held out from the builder"
                            />
                          ) : (
                            <span className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          )}
                          <span className={criterion.holdout ? 'text-muted-foreground' : ''}>
                            {criterion.text}
                          </span>
                          {criterion.kind === 'invariant' ? (
                            <Badge variant="outline" className="text-[9px]">
                              invariant
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {/* Shown before the confirm precisely because it is irreversible after. */}
              <p className="mt-2 rounded bg-muted/50 p-2 text-xs">{preview.holdoutNote}</p>
              <OnboardingHint
                id="first-promote"
                title="The holdout note"
                body="The builder only ever sees a slice of these criteria — the rest stay hidden until verification, so it can't teach to the test."
                className="mt-2"
              />
            </section>

            {preview.journeys.length > 0 ? (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <GitBranch className="h-4 w-4" aria-hidden />
                  Proposed journeys ({preview.journeys.length})
                </h3>
                <ul className="space-y-2">
                  {preview.journeys.map((journey) => (
                    <li key={journey.tempId} className="rounded border p-3 text-xs">
                      <p className="font-medium">{journey.title}</p>
                      <p className="text-muted-foreground">{journey.goal}</p>
                      <ol className="mt-1 list-decimal pl-4 text-muted-foreground">
                        {journey.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <GovernorLine governor={preview.governor} />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={preview === null || busy}>
            <Rocket className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {busy ? 'Compiling…' : 'Confirm and compile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
