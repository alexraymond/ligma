'use client';

/**
 * The Wall — every screen in the design as a card on one pannable canvas.
 *
 * Ported from ligma-classic's `CanvasWall.tsx` (studio map §2). Everything that
 * made it feel alive comes across unchanged in behaviour:
 *  - the click-vs-drag gesture machine (`./gesture`, ported with its tests),
 *  - the per-card "writing…" pulse driven by file progress,
 *  - comment badges per file,
 *  - drag-reorder by grip handle with `elementFromPoint` hit-testing,
 *  - Cmd/Ctrl/Shift-click multi-select to scope the next prompt,
 *  - the fixed 1440×960 → 360×240 thumbnail scale with animations killed.
 *
 * Rewired, not rebuilt: comment counts come from `DesignPin.filePath` (the
 * daemon anchors a pin to a file directly) instead of ligma-classic's
 * comment → snapshot → filePath join, and reorder is local state rather than a
 * store action, because the manifest lists files without ranking them.
 *
 * Connection state (mechanics F9 — "the Wall's SSE stream could die with no
 * visible sign"): `useDesign` now tracks it and hands it down as `connection`.
 * Silence used to look identical to "nothing is happening"; a stalled stream
 * mid-turn left a card's "writing…" pulse frozen with no explanation. The
 * banner below is the explanation — same `WaitingStatus` vocabulary as the
 * Terminal (M8), not a bespoke Wall-only spinner.
 */

import { type WaitingState, WaitingStatus } from '@/components/waiting-status';
import type { DesignPin } from '@ligma/api';
import { ExternalLink, GripVertical, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  type GestureState,
  extractScreenTitle,
  processGestureMove,
  processGestureUp,
  reorderPaths,
  startGesture,
} from './gesture';
import { buildThumbnailSrcdoc } from './srcdoc';
import type { DesignConnectionState } from './use-design';

const CARD_WIDTH = 360;
const CARD_HEIGHT = 240;
const NATURAL_WIDTH = 1440;
const NATURAL_HEIGHT = 960;

interface WallCardProps {
  path: string;
  body: string | undefined;
  selected: boolean;
  focused: boolean;
  writing: boolean;
  commentCount: number;
  dropTarget: boolean;
  dragging: boolean;
  onOpen: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onReorderStart: (path: string, e: ReactPointerEvent<HTMLElement>) => void;
}

function WallCard({
  path,
  body,
  selected,
  focused,
  writing,
  commentCount,
  dropTarget,
  dragging,
  onOpen,
  onToggleSelect,
  onReorderStart,
}: WallCardProps) {
  const srcDoc = useMemo(() => (body ? buildThumbnailSrcdoc(body) : null), [body]);
  const screenTitle = useMemo(() => (body ? extractScreenTitle(body) : null), [body]);
  const scale = CARD_WIDTH / NATURAL_WIDTH;

  const dragRef = useRef<{ state: GestureState; viewportEl: HTMLElement } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // Hover-revealed buttons own their own click flow; setPointerCapture below
    // would route their pointerup away and break them.
    if ((e.target as Element).closest('button') !== null) return;
    const viewportEl = (e.currentTarget as HTMLElement).closest(
      '[data-canvas-viewport]',
    ) as HTMLElement | null;
    if (!viewportEl) return;
    dragRef.current = {
      state: startGesture({
        clientX: e.clientX,
        clientY: e.clientY,
        scrollLeft: viewportEl.scrollLeft,
        scrollTop: viewportEl.scrollTop,
        additive: e.metaKey || e.ctrlKey || e.shiftKey,
      }),
      viewportEl,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const slot = dragRef.current;
    if (!slot) return;
    const result = processGestureMove(slot.state, e.clientX, e.clientY);
    slot.state = result.state;
    if (result.justBecameDrag) slot.viewportEl.classList.add('ligma-panning');
    if (result.scroll) {
      slot.viewportEl.scrollLeft = result.scroll.scrollLeft;
      slot.viewportEl.scrollTop = result.scroll.scrollTop;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const slot = dragRef.current;
    if (!slot) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released by the browser */
    }
    slot.viewportEl.classList.remove('ligma-panning');
    const effect = processGestureUp(slot.state);
    if (effect.kind === 'pan') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (effect.additive) onToggleSelect(path);
    else onOpen(path);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Design card ${path}`}
      aria-pressed={selected}
      data-wall-card-path={path}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(path);
      }}
      className="group relative flex flex-col overflow-hidden rounded-lg transition-shadow"
      style={{
        width: CARD_WIDTH,
        background: 'var(--paper-card)',
        border: `1px solid ${selected ? 'var(--paper-accent)' : 'var(--paper-line)'}`,
        outline: selected
          ? '2px solid var(--paper-accent)'
          : focused
            ? '1px solid var(--paper-ink-muted)'
            : 'none',
        outlineOffset: 1,
        boxShadow: 'var(--paper-shadow)',
        cursor: 'grab',
        opacity: dragging ? 0.4 : 1,
        transition: 'opacity 120ms',
      }}
    >
      {dropTarget ? (
        <div
          aria-hidden
          className="absolute"
          style={{
            left: -16,
            top: 0,
            bottom: 0,
            width: 3,
            borderRadius: 2,
            background: 'var(--paper-accent)',
          }}
        />
      ) : null}

      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--paper-line)' }}
      >
        <button
          type="button"
          onPointerDown={(e) => {
            // Reorder owns this gesture from pointerdown through pointerup.
            e.stopPropagation();
            onReorderStart(path, e);
          }}
          aria-label={`Drag to reorder ${path}`}
          title="Drag to reorder"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ cursor: 'grab', touchAction: 'none', color: 'var(--paper-ink-muted)' }}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[13px] font-medium" title={screenTitle ?? path}>
            {screenTitle ?? path}
          </span>
          {screenTitle ? (
            <span
              className="shrink-0 truncate font-mono text-[10px]"
              style={{ color: 'var(--paper-ink-muted)' }}
              title={path}
            >
              {path}
            </span>
          ) : null}
        </div>

        {commentCount > 0 ? (
          <span
            aria-label={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px font-mono text-[10px]"
            style={{ border: '1px solid var(--paper-line)', color: 'var(--paper-ink-muted)' }}
          >
            <MessageSquare className="h-2.5 w-2.5" aria-hidden />
            {commentCount}
          </span>
        ) : null}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(path);
          }}
          title="Open in focus mode"
          aria-label={`Open ${path}`}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: 'var(--paper-ink-muted)' }}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div
        className="relative overflow-hidden bg-white"
        style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      >
        {srcDoc ? (
          <div
            className="origin-top-left"
            style={{
              transform: `scale(${scale})`,
              width: NATURAL_WIDTH,
              height: NATURAL_HEIGHT,
              pointerEvents: 'none',
            }}
          >
            <iframe
              title={`wall-card-${path}`}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              className="block border-0 bg-white"
              style={{ width: NATURAL_WIDTH, height: NATURAL_HEIGHT }}
            />
          </div>
        ) : (
          <div
            className="flex h-full items-center justify-center px-4 text-center font-mono text-[11px]"
            style={{ color: 'var(--paper-ink-muted)' }}
          >
            preview unavailable — no source route
          </div>
        )}
        {writing ? (
          <div
            aria-label={`writing ${path}`}
            className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px]"
            style={{ background: 'var(--paper-accent)', color: 'var(--paper-on-accent)' }}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: 'var(--paper-on-accent)' }}
            />
            writing…
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Maps `useDesign`'s connection state to the shared waiting vocabulary — pulled
 * out so the mapping (never-opened stays `connecting`, a stream that died
 * after being live reads `stalled`) is testable without mounting the Wall.
 */
export function connectionWaitingState(
  connection: DesignConnectionState,
  onReconnect?: () => void,
): WaitingState {
  return connection.kind === 'connecting'
    ? { kind: 'connecting', since: connection.since, onRetry: onReconnect }
    : { kind: 'stalled', since: connection.since };
}

/**
 * The Wall's one honest thing to say when its live feed isn't live (F9): a
 * `WaitingStatus` badge plus a short explanation, so a frozen "writing…" card
 * reads as "the stream dropped" instead of "nothing is happening" or a bug.
 */
function ConnectionBanner({
  connection,
  now,
  onReconnect,
}: {
  connection: DesignConnectionState;
  now: number;
  onReconnect?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <WaitingStatus state={connectionWaitingState(connection, onReconnect)} now={now} />
      <span className="font-mono text-[11px]" style={{ color: 'var(--paper-ink-muted)' }}>
        Live updates paused — reconnecting automatically.
      </span>
    </div>
  );
}

export interface WallProps {
  paths: string[];
  bodies: Record<string, string>;
  pins: DesignPin[];
  selectedPaths: string[];
  focusedPath: string | null;
  writingPath: string | null;
  /** Non-null while the design stream is (re)connecting or has gone silent (F9). */
  connection?: DesignConnectionState | null;
  /** Manual "try now" for a `connecting` badge past its timeout — the automatic backoff keeps retrying regardless. */
  onReconnect?: () => void;
  onOpen: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onReorder: (paths: string[]) => void;
}

export function Wall({
  paths,
  bodies,
  pins,
  selectedPaths,
  focusedPath,
  writingPath,
  connection = null,
  onReconnect,
  onOpen,
  onToggleSelect,
  onReorder,
}: WallProps) {
  const [reorder, setReorder] = useState<{
    draggingPath: string;
    dropTargetPath: string | null;
    cursorX: number;
    cursorY: number;
  } | null>(null);

  // Ticks while disconnected so the badge's elapsed text and its connecting→
  // retry escalation actually repaint, instead of freezing at whatever it said
  // the instant the connection dropped.
  const disconnected = connection !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!disconnected) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [disconnected]);

  const commentsByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pin of pins) counts.set(pin.filePath, (counts.get(pin.filePath) ?? 0) + 1);
    return counts;
  }, [pins]);

  const onReorderStart = useCallback((path: string, e: ReactPointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setReorder({
      draggingPath: path,
      dropTargetPath: null,
      cursorX: e.clientX,
      cursorY: e.clientY,
    });
  }, []);

  // Document-level listeners, not the handle's own: setPointerCapture would
  // route moves back to the button, but the user's intent is to hover OTHER
  // cards. Hit-test with elementFromPoint instead. Ported.
  useEffect(() => {
    if (!reorder) return;
    const onMove = (e: PointerEvent): void => {
      const card = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-wall-card-path]');
      const target = card?.getAttribute('data-wall-card-path') ?? null;
      setReorder((prev) =>
        prev
          ? {
              ...prev,
              cursorX: e.clientX,
              cursorY: e.clientY,
              dropTargetPath: target && target !== prev.draggingPath ? target : null,
            }
          : prev,
      );
    };
    const onUp = (): void => {
      const current = reorder;
      setReorder(null);
      if (current?.dropTargetPath)
        onReorder(reorderPaths(paths, current.draggingPath, current.dropTargetPath));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [reorder, paths, onReorder]);

  if (paths.length === 0) {
    return (
      <div
        className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 p-8 text-sm"
        style={{ color: 'var(--paper-ink-muted)' }}
      >
        {connection ? (
          <ConnectionBanner connection={connection} now={now} onReconnect={onReconnect} />
        ) : null}
        No screens yet — describe what you want below and watch it appear.
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ padding: '20px 32px 32px' }}>
      {connection ? (
        <div className="mb-4">
          <ConnectionBanner connection={connection} now={now} onReconnect={onReconnect} />
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, ${CARD_WIDTH}px)`,
          gap: 32,
          justifyContent: 'start',
          alignContent: 'start',
        }}
      >
        {paths.map((path) => (
          <WallCard
            key={path}
            path={path}
            body={bodies[path]}
            selected={selectedPaths.includes(path)}
            focused={focusedPath === path}
            writing={writingPath === path}
            commentCount={commentsByFile.get(path) ?? 0}
            dragging={reorder?.draggingPath === path}
            dropTarget={reorder?.dropTargetPath === path}
            onOpen={onOpen}
            onToggleSelect={onToggleSelect}
            onReorderStart={onReorderStart}
          />
        ))}
      </div>
      {reorder ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 flex items-center justify-center rounded-lg font-mono text-[11px]"
          style={{
            left: reorder.cursorX - 60,
            top: reorder.cursorY - 16,
            width: 120,
            height: 32,
            background: 'var(--paper-accent)',
            color: 'var(--paper-on-accent)',
            opacity: 0.9,
          }}
        >
          {reorder.draggingPath}
        </div>
      ) : null}
    </div>
  );
}
