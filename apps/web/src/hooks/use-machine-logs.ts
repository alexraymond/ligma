'use client';

import { useSmartPoll } from '@/hooks/use-smart-poll';
import { apiFetch } from '@/lib/api-client';
/**
 * Tail of GET /api/logs — the machine overlay's log section, and this
 * endpoint's first UI consumer. Fetches once when `enabled` turns true (the
 * overlay opening) and every 5s while it stays true; `useSmartPoll` already
 * owns the visibility-aware scheduling and mount/unmount wiring, so this hook
 * is just the fetch plus the endpoint's own contract (`lines=100`, capped at
 * 500 server-side).
 */
import { useCallback, useState } from 'react';

const LOG_LINES = 100;
const POLL_INTERVAL_MS = 5000;

export interface MachineLogs {
  lines: string[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMachineLogs(enabled: boolean): MachineLogs {
  const [lines, setLines] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/logs?lines=${LOG_LINES}`);
      if (!res.ok) throw new Error('Failed to load logs');
      const data = await res.json();
      setLines(Array.isArray(data.lines) ? data.lines : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useSmartPoll(refetch, { intervalMs: POLL_INTERVAL_MS, enabled });

  return { lines, total, loading, error, refetch };
}
