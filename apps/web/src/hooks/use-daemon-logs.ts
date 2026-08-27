'use client';

import { useSmartPoll } from '@/hooks/use-smart-poll';
import { apiFetch } from '@/lib/api-client';
import { useCallback, useEffect, useState } from 'react';

const POLL_INTERVAL = 5000; // 5 seconds

interface DaemonLogsResult {
  lines: string[];
  total: number;
  isLoading: boolean;
}

/**
 * The daemon's tail. On `useSmartPoll` rather than a raw interval: this was the
 * app's other poller that kept reading from a backgrounded tab, and a log tail
 * is precisely what nobody is looking at while the tab is hidden.
 */
export function useDaemonLogs(enabled: boolean): DaemonLogsResult {
  const [lines, setLines] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  // Loading means "no read has landed since this was switched on" — a distinct
  // state from "the tail is empty", so opening the panel doesn't claim silence.
  const [isLoading, setIsLoading] = useState(enabled);
  useEffect(() => {
    if (enabled) setIsLoading(true);
  }, [enabled]);

  const fetchLogs = useCallback(async (isStale: () => boolean) => {
    try {
      const res = await apiFetch('/api/logs?lines=200');
      if (!res.ok || isStale()) return;
      const data = await res.json();
      setLines(data.lines ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // Silently fail on poll errors
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, []);

  useSmartPoll(fetchLogs, { intervalMs: POLL_INTERVAL, enabled });

  return { lines, total, isLoading };
}
