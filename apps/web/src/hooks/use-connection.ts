'use client';

import { apiFetch } from '@/lib/api-client';
import { useCallback, useEffect, useState } from 'react';

const PING_INTERVAL = 30_000; // 30 seconds
const PING_TIMEOUT = 5_000; // 5 second timeout for health check

/**
 * Hook that monitors connection to the Mission Control API server.
 *
 * Detects both:
 * - Browser offline (navigator.onLine === false)
 * - Server unreachable (API health check fails)
 *
 * Returns `online: false` when either condition is detected.
 */
export function useConnection() {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);

  const checkConnection = useCallback(async () => {
    // Don't overlap checks
    if (checking) return;
    setChecking(true);

    try {
      // Browser says we're offline — no point pinging
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setOnline(false);
        return;
      }

      // Lightweight HEAD request to the dashboard endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);

      try {
        // Still no retry — this is a raw connectivity check that must fail
        // fast — but apiFetch's auth header keeps this consistent with every
        // other request the app makes (W5).
        const res = await apiFetch('/api/dashboard', {
          method: 'HEAD',
          signal: controller.signal,
          retries: 0,
        });
        clearTimeout(timeout);
        setOnline(res.ok || res.status < 500);
      } catch {
        clearTimeout(timeout);
        setOnline(false);
      }
    } finally {
      setChecking(false);
    }
  }, [checking]);

  useEffect(() => {
    // Browser online/offline events (fast detection for network drops).
    // "online" only means the network is back (W23) — it says nothing about
    // whether the daemon itself is reachable, so it re-runs the real check
    // rather than assuming reachable. "offline" is a reliable negative either
    // way: no network means no daemon, full stop.
    const handleOnline = () => void checkConnection();
    const handleOffline = () => setOnline(false);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    // Checked immediately (W23), not just on the first 30s tick — otherwise
    // a daemon that's already unreachable at load reads "online" for up to
    // PING_INTERVAL before anything says otherwise.
    void checkConnection();
    const interval = setInterval(checkConnection, PING_INTERVAL);

    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, [checkConnection]);

  return { online };
}
