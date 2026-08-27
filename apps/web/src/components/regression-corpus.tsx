'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { startJourneyRun } from '@/lib/journeys';
import { showError, showSuccess } from '@/lib/toast';
import type { Journey, RegressionProbe, RegressionProbeListResponse } from '@ligma/api';
import { ArrowUpRight, Play } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

/**
 * The regression corpus (UX spec §6 Verify) — every failure this product has
 * been caught in, with the verdict that caught it.
 *
 * **Replay is "Prove it", deliberately.** A probe names a journey and a
 * criterion; running that journey re-asks exactly the question that failed, and
 * the baseline comparison the harness already does says whether the answer
 * changed. Building a second execution path for probes would mean a second thing
 * to keep honest, judging the same product by different machinery.
 *
 * A probe from a *task* verdict has no journey to re-run, so it says so instead
 * of offering a button that would do nothing.
 */
export function RegressionCorpus({
  projectId,
  journeys,
  onReplayed,
}: {
  projectId: string;
  journeys: Journey[];
  onReplayed?: () => void;
}) {
  const [probes, setProbes] = useState<RegressionProbe[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/probes`);
      if (!res.ok) return;
      const body = (await res.json()) as RegressionProbeListResponse;
      setProbes(body.probes);
    } catch {
      // Absent rather than empty: "no probes" and "could not read them" are
      // different claims and must not look the same.
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function replay(probe: RegressionProbe) {
    if (!probe.journeyId) return;
    setBusy(probe.id);
    try {
      await startJourneyRun(projectId, probe.journeyId);
      showSuccess('Re-asking it — the journey run is in Runs, judged against the same baseline');
      onReplayed?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (probes === null) return null;

  if (probes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          Nothing has failed here yet. Every criterion a verdict rules against is recorded, so it
          can be re-asked later.
        </CardContent>
      </Card>
    );
  }

  const titleOf = (journeyId: string | null) =>
    journeys.find((j) => j.id === journeyId)?.title ?? journeyId;

  return (
    <div className="space-y-2">
      {probes.map((probe) => (
        <div key={probe.id} className="rounded-lg border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{probe.criterionText}</p>
              <p className="text-xs text-muted-foreground">{probe.reasoning}</p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {probe.journeyId && (
                  <Badge variant="outline" className="text-[10px]">
                    {titleOf(probe.journeyId)}
                  </Badge>
                )}
                {probe.recordPath && <code className="truncate">{probe.recordPath}</code>}
                <Link
                  href={`/verification/${probe.runId}`}
                  className="inline-flex items-center gap-0.5 underline underline-offset-2"
                >
                  the verdict that caught it <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            {probe.journeyId ? (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                disabled={busy !== null}
                onClick={() => void replay(probe)}
              >
                <Play className="h-3 w-3" /> Prove it
              </Button>
            ) : (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                task verdict — re-run the task to re-ask it
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
