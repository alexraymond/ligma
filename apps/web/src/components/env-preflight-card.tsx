'use client';

import { FailureCard } from '@/components/failure';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/** Mirrors scripts/env/preflight.ts — the wire shape, not an import (server-only module). */
type CheckStatus = 'pass' | 'warning' | 'fail';
type CheckSeverity = 'info' | 'warning' | 'blocking';
type FixKind = 'reconcile-orphans' | 'prune-boot-logs' | 'reset-env-manifest' | 'install-chromium';

interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  details?: string;
  fix?: { kind: FixKind; label: string };
}

interface PreflightResult {
  checks: Check[];
  scannedAt: string;
}

const DOT: Record<CheckStatus, string> = {
  pass: 'bg-green-500',
  warning: 'bg-amber-500',
  fail: 'bg-destructive',
};

/**
 * Environment preflight: the checks that predict why creating an ephemeral env
 * would fail. Each fix button posts a *kind*, never a command — the server
 * executes one of four hard-coded branches and re-scans.
 */
export function EnvPreflightCard() {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<FixKind | 'scan' | null>(null);

  const scan = useCallback(async (force: boolean) => {
    setBusy('scan');
    try {
      const res = await apiFetch(`/api/env-preflight${force ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`Scan failed (${res.status})`);
      setResult((await res.json()) as PreflightResult);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void scan(false);
  }, [scan]);

  async function applyFix(kind: FixKind) {
    setBusy(kind);
    try {
      const res = await apiFetch('/api/env-preflight/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = (await res.json()) as PreflightResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Fix failed (${res.status})`);
      setResult(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fix failed');
    } finally {
      setBusy(null);
    }
  }

  const blocking = result?.checks.find((c) => c.severity === 'blocking' && c.status !== 'pass');
  const failing = result?.checks.filter((c) => c.status !== 'pass').length ?? 0;

  return (
    <Card className={cn(blocking && 'border-destructive')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              Environment Preflight
            </CardTitle>
            <CardDescription>
              {result
                ? failing === 0
                  ? 'All checks pass — ephemeral envs should build'
                  : `${failing} of ${result.checks.length} checks need attention`
                : 'Scanning…'}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void scan(true)}
            disabled={busy !== null}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy === 'scan' && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {blocking && (
          <FailureCard
            failureClass="boot"
            detail={blocking.message}
            note="Fixed by the specific check's button below."
          />
        )}

        <div className="divide-y">
          {result?.checks.map(({ fix, ...check }) => (
            <div key={check.id} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[check.status])} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{check.label}</div>
                <div className="text-xs text-muted-foreground break-words">{check.message}</div>
              </div>
              {fix && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-7 text-xs"
                  onClick={() => void applyFix(fix.kind)}
                  disabled={busy !== null}
                >
                  {busy === fix.kind ? 'Working…' : fix.label}
                </Button>
              )}
            </div>
          ))}
        </div>

        {result && (
          <p className="text-xs text-muted-foreground">
            Scanned {new Date(result.scannedAt).toLocaleTimeString()}. Installing chromium runs in
            the background for several minutes — the row keeps saying &ldquo;installing…&rdquo;
            until a refresh actually finds the binary.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
