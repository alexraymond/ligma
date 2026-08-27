'use client';

import { FailureCard, classifyCause } from '@/components/failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { apiFetch } from '@/lib/api-client';
import { Bot, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Per-agent-backend live status (OD-061, OD-065, OD-086, OD-088, OD-117–119,
 * OD-128), sitting on top of the daemon's `apps/daemon/src/engine/backend-probe.ts`
 * (itself built on the "dormant" `AgentRunner.probeBackend`/`findCliBinary`).
 *
 * Wire shape is duplicated locally rather than imported cross-package —
 * `ProductRootInfo` in project-locations-card.tsx and `AboutInfo` in
 * about-card.tsx already do the same for the same reason: these settings
 * cards talk to the daemon's JSON, not a shared `@ligma/api` type, for routes
 * this small.
 *
 * Mounted next to `<NotificationsCard />` in apps/web/src/app/settings/page.tsx.
 */

type Backend = 'claude' | 'codex' | 'gemini';
type AuthStatus = 'authenticated' | 'unauthenticated' | 'unknown';
type CauseKind = 'env' | 'auth' | null;

interface BackendProbe {
  backend: Backend;
  available: boolean;
  path: string;
  version: string | null;
  configuredPath: string | null;
  authStatus: AuthStatus;
  causeKind: CauseKind;
  message: string | null;
  probedAt: string;
}

const BACKEND_LABEL: Record<Backend, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

const AUTH_BADGE: Record<
  AuthStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  authenticated: { label: 'Authenticated', variant: 'default' },
  unauthenticated: { label: 'Not authenticated', variant: 'secondary' },
  unknown: { label: 'Auth: unknown', variant: 'outline' },
};

const POLL_INTERVAL_MS = 15_000;

export function AgentsCard() {
  const [backends, setBackends] = useState<BackendProbe[] | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch('/api/backends');
      if (res.ok) setBackends((await res.json()).backends);
    } catch {
      // Best-effort — the card just keeps showing the last-known state.
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useSmartPoll(refetch, { intervalMs: POLL_INTERVAL_MS });

  async function rescan() {
    setRescanning(true);
    try {
      const res = await apiFetch('/api/backends/rescan', { method: 'POST' });
      if (!res.ok) throw new Error('request failed');
      setBackends((await res.json()).backends);
      toast.success('Backends rescanned');
    } catch {
      toast.error('Failed to reach the daemon');
    } finally {
      setRescanning(false);
    }
  }

  return (
    <Card id="agents">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Agent backends
            </CardTitle>
            <CardDescription className="mt-1.5">
              Detected binary, version and auth status for claude/codex/gemini — no model turn
              spawned.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={rescan}
            disabled={rescanning}
          >
            <RefreshCw className={rescanning ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            {rescanning ? 'Rescanning...' : 'Rescan'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {backends === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          backends.map((probe) => <BackendRow key={probe.backend} probe={probe} />)
        )}
      </CardContent>
    </Card>
  );
}

function BackendRow({ probe }: { probe: BackendProbe }) {
  // `classifyCause` defaults an absent cause to "unknown" (it assumes the call
  // site already knows a failure happened) — so presence is checked here
  // first, and the mapper is only reached once there's an actual cause.
  const failureClass = probe.causeKind ? classifyCause(probe.causeKind) : null;

  return (
    <div className="space-y-1.5 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{BACKEND_LABEL[probe.backend]}</span>
        {probe.available && (
          <Badge variant={AUTH_BADGE[probe.authStatus].variant}>
            {AUTH_BADGE[probe.authStatus].label}
          </Badge>
        )}
      </div>

      {failureClass ? (
        <FailureCard failureClass={failureClass} detail={probe.message} variant="inline" />
      ) : (
        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <p className="truncate">
            Path: <span className="font-mono">{probe.path}</span>
          </p>
          <p>
            Version: <span className="font-mono">{probe.version ?? 'unknown'}</span>
          </p>
          {probe.configuredPath && (
            <p className="truncate sm:col-span-2">
              Config override: <span className="font-mono">{probe.configuredPath}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
