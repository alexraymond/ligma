import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertTriangle, RotateCcw } from 'lucide-react';
/**
 * The app's one error presentation for a plain fetch/read failure (mechanics
 * F18, walkthrough m2 — "three different error designs"). This does not
 * replace `FailureCard` (`components/failure/`), which stays the right idiom
 * for a *classified* daemon/agent failure (auth, boot, harness, ...) with a
 * class-specific recovery action; this component is for the ~30 call sites
 * that only ever had a hook's raw error string and a retry callback.
 *
 * Honest wording is the point (walkthrough m2's "missing record rendered as a
 * crash"): a caller should say what failed — `title="Couldn't load runs"` —
 * never the generic "Something went wrong" for a plain absence. `title` is
 * the headline, `detail` is supplementary (the raw message), never the other
 * way around.
 *
 * `message`/`compact` are the original props, kept working as-is so the ~30
 * existing call sites (page.tsx, board/page.tsx, deck/page.tsx, ...) don't
 * need to change in this wave — wiring honest per-surface titles into them is
 * Wave 2's job (CONTRACTS-uifix.md U6). New call sites should prefer
 * `title`/`detail`/`variant`.
 */
import * as React from 'react';

export type ErrorStateVariant = 'compact' | 'full';

export interface ErrorStateProps {
  /** The honest headline — what failed. Defaults to "Something went wrong" only when nothing more specific is given. */
  title?: string;
  /** Supplementary detail under the title (the raw error message) — never the headline itself. */
  detail?: string | null;
  onRetry?: () => void;
  className?: string;
  /** `compact` (dense, inline within a panel) or `full` (page-level). Overrides the legacy `compact` boolean when given. */
  variant?: ErrorStateVariant;
  /** @deprecated pass `detail` (with a `title`) instead — kept for call sites not yet migrated. */
  message?: string;
  /** @deprecated pass `variant="compact"` instead — kept for call sites not yet migrated. */
  compact?: boolean;
}

const DEFAULT_TITLE = 'Something went wrong';
const DEFAULT_DETAIL = 'Failed to load data. Please try again.';

export function ErrorState({
  title,
  detail,
  message,
  onRetry,
  className,
  variant,
  compact,
}: ErrorStateProps) {
  const isCompact = variant ? variant === 'compact' : Boolean(compact);
  const heading = title ?? DEFAULT_TITLE;
  const body = detail ?? message ?? (title ? undefined : DEFAULT_DETAIL);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isCompact ? 'py-6 px-4' : 'py-12 px-6',
        className,
      )}
    >
      <div className="rounded-full bg-destructive/10 p-3 mb-3">
        <AlertTriangle className={cn('text-destructive', isCompact ? 'h-5 w-5' : 'h-6 w-6')} />
      </div>
      <h3 className={cn('font-medium text-foreground', isCompact ? 'text-sm' : 'text-base')}>
        {heading}
      </h3>
      {body ? (
        <p
          className={cn(
            'text-muted-foreground mt-1 max-w-[280px]',
            isCompact ? 'text-xs' : 'text-sm',
          )}
        >
          {body}
        </p>
      ) : null}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4 gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}
