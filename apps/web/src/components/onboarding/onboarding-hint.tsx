'use client';

/**
 * A milestone-scoped one-shot hint (UX spec §11): a small dismissible callout,
 * never a modal. It shows exactly once per milestone id (persisted in
 * localStorage, see `hints.ts`), and never again once dismissed — including
 * never for a returning user who reaches the same milestone in a later
 * session, because "seen" is checked before render, not reset per-mount.
 *
 * This replaces `OnboardingDialog`, the old first-visit modal: a dialog that
 * blocks the rail behind a scrim is the opposite of "the rail never
 * disappears" (UX spec §4). `id="first-visit"` is its direct successor.
 */

import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useOnboardingHint } from './use-onboarding-hint';

export interface OnboardingHintProps {
  /** Milestone identifier — also the (namespaced) localStorage key, see `hints.ts`. */
  id: string;
  /** Whether this milestone has actually been reached. Default: reached on mount. */
  active?: boolean;
  title: string;
  body: string;
  className?: string;
}

export function OnboardingHint({ id, active = true, title, body, className }: OnboardingHintProps) {
  const { visible, dismiss } = useOnboardingHint(id, active);
  if (!visible) return null;

  return (
    <div
      data-testid={`onboarding-hint-${id}`}
      aria-label="Onboarding hint"
      className={cn(
        'flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs',
        className,
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-muted-foreground">{body}</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss hint"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
