'use client';

import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type GovernorStatus, useDaemon } from '@/hooks/use-daemon';
import { useMachineLogs } from '@/hooks/use-machine-logs';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { Activity, OctagonX, Server, Snowflake, Timer } from 'lucide-react';
import Link from 'next/link';
/**
 * The machine overlay (UX-REDESIGN §16 "The machine gets a home") — everything
 * about the daemon in one place, behind the heartbeat's click: daemon state,
 * the governor window with an honest deny reason, backends, the kill switch
 * (read-only), a log tail, the safety posture, and "Stop everything now".
 *
 * Never editable here: execution.skipPermissions, the signing key, oracle
 * deny-rules, the governor kill switch — this overlay only ever *displays*
 * them, per the brief's read-only-display-not-control rule.
 */
import { useState } from 'react';
import { type AftermathSummary, aftermathSummary } from './aftermath';

export type DenyReasonCode =
  | 'kill-switch'
  | 'disabled'
  | 'window-exhausted'
  | 'backend-cooling'
  | 'clear'
  | 'no-governor';

export interface DenyReason {
  code: DenyReasonCode;
  /** One plain sentence — never a table of maybes. */
  message: string;
}

/**
 * Why spawns won't happen, in the priority order the fields themselves imply:
 * a total kill switch outranks a disabled governor (which itself isn't
 * gating anything, so nothing past it matters), which outranks the window
 * being exhausted, which outranks a single backend cooling. Pure so the
 * table is unit-testable without rendering the overlay.
 */
export function governorDenyReason(
  governor: GovernorStatus | undefined,
  now: number = Date.now(),
): DenyReason {
  if (!governor) {
    return { code: 'no-governor', message: 'No governor state has been reported yet.' };
  }
  if (governor.killSwitch) {
    return {
      code: 'kill-switch',
      message: 'Kill switch is on — no autonomous sessions will start.',
    };
  }
  if (!governor.enabled) {
    return { code: 'disabled', message: "Governor is disabled — it isn't gating spawns at all." };
  }
  if (governor.remainingForAutonomy <= 0) {
    return {
      code: 'window-exhausted',
      message: 'This window is exhausted — no sessions remain for autonomy until it rolls over.',
    };
  }
  const cooling = Object.entries(governor.backends).find(([, b]) => b.state === 'cooling');
  if (cooling) {
    const [name, backend] = cooling;
    const until = backend.coolingUntil
      ? formatDateTime(backend.coolingUntil, now)
      : 'an unknown time';
    return {
      code: 'backend-cooling',
      message: `${name} is cooling until ${until} — spawns routed there wait.`,
    };
  }
  return { code: 'clear', message: 'Nothing is blocking spawns right now.' };
}

export function MachineOverlay({
  open,
  onOpenChange,
}: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { status, stop } = useDaemon();
  const logs = useMachineLogs(open);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [aftermath, setAftermath] = useState<AftermathSummary | null>(null);

  const governor = status.governor;
  const deny = governorDenyReason(governor);
  const cooling = governor
    ? Object.entries(governor.backends).filter(([, b]) => b.state === 'cooling')
    : [];

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Closing resets the stop flow — reopening starts from a clean state.
      setConfirming(false);
      setAftermath(null);
    }
    onOpenChange(next);
  }

  async function confirmStop() {
    const snapshot = status.activeSessions.map((s) => ({
      id: s.id,
      agentId: s.agentId,
      taskId: s.taskId,
    }));
    setStopping(true);
    try {
      await stop();
      setAftermath(aftermathSummary(snapshot));
    } finally {
      setStopping(false);
      setConfirming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            The machine
          </DialogTitle>
          <DialogDescription>
            Daemon state, the governor window, and what would stop if you stopped everything.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-6rem)] px-6 pb-6">
          <div className="space-y-5 text-sm">
            {aftermath ? (
              <AftermathPanel summary={aftermath} onDismiss={() => setAftermath(null)} />
            ) : (
              <>
                <Section title="Daemon">
                  <Fact label="Status" value={status.status} />
                  <Fact label="PID" value={status.pid !== null ? String(status.pid) : '—'} />
                  <Fact
                    label="Started"
                    value={status.startedAt ? formatRelativeTime(status.startedAt) : '—'}
                  />
                  <Fact label="Active sessions" value={String(status.activeSessions.length)} />
                  <Fact
                    label="Last poll"
                    value={status.lastPollAt ? formatRelativeTime(status.lastPollAt) : '—'}
                  />
                </Section>

                <Section title="Governor window">
                  {governor ? (
                    <>
                      <Fact
                        label="Window"
                        value={`${governor.used}/${governor.max} over ${governor.windowHours}h`}
                      />
                      <Fact label="Reserve floor" value={String(governor.reserveFloor)} />
                      <Fact
                        label="Remaining for autonomy"
                        value={String(governor.remainingForAutonomy)}
                      />
                      <p
                        className={
                          deny.code === 'clear'
                            ? 'text-muted-foreground'
                            : 'font-medium text-amber-600 dark:text-amber-500'
                        }
                      >
                        {deny.message}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">{deny.message}</p>
                  )}
                </Section>

                {governor && (
                  <Section title="Backends">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(governor.backends).map(([name, backend]) => (
                        <Badge
                          key={name}
                          variant="outline"
                          className={
                            backend.state === 'cooling'
                              ? 'gap-1.5 border-amber-500/50 text-amber-600'
                              : 'gap-1.5 border-green-600/50 text-green-600'
                          }
                        >
                          {backend.state === 'cooling' ? (
                            <Snowflake className="h-3 w-3" />
                          ) : (
                            <Activity className="h-3 w-3" />
                          )}
                          {name}: {backend.state}
                          {backend.state === 'cooling' &&
                            backend.coolingUntil &&
                            ` until ${formatDateTime(backend.coolingUntil)}`}
                        </Badge>
                      ))}
                      {cooling.length === 0 && (
                        <span className="text-muted-foreground">No backend is cooling.</span>
                      )}
                    </div>
                  </Section>
                )}

                <Section title="Kill switch">
                  <div className="flex items-center gap-2">
                    {governor?.killSwitch ? (
                      <Badge
                        variant="outline"
                        className="gap-1.5 border-destructive text-destructive"
                      >
                        <OctagonX className="h-3 w-3" />
                        on
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        off
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A stop a browser can reach is a stop an agent can un-press — so the kill switch
                    lives only in the file and CLI:{' '}
                    <code className="font-mono">touch data/governor-kill</code>.
                  </p>
                </Section>

                <Section title="Logs">
                  {logs.error ? (
                    <ErrorState
                      title="Couldn't load logs"
                      detail={logs.error}
                      variant="compact"
                      onRetry={() => void logs.refetch()}
                    />
                  ) : (
                    <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs leading-relaxed">
                      {logs.lines.length === 0 ? (
                        <p className="text-muted-foreground">
                          {logs.loading ? 'Loading…' : 'No log lines yet.'}
                        </p>
                      ) : (
                        logs.lines.map((line, i) => (
                          <div key={i} className="whitespace-pre-wrap break-all">
                            {line}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </Section>

                <Section title="Safety posture">
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    <li>Agents run with a role-scoped tool allowlist.</li>
                    <li>
                      Skip-permissions cannot be enabled from this UI — the daemon rejects it
                      server-side.
                    </li>
                    <li>
                      The kill switch and the signing key are file-only; nothing here can press or
                      un-press them.
                    </li>
                  </ul>
                </Section>

                <Section title="Stop everything now">
                  {confirming ? (
                    <div className="space-y-3 rounded-md border border-destructive/50 bg-destructive/5 p-3">
                      <p>
                        This ends every active session right now
                        {status.activeSessions.length > 0
                          ? ` (${status.activeSessions.length})`
                          : ''}
                        : each session&rsquo;s process is killed, and its task is returned to
                        not-started unless it had already finished. The daemon stops dispatching
                        until you start it again.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={stopping}
                          onClick={() => void confirmStop()}
                        >
                          {stopping ? 'Stopping…' : 'Confirm stop'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={stopping}
                          onClick={() => setConfirming(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirming(true)}
                      className="gap-1.5"
                    >
                      <Timer className="h-3.5 w-3.5" />
                      Stop everything now
                    </Button>
                  )}
                </Section>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function AftermathPanel({
  summary,
  onDismiss,
}: { summary: AftermathSummary; onDismiss: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="font-medium">
          {summary.endedCount} session{summary.endedCount === 1 ? '' : 's'} ended.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{summary.taskNote}</p>
      </div>

      {summary.sessions.length > 0 && (
        <ul className="space-y-1 text-xs">
          {summary.sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border px-2 py-1">
              <span className="font-mono">{s.agentId}</span>
              <span className="text-muted-foreground">{s.taskId ?? 'no task'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Recovery lives here:</p>
        {summary.recoveryLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="block rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
            onClick={onDismiss}
          >
            <span className="font-medium">{link.label}</span>{' '}
            <span className="text-muted-foreground">— {link.detail}</span>
          </Link>
        ))}
      </div>

      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Back to machine state
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
