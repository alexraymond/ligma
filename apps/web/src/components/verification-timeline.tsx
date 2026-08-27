'use client';

import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { BridgeStep } from '@ligma/api';
import { AlertTriangle, Camera, MoonStar } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Flight recorder for a verification run: every persona's steps.jsonl merged
 * into one time-ordered stream.
 *
 * Absences are first-class rows. A persona that records nothing for a minute is
 * evidence — a stall, a lost agent, a hung page — and a timeline that only draws
 * the steps that happened hides exactly that. Any hole >= GAP_THRESHOLD_MS
 * between two consecutive steps of the same persona becomes a "went dark" row.
 */

export const GAP_THRESHOLD_MS = 60_000;

/** Lane colours, assigned by persona order. Border + text so both themes work. */
const LANE_COLORS = [
  'border-l-sky-500 text-sky-600 dark:text-sky-400',
  'border-l-violet-500 text-violet-600 dark:text-violet-400',
  'border-l-emerald-500 text-emerald-600 dark:text-emerald-400',
  'border-l-orange-500 text-orange-600 dark:text-orange-400',
  'border-l-pink-500 text-pink-600 dark:text-pink-400',
];

export interface TimelinePersona {
  /** Display label, e.g. "naive-user #1". */
  label: string;
  /** Run-relative directory, e.g. "personas/naive-user-1". */
  dir: string;
}

export type TimelineRow =
  | { type: 'step'; persona: string; lane: number; at: number; step: BridgeStep }
  | { type: 'gap'; persona: string; lane: number; at: number; ms: number; afterIndex: number };

function evidenceUrl(runId: string, relPath: string): string {
  return `/api/verification-runs/${encodeURIComponent(runId)}/file?path=${encodeURIComponent(relPath)}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

/** Playwright error logs arrive with ANSI dim codes and dozens of retry lines. */
function firstErrorLine(error: string): string {
  return (
    error
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the actual ANSI CSI byte being stripped.
      .replace(/\x1b\[\d+m/g, '')
      .split('\n')[0]
      .trim()
  );
}

export function parseSteps(jsonl: string): BridgeStep[] {
  const steps: BridgeStep[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      steps.push(JSON.parse(line) as BridgeStep);
    } catch {
      // A malformed step line loses one row, not the whole timeline.
    }
  }
  return steps;
}

/** Steps of one persona -> its rows, with the silences between them made explicit. */
export function rowsForPersona(persona: string, lane: number, steps: BridgeStep[]): TimelineRow[] {
  const ordered = [...steps].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  const rows: TimelineRow[] = [];

  ordered.forEach((step, i) => {
    const at = new Date(step.startedAt).getTime();
    const prev = ordered[i - 1];
    if (prev) {
      const prevEnd = new Date(prev.startedAt).getTime() + prev.durationMs;
      const gap = at - prevEnd;
      if (gap >= GAP_THRESHOLD_MS) {
        rows.push({ type: 'gap', persona, lane, at: prevEnd, ms: gap, afterIndex: prev.index });
      }
    }
    rows.push({ type: 'step', persona, lane, at, step });
  });

  return rows;
}

interface VerificationTimelineProps {
  runId: string;
  personas: TimelinePersona[];
}

export function VerificationTimeline({ runId, personas }: VerificationTimelineProps) {
  const [rows, setRows] = useState<TimelineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);

    Promise.all(
      personas.map(async (p, lane) => {
        const res = await apiFetch(evidenceUrl(runId, `${p.dir}/steps.jsonl`));
        // No steps.jsonl (e.g. a persona that never drove a browser) is not an error.
        if (!res.ok) return [] as TimelineRow[];
        return rowsForPersona(p.label, lane, parseSteps(await res.text()));
      }),
    )
      .then((perPersona) => {
        if (cancelled) return;
        setRows(perPersona.flat().sort((a, b) => a.at - b.at));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load steps');
      });

    return () => {
      cancelled = true;
    };
  }, [runId, personas]);

  if (error) return <ErrorState message={error} compact />;
  if (!rows) return <p className="text-sm text-muted-foreground py-4">Loading timeline...</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No recorded browser steps for this run.</p>
    );
  }

  const errorCount = rows.filter((r) => r.type === 'step' && r.step.error).length;
  const gaps = rows.filter((r): r is Extract<TimelineRow, { type: 'gap' }> => r.type === 'gap');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Timeline ({rows.length} rows)</h3>
        {errorCount > 0 && (
          <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-500 gap-1">
            <AlertTriangle className="h-3 w-3" />
            {errorCount} step {errorCount === 1 ? 'error' : 'errors'}
          </Badge>
        )}
        {gaps.length > 0 && (
          <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500 gap-1">
            <MoonStar className="h-3 w-3" />
            {gaps.length} dark {gaps.length === 1 ? 'period' : 'periods'}
          </Badge>
        )}
      </div>

      {/* Lane legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {personas.map((p, lane) => (
          <span
            key={p.dir}
            className={cn(
              'text-[11px] font-medium border-l-2 pl-1.5',
              LANE_COLORS[lane % LANE_COLORS.length],
            )}
          >
            {p.label}
          </span>
        ))}
      </div>

      <ol className="space-y-1">
        {rows.map((row) => {
          const lane = LANE_COLORS[row.lane % LANE_COLORS.length];

          if (row.type === 'gap') {
            return (
              <li
                key={`gap-${row.persona}-${row.afterIndex}`}
                className={cn(
                  'flex items-center gap-2 rounded-md border border-dashed border-amber-500/50 bg-amber-500/10 border-l-2 px-2 py-1.5',
                  lane,
                )}
              >
                <MoonStar className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {clockTime(row.at)}
                </span>
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  <span className="font-medium">{row.persona}</span> went dark for{' '}
                  {formatDuration(row.ms)}
                  <span className="text-muted-foreground"> (after step {row.afterIndex})</span>
                </span>
              </li>
            );
          }

          const { step } = row;
          const shot = step.screenshot;
          return (
            <li key={`step-${row.persona}-${step.index}`}>
              <button
                type="button"
                disabled={!shot}
                onClick={() => shot && setLightbox(shot)}
                className={cn(
                  'w-full flex items-start gap-2 rounded-md border border-l-2 px-2 py-1.5 text-left',
                  lane,
                  step.error ? 'border-red-500/40 bg-red-500/5' : 'bg-card',
                  shot ? 'hover:bg-accent/50 cursor-pointer' : 'cursor-default',
                )}
              >
                <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-16">
                  {clockTime(row.at)}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-8 text-right">
                  #{step.index}
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium">{step.action}</span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {step.detail}
                    </span>
                    {shot && <Camera className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </span>
                  {step.error && (
                    <span
                      className="flex items-start gap-1 text-[11px] text-red-500"
                      title={step.error}
                    >
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="truncate">{firstErrorLine(step.error)}</span>
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {step.durationMs >= 1000
                    ? `${(step.durationMs / 1000).toFixed(1)}s`
                    : `${step.durationMs}ms`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="text-sm">{lightbox?.split('/').pop()}</DialogTitle>
          {lightbox && (
            <img
              src={evidenceUrl(runId, lightbox)}
              alt={lightbox}
              className="w-full h-auto rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
