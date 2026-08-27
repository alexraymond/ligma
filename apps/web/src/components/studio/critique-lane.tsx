'use client';

/**
 * The critique lane — visible by default, under the artifact.
 *
 * open-design's critique theater was "their most interesting feature, off by
 * default behind a settings toggle with no in-Studio discovery" (UX spec §2).
 * Seamlessness principle 2 answers that directly: "nothing load-bearing hides
 * in Settings. Critique lanes and verification run visibly by default; settings
 * tune, they don't reveal." So this lane renders whenever a design is open —
 * collapsed to a one-line summary, never absent, and with no toggle that can
 * hide it.
 *
 * `error` is not a low score. `CritiqueReport.score` is null unless the status
 * is `scored`, and an errored pass says so in words (build brief §4 principle
 * 12) — a critic that crashed produced no judgement, and rendering 0 would be
 * the exact defect that rule forbids.
 */

import { FailureCard, type FailureClass, classifyCritiqueStatus } from '@/components/failure';
import { Button } from '@/components/ui/button';
import type {
  CritiqueLaneReport,
  CritiqueLaneStatus,
  CritiqueReport,
  CritiqueRuleScore,
  DesignCriticEvent,
} from '@ligma/api';
import { ChevronDown, ChevronRight, History, OctagonX, Radio } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { CritiqueLiveState } from './critique-events';
import type { ReplaySpeedMultiplier } from './critique-replay';
import { fetchLatestCritiqueTranscript } from './critique-transcript-client';
import { type ReplayStatus, useCritiqueReplay } from './use-critique-replay';

export interface CritiqueLaneProps {
  critique: CritiqueReport | null;
  /** Rule the critic is scoring right now, from the SSE ticker. */
  currentRule: string | null;
  /**
   * Panelist that rule belongs to. Optional: lane ids are already the prefix
   * of their own rule slugs (`accessibility:contrast`), so a host that has not
   * wired this yet still reads correctly — it just doesn't repeat the name.
   */
  currentLane?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInterrupt: () => void;
  /**
   * Enables the Replay control (OD-057). Both are required together — omit
   * either (e.g. in a host that has not wired them yet, or in tests) and the
   * lane behaves exactly as it did before Replay existed.
   */
  projectId?: string;
  designId?: string;
  /** Test/DI seam; defaults to the daemon reader once its route is wired. */
  fetchTranscript?: (projectId: string, designId: string) => Promise<DesignCriticEvent[]>;
}

const REPLAY_SPEEDS: ReplaySpeedMultiplier[] = [1, 2, 4];

function scoreTone(score: number | null, threshold: number): string {
  if (score === null) return 'text-muted-foreground';
  return score >= threshold ? 'text-green-600' : 'text-amber-600';
}

/** One panelist's chip in the lane header, plus the findings behind it. */
export interface CritiqueLaneChip {
  lane: string;
  status: CritiqueLaneStatus;
  /** What the chip shows where a score would go — never a fabricated number. */
  label: string;
  /** Null for every status but `scored`. */
  score: number | null;
  rules: CritiqueRuleScore[];
  /** The denial or malfunction in the lane's own words. */
  note: string | null;
}

/**
 * A skipped lane says why it was skipped from `skipReason`, never by reading
 * its prose: a lane the governor denied is not a lane that had nothing to
 * score, and neither of them is a zero.
 */
function laneLabel(lane: CritiqueLaneReport): string {
  switch (lane.status) {
    case 'scored':
      return String(lane.score);
    case 'skipped':
      return lane.skipReason === 'not-applicable' ? 'skipped — n/a' : 'skipped — quota';
    case 'interrupted':
      return 'interrupted';
    default:
      return 'error';
  }
}

/** The panel row. Empty for a single-critic report written before lanes existed. */
export function critiqueLaneChips(critique: CritiqueReport | null): CritiqueLaneChip[] {
  return (critique?.lanes ?? []).map((lane) => ({
    lane: lane.lane,
    status: lane.status,
    label: laneLabel(lane),
    score: lane.status === 'scored' ? lane.score : null,
    rules: lane.rules,
    note: lane.error,
  }));
}

/** "mean of 2 scored lanes (1 skipped)" — the arithmetic, stated rather than implied. */
function combinedNoteFor(chips: CritiqueLaneChip[]): string | null {
  if (chips.length === 0) return null;
  const scored = chips.filter((chip) => chip.status === 'scored').length;
  if (scored === 0) return `no lane scored — ${chips.length} of ${chips.length} said nothing`;
  const missing = chips.length - scored;
  const head = `mean of ${scored} scored lane${scored === 1 ? '' : 's'}`;
  return missing > 0 ? `${head} (${missing} skipped)` : head;
}

export interface CritiqueDisplayInput {
  critique: CritiqueReport | null;
  currentRule: string | null;
  /** Panelist the current rule belongs to. Omitted by pre-panel callers. */
  currentLane?: string | null;
  replaying: boolean;
  replayLive: CritiqueLiveState;
  replayStatus: ReplayStatus;
  replayError: string | null;
}

export interface CritiqueDisplay {
  /** Whichever of live/replay is active — every render branch reads only this. */
  critique: CritiqueReport | null;
  currentRule: string | null;
  currentLane: string | null;
  /** One chip per panelist. Empty for a pre-panel (single-critic) report. */
  lanes: CritiqueLaneChip[];
  /** How the overall score was arrived at, or null when there is no panel. */
  combinedNote: string | null;
  /** The text the status chip shows. */
  statusLabel: string;
  threshold: number;
  /** True only for a live run in flight — the Interrupt button's gate. */
  interruptible: boolean;
  /** True while either a live run or a replay is stepping through "running". */
  scoringNow: boolean;
  failureClass: FailureClass | null;
  replayUnavailable: boolean;
}

/**
 * Picks which state the lane renders and derives everything the JSX needs
 * from it — pure, so this is what "replay reuses the lane's live rendering"
 * actually means, testably: feed it a `CritiqueLiveState` built by replaying
 * events through `reduceCriticEvent` and it produces the identical shape a
 * live run would have at the same point.
 */
export function resolveCritiqueDisplay(input: CritiqueDisplayInput): CritiqueDisplay {
  const critique = input.replaying ? input.replayLive.critique : input.critique;
  const currentRule = input.replaying ? input.replayLive.currentRule : input.currentRule;
  const currentLane = input.replaying ? input.replayLive.currentLane : (input.currentLane ?? null);
  const rawStatus = critique?.status ?? 'idle';
  const replayUnavailable = input.replaying && input.replayStatus === 'error';
  const lanes = critiqueLaneChips(critique);

  const statusLabel =
    input.replaying && input.replayStatus === 'loading'
      ? 'loading replay…'
      : rawStatus === 'idle'
        ? 'not run yet'
        : rawStatus;

  return {
    critique,
    currentRule,
    currentLane,
    lanes,
    combinedNote: combinedNoteFor(lanes),
    statusLabel,
    threshold: critique?.threshold ?? 0,
    interruptible: !input.replaying && rawStatus === 'running',
    scoringNow: rawStatus === 'running',
    failureClass: classifyCritiqueStatus(rawStatus),
    replayUnavailable,
  };
}

function RuleList({ rules, threshold }: { rules: CritiqueRuleScore[]; threshold: number }) {
  if (rules.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1.5">
      {rules.map((rule, index) => (
        <li key={`${rule.rule}-${index}`} className="flex items-start gap-3 text-xs">
          <span
            className={`w-10 shrink-0 font-mono tabular-nums ${scoreTone(rule.score, threshold)}`}
          >
            {rule.score}
          </span>
          <span className="w-44 shrink-0 font-medium">{rule.rule}</span>
          <span className="text-muted-foreground">{rule.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function CritiqueLane({
  critique,
  currentRule,
  currentLane,
  open,
  onOpenChange,
  onInterrupt,
  projectId,
  designId,
  fetchTranscript = fetchLatestCritiqueTranscript,
}: CritiqueLaneProps) {
  const liveStatus = critique?.status ?? 'idle';
  const liveRunning = liveStatus === 'running';
  // Replaying a run that has not finished, or one with no run yet, is not a
  // thing — the transcript for the current run either doesn't exist yet or
  // is still being written.
  const canReplay =
    projectId !== undefined && designId !== undefined && !liveRunning && liveStatus !== 'idle';

  const [replaying, setReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeedMultiplier>(1);

  const fetchForReplay = useCallback(
    () => fetchTranscript(projectId as string, designId as string),
    [fetchTranscript, projectId, designId],
  );
  const replay = useCritiqueReplay(replaying, fetchForReplay, replaySpeed);

  // Replay and live speak the exact same `CritiqueReport` + "current rule"
  // shape (`critique-events.ts`'s `reduceCriticEvent`); `resolveCritiqueDisplay`
  // picks whichever is active and every render branch below reads only its
  // output — one renderer, no second vocabulary for a replayed run.
  const {
    critique: displayCritique,
    currentRule: displayCurrentRule,
    currentLane: displayCurrentLane,
    lanes,
    combinedNote,
    statusLabel,
    threshold,
    interruptible,
    scoringNow,
    failureClass,
    replayUnavailable,
  } = resolveCritiqueDisplay({
    critique,
    currentRule,
    currentLane,
    replaying,
    replayLive: replay.live,
    replayStatus: replay.status,
    replayError: replay.error,
  });

  const ticker = displayCurrentRule
    ? displayCurrentLane
      ? `${displayCurrentLane} · ${displayCurrentRule}`
      : displayCurrentRule
    : 'scoring…';

  return (
    <section aria-label="Critique" className="border-t bg-background">
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden />
          )}
          Critique
        </button>

        <span className="text-xs text-muted-foreground">{statusLabel}</span>

        {replaying ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            replay
          </span>
        ) : null}

        {replayUnavailable ? (
          <span className="text-xs text-destructive">
            {replay.error ?? 'replay failed to load'}
          </span>
        ) : failureClass ? (
          <FailureCard
            failureClass={failureClass}
            detail="no score was produced"
            variant="inline"
          />
        ) : (
          <span
            className={`font-mono text-sm tabular-nums ${scoreTone(displayCritique?.score ?? null, threshold)}`}
          >
            {displayCritique?.score ?? '—'}
            <span className="text-xs text-muted-foreground"> / {threshold}</span>
          </span>
        )}

        {scoringNow ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"
            />
            {ticker}
          </span>
        ) : null}

        {/* The panel row: one chip per panelist, so a skipped lane is visibly
            absent from the mean rather than silently folded into it. */}
        {lanes.length > 0 ? (
          <ul aria-label="Critique lanes" className="flex items-center gap-1.5">
            {lanes.map((chip) => (
              <li
                key={chip.lane}
                title={chip.note ?? undefined}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  chip.status === 'scored'
                    ? scoreTone(chip.score, threshold)
                    : 'text-muted-foreground'
                }`}
              >
                <span className="font-medium">{chip.lane}</span>{' '}
                <span className="font-mono tabular-nums">{chip.label}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {replaying ? (
            <>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                speed
                <select
                  className="rounded border bg-background px-1 py-0.5 text-xs"
                  value={replaySpeed}
                  onChange={(e) => setReplaySpeed(Number(e.target.value) as ReplaySpeedMultiplier)}
                >
                  {REPLAY_SPEEDS.map((speedOption) => (
                    <option key={speedOption} value={speedOption}>
                      {speedOption}x
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="outline" size="sm" onClick={() => setReplaying(false)}>
                <Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Live
              </Button>
            </>
          ) : (
            <>
              {interruptible ? (
                <Button variant="outline" size="sm" onClick={onInterrupt}>
                  <OctagonX className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Interrupt
                </Button>
              ) : null}
              {canReplay ? (
                <Button variant="outline" size="sm" onClick={() => setReplaying(true)}>
                  <History className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Replay
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {open ? (
        <div className="border-t px-4 py-3">
          {replayUnavailable ? (
            <p className="text-xs text-destructive">
              {replay.error ?? 'The transcript for this run could not be loaded.'}
            </p>
          ) : lanes.length > 0 ? (
            <div className="space-y-3">
              {lanes.map((chip) => (
                <div key={chip.lane}>
                  <p className="flex items-baseline gap-2 text-xs font-medium">
                    {chip.lane}
                    <span
                      className={`font-mono tabular-nums ${chip.status === 'scored' ? scoreTone(chip.score, threshold) : 'text-muted-foreground'}`}
                    >
                      {chip.label}
                    </span>
                  </p>
                  {/* A lane that never ran says why, in its own words. It is not
                      a finding, and it is certainly not a zero. */}
                  {chip.note ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{chip.note}</p>
                  ) : null}
                  <RuleList rules={chip.rules} threshold={threshold} />
                </div>
              ))}
            </div>
          ) : displayCritique === null || displayCritique.rules.length === 0 ? (
            failureClass ? (
              <FailureCard
                failureClass={failureClass}
                detail={displayCritique?.error}
                note="Not a verdict on the design."
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                No rule scores yet. The critic runs after a generation turn lands.
              </p>
            )
          ) : (
            <RuleList rules={displayCritique.rules} threshold={threshold} />
          )}
          {combinedNote ? (
            <p className="mt-2 text-[11px] text-muted-foreground">overall: {combinedNote}</p>
          ) : null}
          {displayCritique?.designSystem ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              scored against design system: {displayCritique.designSystem}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
