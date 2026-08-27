'use client';

import { PinComposer } from '@/components/pin-composer';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { EvidencePin, RecordEvidencePin } from '@ligma/api';
import { Pin } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * Evidence pinning for a **record** (UX spec F6, §6 Verify: "transcript/output
 * pinning for headless").
 *
 * A headless run's evidence is not a picture. It is a transcript, a recorded
 * request/response, an exit code — so the pointing is a *line*, not a
 * coordinate, and the screenshot pinner has nothing to offer it. On the shape D1
 * walks, this was the whole of F6 with no surface at all: the transcripts were
 * rendered as bare download links.
 *
 * Same compiled instruction, same dispositions, same preview — `PinComposer`
 * owns all three, so the two pinners cannot mean different things by "pin it".
 *
 * ponytail: the whole capture is fetched and shown as numbered lines. Records
 * are per-persona and small. If one ever gets big enough to matter, the fix is
 * a windowed reader over the same file route, not a different pin model.
 */
const MAX_LINES = 500;

export function RecordPinner({
  projectId,
  runId,
  evidencePath,
  taskId,
  label,
}: {
  projectId: string | null;
  runId: string;
  evidencePath: string;
  taskId: string | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pins, setPins] = useState<RecordEvidencePin[]>([]);
  const [draftLine, setDraftLine] = useState<number | null>(null);

  const loadPins = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/evidence-pins?runId=${encodeURIComponent(runId)}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as { pins: EvidencePin[] };
      setPins(
        json.pins.filter(
          (p): p is RecordEvidencePin => p.kind === 'record' && p.evidencePath === evidencePath,
        ),
      );
    } catch {
      // An enrichment: failing to list pins must not hide the record.
    }
  }, [projectId, runId, evidencePath]);

  useEffect(() => {
    if (!open || lines !== null || readError !== null) return;
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch(
          `/api/verification-runs/${encodeURIComponent(runId)}/file?path=${encodeURIComponent(evidencePath)}`,
        );
        if (!res.ok) throw new Error(`Could not read this record (${res.status})`);
        const text = await res.text();
        if (live)
          setLines(
            text
              .split('\n')
              .filter((l) => l.trim() !== '')
              .slice(0, MAX_LINES),
          );
      } catch (err) {
        // A read failure is not "this record is empty" — the two used to
        // render the same message, so a transient failure looked identical
        // to a persona that genuinely wrote nothing.
        if (live) setReadError(err instanceof Error ? err.message : 'Could not read this record');
      }
    })();
    return () => {
      live = false;
    };
  }, [open, lines, readError, runId, evidencePath]);

  useEffect(() => {
    if (open) void loadPins();
  }, [open, loadPins]);

  const pinnedLines = new Set(pins.map((p) => p.line).filter((n): n is number => n !== null));

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/40"
      >
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {pins.length > 0 && <span>{pins.length} pinned</span>}
          <Pin className="h-3 w-3" />
          {open ? 'hide' : 'pin a line'}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t p-2">
          {readError !== null ? (
            <p className="text-xs text-destructive">{readError}</p>
          ) : lines === null ? (
            <p className="text-xs text-muted-foreground">Reading the record…</p>
          ) : lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">This record is empty.</p>
          ) : (
            <ol className="max-h-64 overflow-auto rounded bg-muted/30 font-mono text-[11px]">
              {lines.map((line, index) => (
                <li key={index} className="flex gap-2 border-b border-border/40 last:border-0">
                  <button
                    type="button"
                    disabled={!projectId}
                    onClick={() => setDraftLine(index)}
                    className={cn(
                      'w-10 shrink-0 select-none px-1 text-right tabular-nums text-muted-foreground',
                      projectId && 'hover:bg-primary/10 hover:text-primary',
                      pinnedLines.has(index) && 'bg-primary/15 text-primary',
                      draftLine === index && 'bg-amber-500/20 text-amber-700 dark:text-amber-500',
                    )}
                    aria-label={`Pin line ${index + 1}`}
                  >
                    {index + 1}
                  </button>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5 pr-1">
                    {line}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <p className="text-[11px] text-muted-foreground">
            {projectId
              ? 'Click a line number to pin it — the pointing compiles into an instruction for the builder, exactly as a screenshot pin does.'
              : 'This run is not linked to a project, so its evidence cannot be pinned.'}
          </p>

          {pins.length > 0 && (
            <ul className="space-y-0.5 text-[11px]">
              {pins.map((pin) => (
                <li key={pin.id}>
                  <span className="tabular-nums text-muted-foreground">
                    {pin.line === null ? 'whole record' : `line ${pin.line + 1}`}
                  </span>{' '}
                  — {pin.comment}
                </li>
              ))}
            </ul>
          )}

          {draftLine !== null && projectId && (
            <PinComposer
              projectId={projectId}
              runId={runId}
              evidencePath={evidencePath}
              taskId={taskId}
              location={{ kind: 'record', line: draftLine, field: null }}
              onSaved={() => {
                setDraftLine(null);
                void loadPins();
              }}
              onCancel={() => setDraftLine(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
