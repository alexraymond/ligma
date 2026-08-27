'use client';

import { ErrorState } from '@/components/error-state';
import { EvidencePinner } from '@/components/evidence-pinner';
import { FailureCard, type FailureClass, classifyOutcome } from '@/components/failure';
import { RecordPinner } from '@/components/record-pinner';
import { CriterionPill, ExecutionPill, VerificationPill } from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tip } from '@/components/ui/tip';
import { type TimelinePersona, VerificationTimeline } from '@/components/verification-timeline';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type {
  AcceptanceContract,
  Criterion,
  PersonaReport,
  RunArtifact,
  VerificationRunManifest,
  VerificationVerdict,
} from '@ligma/api';
import { AlertTriangle, EyeOff, ImageOff, Terminal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface VerificationRunDetail {
  run: VerificationRunManifest;
  verdict: VerificationVerdict | null;
  personaReports: PersonaReport[];
}

/** Tabs are URL state on /verification/[id]; the task panel passes none and gets everything. */
export type VerificationTab = 'verdict' | 'timeline' | 'screenshots' | 'transcripts';

export const VERIFICATION_TABS: readonly VerificationTab[] = [
  'verdict',
  'timeline',
  'screenshots',
  'transcripts',
];

function evidenceUrl(runId: string, relPath: string): string {
  return `/api/verification-runs/${encodeURIComponent(runId)}/file?path=${encodeURIComponent(relPath)}`;
}

function isImagePath(p: string): boolean {
  return /\.(png|jpe?g)$/i.test(p);
}

/** "personas/naive-user-1/report.json" -> "personas/naive-user-1" */
function dirOf(relPath: string): string {
  return relPath.split('/').slice(0, -1).join('/');
}

/** Screenshots live at personas/<name>/shots/... — group them by that <name>. */
function personaOf(relPath: string): string {
  const parts = relPath.split('/');
  return parts[0] === 'personas' && parts.length > 1 ? parts[1] : 'run';
}

function elapsed(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * personaSeed is a full multi-sentence persona paragraph, not a short id — a
 * naive first-4-words label keeps the table from blowing out; the full text
 * is still available via tooltip.
 */
export function personaSeedLabel(seed: string): string {
  const words = seed.trim().split(/\s+/);
  return words.length > 4 ? `${words.slice(0, 4).join(' ')}…` : words.join(' ');
}

interface VerificationReportProps {
  runId: string;
  /** Compact mode drops the page-level heading (used inline in the task panel). */
  compact?: boolean;
  /** When set, only that tab's section renders. Omit to render every section. */
  tab?: VerificationTab;
}

export function VerificationReport({ runId, compact = false, tab }: VerificationReportProps) {
  const [data, setData] = useState<VerificationRunDetail | null>(null);
  const [criteria, setCriteria] = useState<Map<string, Criterion>>(new Map());
  const [artifacts, setArtifacts] = useState<RunArtifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setCriteria(new Map());
    setArtifacts(null);
    setError(null);

    (async () => {
      try {
        const res = await apiFetch(`/api/verification-runs/${encodeURIComponent(runId)}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const detail = (await res.json()) as VerificationRunDetail;
        if (cancelled) return;
        setData(detail);

        // Criterion text and the full artifact listing are enrichments: a run
        // whose contract was never committed still shows its verdict.
        // A journey run's contract is scoped to the project+journey, not a task.
        const contractScope =
          detail.run.taskId ??
          (detail.run.projectId && detail.run.journeyId
            ? `${detail.run.projectId}__${detail.run.journeyId}`
            : null);
        const [contractRes, artifactRes] = await Promise.all([
          contractScope
            ? apiFetch(
                `/api/contracts/${encodeURIComponent(contractScope)}?version=${detail.run.contractVersion}`,
              )
            : Promise.resolve(new Response(null, { status: 404 })),
          apiFetch(`/api/verification-runs/${encodeURIComponent(runId)}/artifacts`),
        ]);
        if (cancelled) return;

        if (contractRes.ok) {
          const { contracts } = (await contractRes.json()) as { contracts: AcceptanceContract[] };
          // Versions are append-only per scope, so the version match pins the contract.
          setCriteria(new Map((contracts[0]?.criteria ?? []).map((c) => [c.id, c])));
        }
        if (artifactRes.ok) {
          const body = (await artifactRes.json()) as { artifacts: RunArtifact[] };
          setArtifacts(body.artifacts);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load run');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Stable identity so the timeline doesn't refetch every parent render.
  const personas = useMemo<TimelinePersona[]>(
    () =>
      (data?.run.personaReports ?? []).map((relPath) => {
        const dir = dirOf(relPath);
        return { dir, label: dir.split('/').pop() ?? dir };
      }),
    [data],
  );

  if (error) return <ErrorState message={error} compact={compact} />;
  if (!data) {
    return <p className="text-sm text-muted-foreground py-4">Loading verification report...</p>;
  }

  const { run, verdict, personaReports } = data;
  const show = (t: VerificationTab): boolean => tab === undefined || tab === t;

  // Every claim this report makes carries the link to the verdict it comes from,
  // so the pill is honest wherever the report is embedded (seam rule §8.8). A
  // criterion links to its own row; the persona goal links to its transcript.
  const reportHref = `/verification/${encodeURIComponent(run.id)}`;

  // A harness malfunction (judge crash/timeout, unparseable output, ...) is not
  // a product failure — it is the execution vocabulary's `error`, never `failed`.
  //
  // Two shapes land here: an `error` VERDICT (the judge ran and reported its own
  // malfunction) and a run that died before producing one at all. To a reader
  // they are the same fact — nothing was judged — so both route through the one
  // failure-card vocabulary instead of a bare pill reading "Error", which says
  // nothing about whose error it was.
  const running = !verdict && run.status === 'running';
  const failureClass: FailureClass | null = verdict
    ? classifyOutcome(verdict.outcome)
    : running
      ? null
      : 'harness';
  // The only outcome that IS a ruling on the work.
  const judged = verdict && verdict.outcome !== 'error' ? verdict.outcome : null;
  const banner = judged ? (
    <VerificationPill
      status={judged}
      label={judged === 'passed' ? 'Passed' : 'Failed'}
      verdictHref={reportHref}
    />
  ) : running ? (
    <ExecutionPill state="running" label="Running" />
  ) : (
    <ExecutionPill state="error" label="Harness error" />
  );

  // Screenshots the verdict or a persona finding actually points at.
  const citedShots = new Set(
    [
      ...(verdict?.criterionVerdicts.flatMap((c) => c.evidence) ?? []),
      ...personaReports.flatMap((p) => p.findings.flatMap((f) => f.evidence)),
    ].filter(isImagePath),
  );

  // The bridge captures every step; nothing cites most of those shots. Show the
  // whole set from the artifact listing and flag which ones were cited — falling
  // back to cited-only when the listing is unavailable.
  const allShots = artifacts
    ? artifacts.filter((a) => a.kind === 'screenshot').map((a) => a.path)
    : [...citedShots];
  const shotsByPersona = new Map<string, string[]>();
  for (const shot of allShots) {
    const key = personaOf(shot);
    shotsByPersona.set(key, [...(shotsByPersona.get(key) ?? []), shot]);
  }

  return (
    <div className={cn('space-y-5', !compact && 'max-w-3xl')}>
      {/* Verdict banner — always visible, it's the headline */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {banner}
          {verdict && (
            <span className="text-xs text-muted-foreground">judge: {verdict.judgeModel}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatDateTime(verdict?.createdAt ?? run.startedAt)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Run <code className="text-[11px]">{run.id}</code> · contract v{run.contractVersion}
        </p>
        {failureClass && (
          <FailureCard
            className="mt-3"
            failureClass={failureClass}
            detail={run.error ?? (verdict?.causeKind ? `cause: ${verdict.causeKind}` : null)}
            note={
              verdict
                ? 'The judge reported its own malfunction, so nothing below is a ruling on the work.'
                : 'This run produced no verdict, so there are no criterion results below. Nothing here is a ruling on the work.'
            }
          />
        )}
      </div>

      {/* Per-criterion verdicts */}
      {show('verdict') && verdict && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Criteria ({verdict.criterionVerdicts.length})</h3>
          <div className="space-y-2">
            {verdict.criterionVerdicts.map((c) => {
              const criterion = criteria.get(c.criterionId);
              return (
                <div
                  key={c.criterionId}
                  id={c.criterionId}
                  className="rounded-md border p-3 space-y-1.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* The pill links to this criterion's row in the full verdict —
                        the same pill embedded in the task panel navigates here. */}
                    <CriterionPill
                      status={c.status}
                      verdictHref={`${reportHref}#${encodeURIComponent(c.criterionId)}`}
                      className="text-[10px]"
                    />
                    {criterion && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {criterion.kind}
                      </Badge>
                    )}
                    {criterion?.holdout && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-purple-500/50 text-purple-500"
                      >
                        <EyeOff className="h-3 w-3" />
                        holdout
                      </Badge>
                    )}
                    <span className="text-xs font-mono text-muted-foreground">{c.criterionId}</span>
                  </div>
                  {/* The criterion's own words, not just its id — falls back to the id
                      when the contract for this version isn't on disk. */}
                  {criterion && <p className="text-sm font-medium">{criterion.text}</p>}
                  <p className="text-xs text-foreground/90">{c.reasoning}</p>
                  {c.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {c.evidence.map((ev) => (
                        <a
                          key={ev}
                          href={evidenceUrl(run.id, ev)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary underline underline-offset-2 truncate max-w-[220px]"
                        >
                          {ev.split('/').pop()}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Persona attempts */}
      {show('verdict') && personaReports.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Persona attempts ({personaReports.length})</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-2 py-1.5">Charter</th>
                  <th className="text-left font-medium px-2 py-1.5">Goal</th>
                  <th className="text-left font-medium px-2 py-1.5">Steps</th>
                  <th className="text-left font-medium px-2 py-1.5">Wrong turns</th>
                  <th className="text-left font-medium px-2 py-1.5">Elapsed</th>
                  <th className="text-left font-medium px-2 py-1.5">Valid</th>
                </tr>
              </thead>
              <tbody>
                {personaReports.map((p, i) => (
                  <tr key={`${p.charter}-${p.personaSeed ?? i}`} className="border-t">
                    <td className="px-2 py-1.5">
                      {p.charter}
                      {p.personaSeed && (
                        <Tip content={p.personaSeed}>
                          <span className="text-muted-foreground cursor-help">
                            {' '}
                            #{personaSeedLabel(p.personaSeed)}
                          </span>
                        </Tip>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {p.goalAchieved === null ? (
                        <span className="text-muted-foreground">n/a</span>
                      ) : (
                        // Never a bare green tick: the pill carries the walk's own
                        // evidence — the transcript this claim was read out of.
                        <VerificationPill
                          status={p.goalAchieved ? 'passed' : 'failed'}
                          label={p.goalAchieved ? 'reached' : 'missed'}
                          verdictHref={`${reportHref}?tab=transcripts`}
                          className="text-[10px]"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5">{p.stepCount}</td>
                    <td className="px-2 py-1.5">{p.wrongTurns}</td>
                    <td className="px-2 py-1.5">{elapsed(p.elapsedMs)}</td>
                    <td className="px-2 py-1.5">
                      {p.invalid ? (
                        <Badge variant="destructive" className="text-[10px]">
                          invalid
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Flight-recorder timeline */}
      {show('timeline') && personas.length > 0 && (
        <VerificationTimeline runId={run.id} personas={personas} />
      )}

      {/* Screenshot grid — all captures, grouped by persona */}
      {show('screenshots') && allShots.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">
            Screenshots ({allShots.length})
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {citedShots.size} cited as evidence
            </span>
          </h3>
          {[...shotsByPersona.entries()].map(([persona, shots]) => (
            <div key={persona} className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {persona} ({shots.length})
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {shots.map((shot) => {
                  const cited = citedShots.has(shot);
                  return (
                    <button
                      key={shot}
                      type="button"
                      onClick={() => setLightbox(shot)}
                      className={cn(
                        'rounded-md border overflow-hidden hover:opacity-80 transition-opacity text-left',
                        cited && 'border-primary/60',
                      )}
                    >
                      <img
                        src={evidenceUrl(run.id, shot)}
                        alt={shot.split('/').pop()}
                        loading="lazy"
                        className="w-full h-24 object-cover bg-muted"
                      />
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground px-1.5 py-1">
                        <span className="truncate">{shot.split('/').pop()}</span>
                        {cited && <span className="shrink-0 text-primary">cited</span>}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Human decisions callout */}
      {show('verdict') && verdict && verdict.humanDecisions.length > 0 && (
        <div className="space-y-2">
          {verdict.humanDecisions.map((d, i) => (
            <div key={i} className="rounded-lg border bg-muted/40 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Needs a human decision</span>
              </div>
              <p className="text-xs font-medium">{d.question}</p>
              <p className="text-xs text-muted-foreground">{d.context}</p>
            </div>
          ))}
        </div>
      )}

      {/* Raw transcripts */}
      {show('transcripts') && personaReports.length > 0 && (
        <Collapsible defaultOpen={tab === 'transcripts'}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:text-foreground text-muted-foreground transition-colors">
            <Terminal className="h-4 w-4" />
            <span className="text-sm font-medium">Raw transcripts</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 space-y-1.5">
            {/* Pinnable, not just downloadable: on a headless run the transcript
                IS the evidence, and F6 says the human points at the defect in
                the evidence. A bare link was the whole of that promise. */}
            {personaReports.map((p, i) => (
              <RecordPinner
                key={`${p.charter}-${p.personaSeed ?? i}`}
                projectId={run.projectId ?? null}
                runId={run.id}
                evidencePath={p.transcriptPath}
                taskId={run.taskId}
                label={`${p.charter}${p.personaSeed ? ` #${p.personaSeed}` : ''} — transcript.jsonl`}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Screenshot lightbox */}
      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="text-sm">{lightbox?.split('/').pop()}</DialogTitle>
          {lightbox ? (
            // Click the image to pin a comment on the defect (UX spec F6).
            <EvidencePinner
              projectId={run.projectId ?? null}
              runId={run.id}
              evidencePath={lightbox}
              src={evidenceUrl(run.id, lightbox)}
              alt={lightbox.split('/').pop() ?? lightbox}
              taskId={run.taskId}
            />
          ) : (
            <ImageOff className="h-8 w-8 text-muted-foreground mx-auto" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
