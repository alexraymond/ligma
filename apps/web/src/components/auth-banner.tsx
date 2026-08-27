'use client';

import { useDaemon } from '@/hooks/use-daemon';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { apiFetch } from '@/lib/api-client';
import {
  type AuthStatus,
  activeBackend,
  authBannerCopy,
  authBannerReason,
} from '@/lib/auth-banner';
import { cn } from '@/lib/utils';
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * First-run guidance for the home composer (there is no in-app auth — Ligma
 * inherits whichever CLI session is already on the machine, and nothing else
 * told a new user that). Sits above `<KickoffComposer>` on the empty-state
 * home page; does not block submission, since the probe can be wrong — it
 * just stays impossible to miss until it goes green.
 *
 * `BackendProbe`'s wire shape is duplicated locally rather than imported
 * cross-package, same call as `agents-card.tsx` makes for the same route —
 * see that file's docstring.
 */

type Backend = 'claude' | 'codex' | 'gemini';

interface BackendProbe {
  backend: Backend;
  available: boolean;
  authStatus: AuthStatus;
}

const POLL_INTERVAL_MS = 15_000;

async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command);
    toast.success('Command copied');
  } catch {
    toast.error('Could not copy — your browser blocked clipboard access');
  }
}

export function AuthBanner() {
  const { config } = useDaemon();
  const [backends, setBackends] = useState<BackendProbe[] | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch('/api/backends');
      if (res.ok) setBackends((await res.json()).backends);
    } catch {
      // Best-effort — the banner just keeps showing its last-known state.
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
    } catch {
      toast.error('Failed to reach the daemon');
    } finally {
      setRescanning(false);
    }
  }

  const active = activeBackend(config.execution.backendMode);
  const probe = backends?.find((b) => b.backend === active);
  const reason = authBannerReason(active, probe);

  if (!reason) return null;

  const copy = authBannerCopy(active, reason);

  return (
    <div
      role="alert"
      className={cn(
        'space-y-2 rounded-md border px-4 py-3 text-sm',
        'border-destructive/50 bg-destructive/10 text-destructive',
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {copy.title}
      </p>
      <p className="text-foreground/90">{copy.body}</p>
      {copy.command ? (
        <button
          type="button"
          onClick={() => void copyCommand(copy.command as string)}
          className="inline-flex items-center gap-1.5 rounded-md border border-current/30 bg-background px-2 py-1 font-mono text-xs text-foreground hover:bg-accent"
        >
          <Copy className="h-3 w-3 shrink-0" aria-hidden />
          {copy.command}
        </button>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 pt-0.5">
        <button
          type="button"
          onClick={() => void rescan()}
          disabled={rescanning}
          className="inline-flex items-center gap-1.5 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-current/10 disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', rescanning && 'animate-spin')} aria-hidden />
          {rescanning ? 'Checking...' : 'Check again'}
        </button>
        <Link href="/settings#agents" className="text-xs font-medium underline underline-offset-2">
          Settings → Agents
        </Link>
      </div>
    </div>
  );
}
