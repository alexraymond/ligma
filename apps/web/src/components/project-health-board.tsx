'use client';

import {
  CriterionPill,
  StatusChip,
  VERIFICATION,
  VerificationPill,
} from '@/components/status-pill';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tip } from '@/components/ui/tip';
import { apiFetch } from '@/lib/api-client';
import { isStale, staleTip } from '@/lib/staleness';
import { useCollection } from '@/providers/collections-provider';
import type { CriterionHealthRow, ProjectHealthResponse } from '@ligma/api';
import { ArrowUpRight, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

/**
 * The health board (UX spec §6 Project Overview): every criterion this project
 * has frozen, with what the judge last said about it.
 *
 * Criteria existed only as a count badge on a task drawer and as judge results
 * buried in a verdict page — never as a board, and never with the decay. This is
 * the criterion-level view; Verify's board is the task-level one, and the two
 * answer different questions ("which promise is unproven?" vs "which ticket is
 * unproven?").
 *
 * Held-out criteria are shown. The holdout is hidden from the *builder*, not
 * from the human — hiding it here would hide most of what the panel actually
 * tests.
 *
 * Summary-first (walkthrough M9 — "the most valuable table in the product,
 * least readable, a spec dump"): the roll-up ("9 met · 1 not met · 6 unknown")
 * is always visible, the per-criterion table is behind a native `<details>`
 * disclosure, and each row's full criterion text is behind its own disclosure
 * when it's long enough to need one. Nothing is deleted — everything the old
 * flat table showed is still reachable, just not shoved in your face at once.
 */

/** `GET /api/projects/:id/health`'s cache key — shared so a mutation elsewhere (promote) can invalidate it by name. */
export function projectHealthKey(projectId: string): string {
  return `/api/projects/${projectId}/health`;
}

export interface HealthSummary {
  met: number;
  notMet: number;
  /** "unknown" and "unverified" are the same claim to a human reading the roll-up: nobody has ruled yet. */
  unknown: number;
  /** Of the `met` rows, how many are stale — a verdict too old to still prove today's code. */
  stale: number;
  holdout: number;
  total: number;
}

/** Pure so it's testable without a fetch or a clock mock (`now` is injectable, same convention as `waiting-status.ts`). */
export function summarizeHealth(
  rows: CriterionHealthRow[],
  now: number = Date.now(),
): HealthSummary {
  const summary: HealthSummary = {
    met: 0,
    notMet: 0,
    unknown: 0,
    stale: 0,
    holdout: 0,
    total: rows.length,
  };
  for (const row of rows) {
    if (row.status === 'met') {
      summary.met += 1;
      if (isStale(row.verifiedAt, now)) summary.stale += 1;
    } else if (row.status === 'not-met') {
      summary.notMet += 1;
    } else {
      summary.unknown += 1;
    }
    if (row.holdout) summary.holdout += 1;
  }
  return summary;
}

/** Short enough to fit one line comfortably; longer text gets a per-row expand. */
const SHORT_LABEL_MAX = 88;

export function isLongCriterion(text: string, max = SHORT_LABEL_MAX): boolean {
  return text.length > max;
}

export function shortLabel(text: string, max = SHORT_LABEL_MAX): string {
  if (!isLongCriterion(text, max)) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function ProjectHealthBoard({ projectId }: { projectId: string }) {
  const key = projectHealthKey(projectId);
  const fetcher = useCallback(async (): Promise<CriterionHealthRow[]> => {
    const res = await apiFetch(key);
    if (!res.ok) throw new Error(`Failed to load project health (${res.status})`);
    const body = (await res.json()) as ProjectHealthResponse;
    return body.criteria;
  }, [key]);

  // A board that cannot load is left absent rather than shown empty — "no
  // criteria" and "could not read them" are different claims, so `rows` stays
  // null (never an empty array) until a read actually succeeds.
  const { data: rows } = useCollection<CriterionHealthRow[]>(key, fetcher);

  if (rows === null) return null;

  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          No criteria frozen yet. Promote a brief or an approved design and its contract lands here.
        </CardContent>
      </Card>
    );
  }

  const summary = summarizeHealth(rows);

  return (
    <div className="rounded-lg border">
      <HealthSummaryRow summary={summary} />
      <details className="group border-t">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
          {rows.length} criteri{rows.length === 1 ? 'on' : 'a'} — show detail
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-t bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Criterion</th>
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.scope}:${row.criterionId}`}
                  className="border-b last:border-0 align-top"
                >
                  <td className="px-3 py-2">
                    <CriterionCell row={row} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.title}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <RowPill row={row} />
                      {row.runId && (
                        <Link
                          href={`/verification/${row.runId}`}
                          className="inline-flex items-center gap-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          evidence <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** The always-visible roll-up: overall health at a glance, no expand required. */
function HealthSummaryRow({ summary }: { summary: HealthSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-xs">
      {/* Colours come from the one vocabulary (seam rule 1): met wears `passed`,
          not-met wears `failed`, unknown wears `unverified`. */}
      <StatusChip
        state="passed"
        label={`${summary.met} met${summary.stale > 0 ? ` (${summary.stale} stale)` : ''}`}
      />
      <StatusChip state="failed" label={`${summary.notMet} not met`} />
      <StatusChip state="unverified" label={`${summary.unknown} unknown`} />
      {summary.holdout > 0 ? (
        <Tip content="Held out from the builder — the panel still tests it (principle 4).">
          <Badge variant="outline" className={`gap-1 text-[10px] ${VERIFICATION.waived.className}`}>
            <EyeOff className="h-2.5 w-2.5" /> {summary.holdout} held out
          </Badge>
        </Tip>
      ) : null}
    </div>
  );
}

/** Short label by default; the full text is one click away for anything long enough to need it (M9). */
function CriterionCell({ row }: { row: CriterionHealthRow }) {
  const holdoutBadge = row.holdout && (
    <Tip content="Held out from the builder — the panel still tests it (principle 4).">
      <Badge
        variant="outline"
        className={`shrink-0 gap-1 text-[10px] ${VERIFICATION.waived.className}`}
      >
        <EyeOff className="h-2.5 w-2.5" /> held out
      </Badge>
    </Tip>
  );

  if (!isLongCriterion(row.text)) {
    return (
      <div className="flex items-start gap-2">
        <span className="max-w-prose">{row.text}</span>
        {holdoutBadge}
      </div>
    );
  }

  return (
    <details className="group/row">
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span className="max-w-prose group-open/row:hidden">{shortLabel(row.text)}</span>
        <span className="hidden max-w-prose group-open/row:inline">{row.text}</span>
        {holdoutBadge}
      </summary>
    </details>
  );
}

/**
 * The same downgrade rule every other pill site obeys: a `met` old enough to
 * predate recent work reads `stale`, and nothing green renders without its run.
 */
function RowPill({ row }: { row: CriterionHealthRow }) {
  if (row.status === 'unverified') {
    return (
      <VerificationPill status="unverified" tip="No verdict has ruled on this criterion yet." />
    );
  }
  if (row.status === 'met' && isStale(row.verifiedAt)) {
    return (
      <VerificationPill
        status="stale"
        label="Met"
        verdictHref={row.runId ? `/verification/${row.runId}` : null}
        tip={row.verifiedAt ? staleTip(row.verifiedAt) : undefined}
      />
    );
  }
  return (
    <CriterionPill
      status={row.status}
      verdictHref={row.runId ? `/verification/${row.runId}` : null}
    />
  );
}
