'use client';

/**
 * The one failure-card family (UX spec F5, §7 "one error model"): every agent
 * failure site renders through this component, picking a `FailureClass` from
 * `classify.ts` — never a bare error string, never its own bespoke card.
 *
 * Each class gets its one right action, passed in by the call site (only the
 * site knows how to retry, re-authenticate or switch backend):
 *
 *  - `auth`     — "Re-authenticate"
 *  - `deferred` — no action; calm, "Deferred, resumes ~HH:MM" — normal operation
 *  - `parse`    — "Retry"
 *  - `backend`  — "Switch backend"
 *  - `boot`     — "Fix boot recipe" (links Knowledge)
 *  - `harness`  — amber, "harness malfunction — not a verdict on the work"
 *  - `parked`   — amber, "Parked — waiting on you": the daemon is declining to
 *                 start the task until a human answers something. Nothing broke;
 *                 the action is whatever unblocks it.
 *  - `unknown`  — the site had no structured class to give this — generic card,
 *                 not a synonym for any of the above (see the P4-B report for
 *                 which sites still land here and why).
 *
 * Two variants: `card` (bordered box, the default) for a page-level failure,
 * `inline` (single dense line) for list rows and tight sidebars.
 */

import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  KeyRound,
  PauseCircle,
  RotateCcw,
  ServerCog,
  Timer,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FailureClass } from './classify';

export type { FailureClass } from './classify';

export interface FailureAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

type Tone = 'destructive' | 'amber' | 'calm';

const COPY: Record<FailureClass, { title: string; tone: Tone; icon: typeof AlertTriangle }> = {
  auth: { title: 'Re-authentication needed', tone: 'destructive', icon: KeyRound },
  backend: { title: 'Backend unavailable', tone: 'destructive', icon: ServerCog },
  parse: { title: "Couldn't read the result", tone: 'destructive', icon: RotateCcw },
  boot: { title: 'Environment needs a fix', tone: 'amber', icon: Wrench },
  harness: { title: 'Harness malfunction — not a verdict', tone: 'amber', icon: AlertTriangle },
  deferred: { title: 'Deferred', tone: 'calm', icon: Timer },
  parked: { title: 'Parked — waiting on you', tone: 'amber', icon: PauseCircle },
  unknown: { title: 'Something went wrong', tone: 'destructive', icon: AlertTriangle },
};

const TONE_CARD: Record<Tone, string> = {
  destructive: 'border-destructive/50 bg-destructive/10 text-destructive',
  amber: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-500',
  calm: 'border-violet-500/40 bg-violet-500/5 text-violet-700 dark:text-violet-400',
};

const TONE_INLINE: Record<Tone, string> = {
  destructive: 'text-destructive',
  amber: 'text-amber-700 dark:text-amber-500',
  calm: 'text-violet-600 dark:text-violet-400',
};

/** "Deferred, resumes ~HH:MM" — calm phrasing per UX spec F5, never alarming. */
export function resumeLabel(resumeAt: string | null | undefined): string {
  if (!resumeAt) return 'Deferred — resumes when a quota window opens';
  const d = new Date(resumeAt);
  if (Number.isNaN(d.getTime())) return 'Deferred — resumes when a quota window opens';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `Deferred, resumes ~${hh}:${mm}`;
}

export interface FailureCardProps {
  failureClass: FailureClass;
  /** Raw daemon message, shown as supplementary detail — never the headline. */
  detail?: string | null;
  /** For `deferred`: the governor's resume estimate, when the site has one. */
  resumeAt?: string | null;
  /**
   * The one right action for this class. Omit when the site has none to offer.
   *
   * An array is for the sites where recovery genuinely takes two moves and
   * offering only one is the dead end — a failed adoption is "correct the
   * recipe" OR "retry it unchanged", and the human is the only one who knows
   * which. Still not a licence for a button bar: two, at most.
   */
  action?: FailureAction | FailureAction[];
  /** Site-specific context under the generic copy (e.g. "adopting again is safe"). */
  note?: ReactNode;
  /** `card` (bordered box, default) or `inline` (dense single line). */
  variant?: 'card' | 'inline';
  className?: string;
}

export function FailureCard({
  failureClass,
  detail,
  resumeAt,
  action,
  note,
  variant = 'card',
  className,
}: FailureCardProps) {
  const copy = COPY[failureClass];
  const Icon = copy.icon;
  const title = failureClass === 'deferred' ? resumeLabel(resumeAt) : copy.title;
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 text-xs',
          TONE_INLINE[copy.tone],
          className,
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="font-medium">{title}</span>
        {failureClass !== 'deferred' && detail ? (
          <span className="truncate text-muted-foreground">— {detail}</span>
        ) : null}
        {actions.map((a) => (
          <FailureActionButton key={a.label} action={a} inline />
        ))}
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-failure-class={failureClass}
      className={cn(
        'space-y-1.5 rounded-md border px-3 py-2 text-sm',
        TONE_CARD[copy.tone],
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {title}
      </p>
      {failureClass !== 'deferred' && detail ? (
        <p className="text-muted-foreground">{detail}</p>
      ) : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {actions.map((a) => (
            <FailureActionButton key={a.label} action={a} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FailureActionButton({
  action,
  inline = false,
}: { action: FailureAction; inline?: boolean }) {
  const cls = inline
    ? 'font-medium underline underline-offset-2'
    : 'inline-flex items-center rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-current/10';
  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  );
}
