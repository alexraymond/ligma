import { Button } from '@open-codesign/ui';
import { CheckCircle, Loader2, Sparkles, Terminal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ClaudeCliStatus } from '../../../preload/index';
import { useCodesignStore } from '../store';

export interface ClaudeCliLoginCardProps {
  onStatusChange?: () => void | Promise<void>;
}

export function ClaudeCliLoginCard({ onStatusChange }: ClaudeCliLoginCardProps) {
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [status, setStatus] = useState<ClaudeCliStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      if (!window.codesign) return;
      const next = await window.codesign.claudeCli.status();
      setStatus(next);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Claude CLI status failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [pushToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    setLoading(true);
    try {
      if (!window.codesign) return;
      const next = await window.codesign.claudeCli.add();
      setStatus(next);
      await onStatusChange?.();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Could not add Claude subscription',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }, [onStatusChange, pushToast]);

  const handleRemove = useCallback(async () => {
    if (!window.confirm('Remove the Claude Max Subscription provider?')) return;
    setLoading(true);
    try {
      if (!window.codesign) return;
      const next = await window.codesign.claudeCli.remove();
      setStatus(next);
      await onStatusChange?.();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Could not remove provider',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }, [onStatusChange, pushToast]);

  if (status === null) {
    return (
      <div className="rounded-lg border border-[var(--color-border-subtle)] p-4 flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-text-muted)]">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking Claude Code CLI…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-[var(--color-accent-subtle)] flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
              Claude Max Subscription
            </h4>
            {status.configured && (
              <span className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-success)]">
                <CheckCircle className="w-3 h-3" />
                Added{status.active ? ' · active' : ''}
              </span>
            )}
          </div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            Use your Claude Max plan via the local Claude Code CLI — no API key needed. Fork-local;
            see Anthropic's Agent SDK docs for usage limits.
          </p>
          {status.version !== null && (
            <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 font-mono flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              claude v{status.version}
            </p>
          )}
          {status.message !== null && (
            <p className="text-[var(--text-xs)] text-[var(--color-warning)] mt-2 leading-relaxed">
              {status.message}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!status.configured ? (
          <Button
            variant="primary"
            size="sm"
            onClick={handleAdd}
            disabled={loading || !status.installed}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add as provider'}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={handleRemove} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Remove'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
