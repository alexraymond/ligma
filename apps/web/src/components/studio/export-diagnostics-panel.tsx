'use client';

/**
 * Export diagnostics (OD-115): recent export attempts with their typed
 * `EXPORTER_*` codes and a plain-language explanation, so a failed export is
 * legible instead of a toast that vanishes in six seconds.
 *
 * Ported from open-design's `ExportDiagnosticsButton.tsx` — its Electron
 * save-dialog / HTTP-download split and its own diagnostics ZIP endpoint
 * don't apply here (ligma's export already downloads via `runExport` in
 * `studio-surface.tsx`); what's ported is the shape of the idea — a small
 * history panel next to the export action, not a settings-page row.
 */

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/ui/tip';
import { formatRelativeTime } from '@/lib/time';
import { AlertCircle, CheckCircle2, History } from 'lucide-react';
import { explainExportError } from './export-error-code';
import type { ExportAttempt } from './export-history';

export function ExportDiagnosticsPanel({ history }: { history: ExportAttempt[] }) {
  return (
    <Popover>
      <Tip content="Export diagnostics">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Export diagnostics">
            <History className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-80 p-0">
        <header className="border-b px-3 py-2 text-xs font-medium">Recent exports</header>
        {history.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">No export attempts yet.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto">
            {history.map((attempt) => (
              <li key={attempt.id} className="border-b px-3 py-2 text-xs last:border-b-0">
                <div className="flex items-center gap-1.5">
                  {attempt.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                  )}
                  <span className="font-medium uppercase">{attempt.format}</span>
                  {!attempt.ok ? (
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                      {attempt.code}
                    </code>
                  ) : null}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {formatRelativeTime(attempt.at)}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {attempt.ok ? attempt.message : explainExportError(attempt.code)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
