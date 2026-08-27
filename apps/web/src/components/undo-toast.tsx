'use client';

import { undoSecondsLeft } from '@/lib/undo';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface UndoToastProps {
  /** What just happened, e.g. "Dismissed" or "Deferred 7 days". */
  label: string;
  /** The decision that was acted on. */
  question: string;
  /**
   * When the take-back stops being on offer, epoch ms. For a decision this is
   * the server's own `undoExpiresAt` — the toast never invents a window, so the
   * ring cannot promise time the server will not honour.
   */
  expiresAt: number;
  /** Runs the server-validated undo. Should resolve when the undo settled. */
  onUndo: () => Promise<void>;
  /** Called once when the window closes (or after an undo attempt finishes). */
  onExpire: () => void;
}

const TICK_MS = 100;
const RING_CIRCUMFERENCE = 81.68; // 2πr for r=13

export function UndoToast({ label, question, expiresAt, onUndo, onExpire }: UndoToastProps) {
  const totalMs = useRef(Math.max(expiresAt - Date.now(), 1)).current;
  const [now, setNow] = useState(() => Date.now());
  const [undoing, setUndoing] = useState(false);
  // Kept in a ref so a new callback identity can't restart the countdown.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    // Deadline-based, so a throttled background tab still expires on time.
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= expiresAt) {
        clearInterval(timer);
        onExpireRef.current();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const handleUndo = async () => {
    if (undoing) return;
    setUndoing(true);
    try {
      await onUndo();
    } finally {
      onExpireRef.current();
    }
  };

  const progress = Math.max(0, Math.min(1, (expiresAt - now) / totalMs));
  const seconds = undoSecondsLeft(expiresAt, now);

  return (
    <div
      role="status"
      data-testid="undo-toast"
      className="flex items-center gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm max-w-md"
    >
      <div className="relative h-8 w-8 shrink-0 text-primary">
        <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
          <circle
            cx="16"
            cy="16"
            r="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.2"
          />
          <circle
            cx="16"
            cy="16"
            r="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={`${progress * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
          {seconds}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{question}</p>
      </div>

      <button
        type="button"
        onClick={handleUndo}
        disabled={undoing}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
      >
        <Undo2 className="h-3.5 w-3.5" />
        {undoing ? 'Undoing…' : 'Undo'}
      </button>
    </div>
  );
}
