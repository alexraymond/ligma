'use client';

import { showError, showSuccess } from '@/lib/toast';
import type { BrainDumpEntry } from '@ligma/api';
import { useCallback, useEffect, useRef, useState } from 'react';

const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Tracks brain dump entries that are being auto-processed in the background.
 * Persists the "processing" state past the fire-and-forget API response,
 * and detects completion by watching for `processed: true` transitions.
 * Auto-clears entries that exceed the timeout to prevent infinite spinners.
 */
export function useProcessingEntries(entries: BrainDumpEntry[]) {
  // Map of entryId → timestamp when processing started
  const [processingMap, setProcessingMap] = useState<Map<string, number>>(new Map());
  const prevEntriesRef = useRef<Map<string, boolean>>(new Map());

  // Detect when processing completes or times out
  useEffect(() => {
    const prev = prevEntriesRef.current;
    const now = Date.now();

    for (const entry of entries) {
      const wasUnprocessed = prev.get(entry.id) === false;
      const isNowProcessed = entry.processed;

      if (wasUnprocessed && isNowProcessed && processingMap.has(entry.id)) {
        const snippet = entry.content.slice(0, 50);
        const ellipsis = entry.content.length > 50 ? '...' : '';
        showSuccess(`Triaged: "${snippet}${ellipsis}"`);
        setProcessingMap((prev) => {
          const next = new Map(prev);
          next.delete(entry.id);
          return next;
        });
      }
    }

    // Check for timeouts
    const timedOut: string[] = [];
    for (const [id, startedAt] of processingMap) {
      if (now - startedAt > PROCESSING_TIMEOUT_MS) {
        timedOut.push(id);
      }
    }
    if (timedOut.length > 0) {
      showError(
        `Auto-processing timed out for ${timedOut.length} ${timedOut.length === 1 ? 'entry' : 'entries'}`,
      );
      setProcessingMap((prev) => {
        const next = new Map(prev);
        for (const id of timedOut) next.delete(id);
        return next;
      });
    }

    // Update ref for next comparison
    prevEntriesRef.current = new Map(entries.map((e) => [e.id, e.processed]));
  }, [entries, processingMap]);

  const markProcessing = useCallback((entryId: string) => {
    setProcessingMap((prev) => new Map(prev).set(entryId, Date.now()));
  }, []);

  const markAllProcessing = useCallback((entryIds: string[]) => {
    setProcessingMap((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const id of entryIds) next.set(id, now);
      return next;
    });
  }, []);

  const isProcessing = useCallback(
    (entryId: string) => processingMap.has(entryId),
    [processingMap],
  );

  const hasProcessing = processingMap.size > 0;
  const processingCount = processingMap.size;

  return {
    markProcessing,
    markAllProcessing,
    isProcessing,
    hasProcessing,
    processingCount,
  };
}
