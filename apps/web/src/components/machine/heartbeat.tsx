'use client';

import { EXECUTION, RunningDot } from '@/components/status-pill';
import { Tip } from '@/components/ui/tip';
import { useConnection } from '@/hooks/use-connection';
import { useDaemon } from '@/hooks/use-daemon';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { OctagonX } from 'lucide-react';
/**
 * One heartbeat in the top bar (UX-REDESIGN §16 "The machine gets a home") —
 * the governor gauge and the (nonexistent) autopilot pill merge into this
 * single indicator. Five states, no synonyms: `running` (with the active
 * session count), `stopped`, `starting`, `unreachable` (the daemon poll
 * itself is failing — desaturated, not a new status colour), and
 * `kill-switch-on` (destructive, same posture as governor-card's precedent).
 * Clicking it opens the machine overlay — this component owns no daemon
 * control of its own.
 *
 * Colours are borrowed from status-pill.tsx's EXECUTION table (seam rule 1:
 * that file is the only paint site) except kill-switch-on, which — per spec —
 * matches governor-card.tsx's existing destructive treatment for the same
 * state rather than inventing a new one.
 */
import { useState } from 'react';
import { MachineOverlay } from './machine-overlay';

export type HeartbeatState = 'running' | 'stopped' | 'starting' | 'unreachable' | 'kill-switch-on';

/** The minimal daemon status shape this derivation needs — structurally compatible with useDaemon()'s status. */
export interface HeartbeatDaemonStatus {
  status: 'running' | 'stopped' | 'starting';
  activeSessions: unknown[];
  governor?: { killSwitch: boolean };
}

/**
 * Pure state derivation, extracted so it's testable without rendering
 * anything (this repo's vitest runs node-only, no jsdom). Precedence:
 * an unreachable daemon overshadows everything else — nothing it reports can
 * be trusted; a live kill switch outranks the engine's own running/starting
 * status because it's the more urgent fact ("nothing will spawn" matters more
 * than "the loop is technically up").
 */
export function heartbeatState(status: HeartbeatDaemonStatus, reachable: boolean): HeartbeatState {
  if (!reachable) return 'unreachable';
  if (status.governor?.killSwitch) return 'kill-switch-on';
  return status.status;
}

const HEARTBEAT_STYLE: Record<
  HeartbeatState,
  { className: string; icon: LucideIcon | null; label: (sessions: number) => string; tip: string }
> = {
  running: {
    className: EXECUTION.running.className,
    icon: null,
    label: (n) => `running · ${n} active`,
    tip: 'The daemon is dispatching. Click for the full machine state.',
  },
  stopped: {
    className: EXECUTION.queued.className,
    icon: EXECUTION.queued.icon,
    label: () => 'stopped',
    tip: "The engine loop is down — nothing will dispatch until it's started again.",
  },
  starting: {
    className: EXECUTION.deferred.className,
    icon: EXECUTION.deferred.icon,
    label: () => 'starting',
    tip: 'The engine loop is coming up.',
  },
  unreachable: {
    // Deliberately not one of status-pill's colours — desaturated muted-foreground
    // at reduced opacity, a treatment on the same neutral family, not a new hue.
    className: 'border-muted-foreground/30 text-muted-foreground/50',
    icon: EXECUTION.queued.icon,
    label: () => 'no signal',
    tip: "The daemon poll is failing — this app can't currently confirm the machine's state.",
  },
  'kill-switch-on': {
    // Matches governor-card.tsx's existing destructive kill-switch treatment,
    // not status-pill's failed vocabulary — this is that same precedent, reused.
    className: 'border-destructive bg-destructive/10 text-destructive',
    icon: OctagonX,
    label: () => 'kill switch',
    tip: 'The kill switch is on — no autonomous sessions will start.',
  },
};

export function Heartbeat() {
  const { status } = useDaemon();
  const { online } = useConnection();
  const [open, setOpen] = useState(false);

  const state = heartbeatState(status, online);
  const style = HEARTBEAT_STYLE[state];
  const Icon = style.icon;
  const label = style.label(status.activeSessions.length);

  return (
    <>
      <Tip content={style.tip}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Machine: ${label}`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent/50',
            style.className,
          )}
        >
          {Icon ? <Icon className="h-3.5 w-3.5" /> : <RunningDot />}
          <span className="tabular-nums">{label}</span>
        </button>
      </Tip>
      <MachineOverlay open={open} onOpenChange={setOpen} />
    </>
  );
}
