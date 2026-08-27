'use client';

import { PinComposer } from '@/components/pin-composer';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { EvidencePin, ImageEvidencePin } from '@ligma/api';
import { useCallback, useEffect, useState } from 'react';

/**
 * Click-to-pin comments on a verdict's evidence screenshot (UX spec F6) — the
 * human points at the defect in the evidence, and **the pointing becomes the
 * instruction**.
 *
 * ponytail: this is a positioned-pin layer over the `<img>`, not a reuse of
 * `@ligma/runtime`'s overlay. That overlay is a postMessage protocol for a live
 * DOM inside a sandboxed iframe — it computes XPath selectors and re-measures
 * element rects on scroll. An evidence screenshot is a PNG: there are no
 * elements to select and no rects to track, so the overlay's entire value
 * proposition is absent and using it would mean wrapping an image in an iframe
 * to get a click handler. Coordinates are normalized 0..1, which is the one
 * thing that actually matters here — a pin lands in the same place whatever
 * width the image renders at. If evidence ever becomes a live DOM snapshot, the
 * overlay is the right upgrade and this component is the thing to replace.
 *
 * The *record* half of F6 — a headless run's transcripts and bridge records,
 * which have no picture to point at — is `RecordPinner`. Both share
 * `PinComposer`, so the compiled instruction has one implementation.
 */
export function EvidencePinner({
  projectId,
  runId,
  evidencePath,
  src,
  alt,
  /** The task a `feedback` pin attaches to. Null on a journey run — no task to fix. */
  taskId,
}: {
  projectId: string | null;
  runId: string;
  evidencePath: string;
  src: string;
  alt: string;
  taskId: string | null;
}) {
  const [pins, setPins] = useState<ImageEvidencePin[]>([]);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/evidence-pins?runId=${encodeURIComponent(runId)}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as { pins: EvidencePin[] };
      setPins(
        json.pins.filter(
          (p): p is ImageEvidencePin => p.kind === 'image' && p.evidencePath === evidencePath,
        ),
      );
    } catch {
      // Pins are an enrichment; a fetch failure must not hide the evidence.
    }
  }, [projectId, runId, evidencePath]);

  useEffect(() => {
    void load();
  }, [load]);

  function place(event: React.MouseEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setDraft({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={projectId ? place : undefined}
          className={cn('w-full h-auto rounded-md', projectId && 'cursor-crosshair')}
        />
        {pins.map((pin, index) => (
          <Marker
            key={pin.id}
            x={pin.x}
            y={pin.y}
            label={String(index + 1)}
            title={pin.comment}
            tone="saved"
          />
        ))}
        {draft && <Marker x={draft.x} y={draft.y} label="+" title="New pin" tone="draft" />}
      </div>

      <p className="text-xs text-muted-foreground">
        {projectId
          ? 'Click the screenshot to pin a comment — it compiles into an instruction for the builder.'
          : 'This run is not linked to a project, so its evidence cannot be pinned.'}
      </p>

      {pins.length > 0 && (
        <ol className="space-y-1 text-xs">
          {pins.map((pin, index) => (
            <li key={pin.id} className="flex gap-2">
              <span className="font-medium tabular-nums">{index + 1}.</span>
              <span>
                {pin.comment}{' '}
                <span className="text-muted-foreground">
                  ({pin.disposition === 'feedback' ? 'feedback on the fix task' : 'new task'})
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {draft && projectId && (
        <PinComposer
          projectId={projectId}
          runId={runId}
          evidencePath={evidencePath}
          taskId={taskId}
          location={{ kind: 'image', x: draft.x, y: draft.y }}
          onSaved={() => {
            setDraft(null);
            void load();
          }}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}

function Marker({
  x,
  y,
  label,
  title,
  tone,
}: {
  x: number;
  y: number;
  label: string;
  title: string;
  tone: 'saved' | 'draft';
}) {
  return (
    <span
      title={title}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white shadow',
        tone === 'saved' ? 'bg-primary' : 'bg-amber-500 animate-pulse',
      )}
    >
      {label}
    </span>
  );
}
