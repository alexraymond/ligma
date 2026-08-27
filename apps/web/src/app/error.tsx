'use client';

import { Button } from '@/components/ui/button';
import { AlertTriangle, ChevronDown, ChevronUp, Home, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const AUTO_RETRY_DELAY = 3000; // 3 seconds

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [autoRetryCountdown, setAutoRetryCountdown] = useState(Math.ceil(AUTO_RETRY_DELAY / 1000));
  const [autoRetryDone, setAutoRetryDone] = useState(false);

  useEffect(() => {
    console.error('[Ligma Error]', error);
  }, [error]);

  // Auto-retry once after a delay
  useEffect(() => {
    if (autoRetryDone) return;

    const countdown = setInterval(() => {
      setAutoRetryCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdown);
          setAutoRetryDone(true);
          reset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, [reset, autoRetryDone]);

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="rounded-full bg-destructive/10 p-3 mb-4">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-[360px]">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>

      {!autoRetryDone && autoRetryCountdown > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Retrying automatically in {autoRetryCountdown}s...
        </p>
      )}

      <div className="flex items-center gap-2 mt-4">
        <Button variant="outline" size="sm" onClick={reset} className="gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </Button>
        <Button variant="ghost" size="sm" asChild className="gap-2">
          <Link href="/">
            <Home className="h-3.5 w-3.5" />
            Home
          </Link>
        </Button>
      </div>

      {/* Expandable error details for debugging */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {showDetails ? 'Hide' : 'Show'} details
      </button>

      {showDetails && (
        <div className="mt-2 max-w-[480px] w-full text-left rounded-md border bg-muted/50 p-3">
          <p className="text-xs font-mono text-muted-foreground break-all whitespace-pre-wrap">
            {error.stack || error.message || 'No additional details available.'}
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground mt-2">
              Digest: <code className="font-mono">{error.digest}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
