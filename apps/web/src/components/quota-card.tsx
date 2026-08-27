'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GovernorStatus } from '@/hooks/use-daemon';
import { cn } from '@/lib/utils';
import { Gauge, OctagonX } from 'lucide-react';

/**
 * The quota governor, read-only. Flipping the kill switch stays a file action on
 * purpose: a stop button reachable from a browser tab is a stop button an agent
 * with a browser can un-press.
 */
export function QuotaCard({ governor }: { governor: GovernorStatus | undefined }) {
  if (!governor) return null;

  const { used, max, reserveFloor, remainingForAutonomy, windowHours, killSwitch, enabled } =
    governor;
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const floorPct = max > 0 ? Math.min(100, (reserveFloor / max) * 100) : 0;
  const inReserve = used >= reserveFloor;

  return (
    <Card className={cn(killSwitch && 'border-destructive')}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-muted-foreground" />
          Quota
        </CardTitle>
        <CardDescription>
          Claude sessions in the last {windowHours}h{enabled ? '' : ' · gating disabled'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {killSwitch && (
          <div className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <OctagonX className="h-4 w-4 shrink-0" />
            <span>Kill switch active — no autonomous sessions will start.</span>
          </div>
        )}

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{used}</span>
          <span className="text-sm text-muted-foreground">/ {max} sessions</span>
        </div>

        {/* Bar with the autonomy floor marked; everything right of it is the human's. */}
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', inReserve ? 'bg-amber-500' : 'bg-blue-500')}
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground/60"
            style={{ left: `${floorPct}%` }}
            title={`Autonomy floor: ${reserveFloor}`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {remainingForAutonomy} left for agents before the reserve ({max - reserveFloor} sessions
          kept for you)
        </p>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(governor.backends).map(([backend, state]) => (
            <Badge
              key={backend}
              variant="outline"
              className={cn(
                'gap-1.5',
                state.state === 'cooling'
                  ? 'border-amber-500/50 text-amber-600'
                  : 'text-muted-foreground',
              )}
              title={
                state.coolingUntil
                  ? `Cooling until ${new Date(state.coolingUntil).toLocaleTimeString()}`
                  : undefined
              }
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  state.state === 'cooling' ? 'bg-amber-500' : 'bg-green-500',
                )}
              />
              {backend}
            </Badge>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Stop everything mid-flight: <code className="font-mono">touch data/governor-kill</code>
        </p>
      </CardContent>
    </Card>
  );
}
