'use client';

import { Badge } from '@/components/ui/badge';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';
import type { CriterionVerdictStatus, RunStatus, Task, VerificationStatus } from '@ligma/api';
import {
  CheckCircle2,
  CircleDashed,
  Clock,
  Eye,
  OctagonAlert,
  ShieldQuestion,
  Timer,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

/**
 * The app's one status vocabulary (UX spec §7). Two families, no synonyms:
 *
 *  - verification — unverified · in-review · passed · failed · waived · stale
 *  - execution    — queued · running · deferred · done · error
 *
 * `error` (the harness malfunctioned) is deliberately not styled like `failed`
 * (the product has a defect): amber octagon vs red cross, principle 12.
 *
 * ponytail: `stale` has no producer in the data model yet (`VerificationStatus`
 * in @ligma/api stops at `waived`); the pill carries it so the surfaces that
 * grow staleness decay in Phase 3 have one place to render it.
 */
export type VerificationPillStatus = VerificationStatus | 'stale';

// Exported for the same reason as EXECUTION below — satellite surfaces borrow,
// never repaint (seam rule 1).
export const VERIFICATION: Record<
  VerificationPillStatus,
  { label: string; className: string; icon: typeof CheckCircle2; tip: string }
> = {
  unverified: {
    label: 'unverified',
    className: 'border-muted-foreground/40 text-muted-foreground',
    icon: ShieldQuestion,
    tip: 'Nothing has been proven about this work yet.',
  },
  'in-review': {
    label: 'in review',
    className: 'border-blue-500/50 text-blue-600',
    icon: Eye,
    tip: 'The persona panel is walking the product right now.',
  },
  passed: {
    label: 'passed',
    className: 'border-green-600/50 text-green-600',
    icon: CheckCircle2,
    tip: 'A signed verdict says this meets its contract.',
  },
  failed: {
    label: 'failed',
    className: 'border-destructive/60 text-destructive',
    icon: XCircle,
    tip: 'The judge found the product does not meet its contract.',
  },
  waived: {
    label: 'waived',
    className: 'border-amber-500/50 text-amber-600',
    icon: ShieldQuestion,
    tip: 'Done, but nothing was verified — this task carried no acceptance criteria.',
  },
  stale: {
    label: 'stale',
    className: 'border-amber-500/50 text-amber-600',
    icon: Clock,
    tip: 'The verdict predates the current work — it no longer proves anything.',
  },
};

/**
 * A green check never renders without a verdict to link to (seam rule §8.8).
 * A `passed` with no `verdictHref` is downgraded to an amber, honest pill rather
 * than being drawn as proof the UI cannot back up.
 */
export function VerificationPill({
  status,
  verdictHref,
  label,
  tip,
  className,
}: {
  status: VerificationPillStatus;
  verdictHref?: string | null;
  /** Overrides the default word when a caller has a more specific one ("Met", "Reached the goal"). */
  label?: string;
  /** Overrides the default tooltip — e.g. a `stale` pill carrying the actual verified-at timestamp. */
  tip?: string;
  className?: string;
}) {
  const unbacked = status === 'passed' && !verdictHref;
  const style = unbacked
    ? {
        label: 'passed (no verdict)',
        className: 'border-amber-500/50 text-amber-600',
        icon: ShieldQuestion,
        tip: 'Marked passed, but no verdict is linked — treat as unproven.',
      }
    : VERIFICATION[status];
  const Icon = style.icon;

  const word = unbacked ? style.label : (label ?? style.label);
  const pill = (
    <Badge variant="outline" className={cn('gap-1 text-xs', style.className, className)}>
      <Icon className="h-3 w-3" />
      {word}
    </Badge>
  );

  const tipped = <Tip content={tip ?? style.tip}>{pill}</Tip>;
  if (!verdictHref || unbacked) return tipped;

  return (
    <Link href={verdictHref} className="inline-flex" aria-label={`${word} — open the verdict`}>
      {tipped}
    </Link>
  );
}

/**
 * A task's verification state in the one vocabulary — `null` when there is
 * nothing to say yet. Lives here so the surfaces that show it (task panel,
 * board card, strip) cannot each invent their own mapping.
 */
export function taskVerificationState(
  task: Pick<Task, 'kanban' | 'verificationStatus'>,
): VerificationPillStatus | null {
  if (task.kanban === 'awaiting-verification') return 'in-review';
  const status = task.verificationStatus ?? 'unverified';
  return status === 'unverified' ? null : status;
}

/**
 * A per-criterion judge result in the same vocabulary: `met` is a `passed`,
 * `not-met` a `failed`, `unknown` an `unverified`. Same downgrade applies — a
 * `met` with no verdict to link is drawn honestly, not as proof.
 */
const CRITERION: Record<CriterionVerdictStatus, { state: VerificationPillStatus; label: string }> =
  {
    met: { state: 'passed', label: 'Met' },
    'not-met': { state: 'failed', label: 'Not met' },
    unknown: { state: 'unverified', label: 'Unknown' },
  };

export function CriterionPill({
  status,
  verdictHref,
  className,
}: {
  status: CriterionVerdictStatus;
  verdictHref?: string | null;
  className?: string;
}) {
  const { state, label } = CRITERION[status];
  return (
    <VerificationPill
      status={state}
      label={label}
      verdictHref={verdictHref}
      className={className}
    />
  );
}

export type ExecutionState = 'queued' | 'running' | 'deferred' | 'done' | 'error';

// Exported so satellite vocabularies (waiting-status.tsx) borrow these colours
// instead of painting their own — seam rule 1: this file is the only paint site.
export const EXECUTION: Record<
  ExecutionState,
  { label: string; className: string; icon: typeof CheckCircle2 | null }
> = {
  queued: {
    label: 'queued',
    className: 'border-muted-foreground/40 text-muted-foreground',
    icon: CircleDashed,
  },
  // Running gets a pulsing dot instead of an icon — the app's one working signal.
  running: { label: 'running', className: 'border-blue-500/50 text-blue-600', icon: null },
  deferred: { label: 'deferred', className: 'border-violet-500/50 text-violet-600', icon: Timer },
  done: { label: 'done', className: 'border-green-600/50 text-green-600', icon: CheckCircle2 },
  error: {
    label: 'error',
    className: 'border-amber-600/60 text-amber-700 dark:text-amber-500',
    icon: OctagonAlert,
  },
};

/** The app's one working signal — the pulsing dot a `running` state renders instead of an icon. */
export function RunningDot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" aria-hidden />;
}

export function ExecutionPill({
  state,
  label,
  tip,
  className,
}: {
  state: ExecutionState;
  /** Overrides the default word when a state needs a more specific one. */
  label?: string;
  tip?: string;
  className?: string;
}) {
  const style = EXECUTION[state];
  const Icon = style.icon;
  const pill = (
    <Badge
      variant="outline"
      className={cn('gap-1.5 text-xs', style.className, tip && 'cursor-help', className)}
    >
      {Icon ? <Icon className="h-3 w-3" /> : <RunningDot />}
      {label ?? style.label}
    </Badge>
  );
  return tip ? <Tip content={tip}>{pill}</Tip> : pill;
}

export type StatusChipState = VerificationPillStatus | ExecutionState;

/**
 * The compact variant of the same vocabulary: colour and text, no badge chrome,
 * for dense rows where a full pill does not fit (the pipeline strip's chips).
 * A variant is not a second vocabulary — the colours still come from the two
 * tables above, so a `deferred` chip is the same violet as a `deferred` pill.
 */
export function StatusChip({
  state,
  label,
  className,
}: {
  state: StatusChipState;
  /** The chip's text — usually a glyph and a count ("▶3"), never a second state name. */
  label: string;
  className?: string;
}) {
  const style =
    state in VERIFICATION
      ? VERIFICATION[state as VerificationPillStatus]
      : EXECUTION[state as ExecutionState];
  return <span className={cn('tabular-nums text-xs', style.className, className)}>{label}</span>;
}

/** The daemon's run statuses in the execution vocabulary. */
export function executionStateFor(status: RunStatus): ExecutionState {
  switch (status) {
    case 'running':
      return 'running';
    case 'deferred':
      return 'deferred';
    case 'completed':
      return 'done';
    // A harness/runner malfunction, not a product defect — never styled as `failed`.
    case 'failed':
    case 'timeout':
      return 'error';
  }
}
