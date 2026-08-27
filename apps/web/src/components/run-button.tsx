'use client';

import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';
import { Loader2, Rocket } from 'lucide-react';

/**
 * Session estimate for the launch affordance (UX-REDESIGN §16: "session
 * estimate shown on every launch affordance"). Pure so it pins in a test
 * without rendering. Checked against apps/daemon/src/engine/dispatcher.ts
 * (dispatchPendingTasks always spawns one builder session per task) and
 * apps/daemon/src/harness/verdict.ts's `isVerifiable` (a contract-bearing
 * task auto-follows with one verification run once the builder finishes;
 * a task with no contract has no oracle to verify against, so it doesn't).
 */
export function launchEstimate(hasContract: boolean): string {
  return hasContract
    ? 'Spawns 1 builder session, then a verification run once it finishes'
    : 'Spawns 1 builder session';
}

interface RunButtonProps {
  isRunning: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  /** Does this task carry a compiled contract? Unknown callers default to false — still true, just less specific. */
  hasContract?: boolean;
}

export function RunButton({
  isRunning,
  onClick,
  size = 'sm',
  disabled = false,
  title,
  hasContract = false,
}: RunButtonProps) {
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const btnSize = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';
  const tip = title ?? (isRunning ? 'Launching...' : launchEstimate(hasContract));

  return (
    <Tip content={tip}>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          btnSize,
          'shrink-0 rounded-full transition-colors',
          isRunning
            ? 'text-green-500 cursor-default'
            : 'text-muted-foreground hover:text-green-500 hover:bg-green-500/10',
        )}
        disabled={disabled || isRunning}
        title={tip}
        aria-label={tip}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!isRunning && !disabled) {
            onClick();
          }
        }}
      >
        {isRunning ? (
          <Loader2 className={cn(iconSize, 'animate-spin')} />
        ) : (
          <Rocket className={cn(iconSize)} />
        )}
      </Button>
    </Tip>
  );
}
