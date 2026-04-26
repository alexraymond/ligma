import { buildSrcdoc } from '@ligma/runtime';
import { Download, ExternalLink, GripVertical, MessageSquare, Package } from 'lucide-react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCodesignStore } from '../../store';

// How far the pointer must move before a click-drag is treated as a pan
// (and the card click is suppressed). Matches Figma's threshold so the
// gesture feels familiar — anything below this stays a click.
const DRAG_THRESHOLD_PX = 5;

const CARD_WIDTH = 360;
const CARD_HEIGHT = 240;
const NATURAL_WIDTH = 1440;
const NATURAL_HEIGHT = 960;

const THUMBNAIL_STYLE = `<style>
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
  scrollbar-width: none !important;
}
*::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
html, body { overflow: hidden !important; margin: 0 !important; }
video, audio { display: none !important; }
</style>`;

function injectThumbnailStyle(srcDoc: string): string {
  if (/<\/head>/i.test(srcDoc)) {
    return srcDoc.replace(/<\/head>/i, `${THUMBNAIL_STYLE}</head>`);
  }
  return THUMBNAIL_STYLE + srcDoc;
}

/**
 * Pull the model-supplied screen title from a generated artifact. Two
 * conventions, in priority order:
 *  - `data-screen-title="..."` on any element (the JSX path — agent puts
 *    it on App's root div).
 *  - `<meta name="ligma:screen-title" content="...">` (full-HTML files,
 *    DESIGN_CANVAS multi-artboard outputs).
 * Returns null when neither is present so callers can fall back to the
 * filename. Parsing the source string (not a live DOM) keeps this fast
 * and lets us run before the card iframe has even mounted.
 */
export function extractScreenTitle(source: string): string | null {
  const dataAttr = source.match(/data-screen-title=["']([^"']{1,80})["']/i);
  if (dataAttr?.[1]) return dataAttr[1].trim();
  const meta = source.match(
    /<meta[^>]*name=["']ligma:screen-title["'][^>]*content=["']([^"']{1,80})["']/i,
  );
  if (meta?.[1]) return meta[1].trim();
  return null;
}

function downloadHtml(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface WallCardProps {
  designId: string;
  path: string;
  html: string;
  selected: boolean;
  /** True when this file is the one currently active in focus mode. Adds
   *  a subtle "focused" outline so the user can remember which screen they
   *  were working on when they switch back from focus → wall. Distinct
   *  from `selected` (which is the multi-select-for-context state). */
  focused: boolean;
  /** True when the in-flight agent run most-recently wrote to this file.
   *  Drives a subtle pulsing "writing…" badge so the user can watch
   *  generation progress card by card. */
  writing: boolean;
  /** Number of comments anchored to any snapshot of this file. Rendered
   *  as a small badge in the header strip when > 0 — closes the loop
   *  between wall + comment-pin features without needing a focus-mode
   *  detour to see "are there outstanding comments here?". */
  commentCount: number;
  /** True while another card is being dragged toward this card's slot.
   *  Renders an insertion line on the left edge so the drop target is
   *  visually obvious before release. */
  dropTarget: boolean;
  /** True for the card currently being dragged — fades its visual
   *  presence so the user can see the underlying grid shifting around. */
  dragging: boolean;
  onOpen: (path: string) => void;
  onToggleSelect: (path: string, additive: boolean) => void;
  /** Pointerdown on the drag handle starts the reorder gesture. */
  onReorderStart: (path: string, e: ReactPointerEvent<HTMLElement>) => void;
}

function WallCard({
  designId: _designId,
  path,
  html,
  selected,
  focused,
  writing,
  commentCount,
  dropTarget,
  dragging,
  onOpen,
  onToggleSelect,
  onReorderStart,
}: WallCardProps): ReactElement {
  const srcDoc = useMemo(() => injectThumbnailStyle(buildSrcdoc(html)), [html]);
  const screenTitle = useMemo(() => extractScreenTitle(html), [html]);
  const scale = CARD_WIDTH / NATURAL_WIDTH;

  // Click-vs-drag disambiguation. A pointerdown opens a "candidate" gesture;
  // if the pointer moves > DRAG_THRESHOLD_PX before pointerup it becomes a
  // pan (forwards deltas to [data-canvas-viewport]'s scroll position). If
  // it doesn't, the pointerup fires onOpen / onToggleSelect like a normal
  // click. This matches Figma — the canvas is always pannable, even from
  // inside a card, without forcing the user to learn Space+drag first.
  const dragRef = useRef<{
    startX: number;
    startY: number;
    viewportEl: HTMLElement;
    scrollLeft: number;
    scrollTop: number;
    additive: boolean;
    isDrag: boolean;
  } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // Don't intercept pointers that originated on the card's hover-revealed
    // buttons (Download, Open) — they need their own click flow, and
    // setPointerCapture below would otherwise route pointermove/up away
    // from them and break their onClick handlers.
    if ((e.target as Element).closest('button') !== null) return;
    const viewportEl = (e.currentTarget as HTMLElement).closest(
      '[data-canvas-viewport]',
    ) as HTMLElement | null;
    if (!viewportEl) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      viewportEl,
      scrollLeft: viewportEl.scrollLeft,
      scrollTop: viewportEl.scrollTop,
      additive: e.metaKey || e.ctrlKey || e.shiftKey,
      isDrag: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const state = dragRef.current;
    if (!state) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.isDrag && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      state.isDrag = true;
      document.body.classList.add('ligma-panning');
    }
    if (state.isDrag) {
      state.viewportEl.scrollLeft = state.scrollLeft - dx;
      state.viewportEl.scrollTop = state.scrollTop - dy;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released by browser */
    }
    document.body.classList.remove('ligma-panning');
    if (state.isDrag) {
      // Suppress the synthetic click — the gesture was a pan, not a click.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Genuine click — route to focus or multi-select.
    if (state.additive) onToggleSelect(path, true);
    else onOpen(path);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(path);
      }}
      className={`group relative flex flex-col overflow-hidden transition-shadow ${
        selected
          ? 'ring-2 ring-[var(--color-accent)]'
          : focused
            ? 'ring-1 ring-[var(--color-text-secondary)]'
            : 'hover:shadow-[var(--shadow-tape)]'
      }`}
      style={{
        width: CARD_WIDTH,
        background: 'var(--color-paper-card)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-lg)',
        // `grab` cursor signals the canvas-pan affordance even before the
        // user moves; `ligma-panning` (toggled above on real drag) flips it
        // to `grabbing` via the global stylesheet for kinetic feedback.
        cursor: 'grab',
        opacity: dragging ? 0.4 : 1,
        transition: 'opacity 120ms',
      }}
      data-wall-card-path={path}
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
            background: 'var(--color-accent)',
            boxShadow: '0 0 8px color-mix(in srgb, var(--color-accent) 50%, transparent)',
          }}
        />
      ) : null}
      <div
        className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--color-border-muted)]"
        style={{ background: 'var(--color-surface)' }}
      >
        <button
          type="button"
          onPointerDown={(e) => {
            // Stops the body's pan-vs-click handler from firing — reorder
            // owns this gesture from pointerdown through pointerup.
            e.stopPropagation();
            onReorderStart(path, e);
          }}
          aria-label={`Drag to reorder ${path}`}
          title="Drag to reorder"
          className="shrink-0 p-[2px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ cursor: 'grab', touchAction: 'none' }}
        >
          <GripVertical className="w-3.5 h-3.5" aria-hidden />
        </button>
        <div className="flex items-baseline gap-[8px] min-w-0 flex-1 ml-[2px]">
          {screenTitle ? (
            <>
              <span
                className="truncate text-[13px] text-[var(--color-text-primary)]"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                title={screenTitle}
              >
                {screenTitle}
              </span>
              <span
                className="truncate text-[10px] text-[var(--color-text-muted)] shrink-0"
                style={{ fontFamily: 'var(--font-mono)' }}
                title={path}
              >
                {path}
              </span>
            </>
          ) : (
            <span
              className="truncate text-[12px] text-[var(--color-text-secondary)]"
              style={{ fontFamily: 'var(--font-mono)' }}
              title={path}
            >
              {path}
            </span>
          )}
        </div>
        {commentCount > 0 ? (
          <span
            aria-label={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
            className="inline-flex items-center gap-[3px] rounded-full px-[6px] py-[1px] text-[10px] shrink-0"
            style={{
              background: 'var(--color-surface-elevated)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-muted)',
              fontFamily: 'var(--font-mono)',
            }}
            title={`${commentCount} comment${commentCount === 1 ? '' : 's'} on this file`}
          >
            <MessageSquare className="w-2.5 h-2.5" aria-hidden />
            {commentCount}
          </span>
        ) : null}
        <div className="flex items-center gap-[var(--space-1)] opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadHtml(path, html);
            }}
            title="Download HTML"
            aria-label={`Download ${path}`}
            className="p-[4px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <Download className="w-3.5 h-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(path);
            }}
            title="Open in focus mode"
            aria-label={`Open ${path}`}
            className="p-[4px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div
        className="relative overflow-hidden"
        style={{ width: CARD_WIDTH, height: CARD_HEIGHT, background: '#fff' }}
      >
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
            className="block bg-white border-0"
            style={{ width: NATURAL_WIDTH, height: NATURAL_HEIGHT }}
          />
        </div>
        {selected ? (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }}
          />
        ) : null}
        {writing ? (
          <div
            aria-label={`writing ${path}`}
            className="absolute top-[8px] right-[8px] inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] text-[10px] pointer-events-none"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
              fontFamily: 'var(--font-mono)',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <span
              aria-hidden
              className="inline-block w-[6px] h-[6px] rounded-full animate-pulse"
              style={{ background: 'var(--color-on-accent)' }}
            />
            writing…
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Stitch-style wall view — every HTML file in the project rendered as a card
 * on a single panable canvas. Wraps the existing CanvasViewport for
 * pan/zoom; cards lay out in a flowing grid that overflows when there are
 * more than fit horizontally.
 *
 * Click → focus mode (switch to that file's tab). Cmd/Ctrl/Shift-click →
 * toggle multi-select for next-prompt context.
 */
export function CanvasWall(): ReactElement {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const fileListByDesign = useCodesignStore((s) => s.fileListByDesign);
  const previewHtmlByFile = useCodesignStore((s) => s.previewHtmlByFile);
  const hydrateFilesForDesign = useCodesignStore((s) => s.hydrateFilesForDesign);
  const openCanvasFileTab = useCodesignStore((s) => s.openCanvasFileTab);
  const setCurrentFilePath = useCodesignStore((s) => s.setCurrentFilePath);
  const wallSelectedPaths = useCodesignStore((s) => s.wallSelectedPaths);
  const toggleWallSelection = useCodesignStore((s) => s.toggleWallSelection);
  const reorderWallCards = useCodesignStore((s) => s.reorderWallCards);
  const agentWritingFile = useCodesignStore((s) => s.agentWritingFile);
  const comments = useCodesignStore((s) => s.comments);
  const snapshotsByDesign = useCodesignStore((s) => s.snapshotsByDesign);
  const currentFilePathByDesign = useCodesignStore((s) => s.currentFilePathByDesign);

  // Drag-to-reorder state. Keep cursor + dragged path in React state so the
  // floating ghost re-renders on pointermove; the drop-target path is just
  // derived during the move handler so a single state update covers both.
  const [reorder, setReorder] = useState<{
    draggingPath: string;
    dropTargetPath: string | null;
    cursorX: number;
    cursorY: number;
  } | null>(null);
  const reorderRef = useRef<{ pointerId: number; designId: string } | null>(null);

  const onReorderStart = useCallback(
    (path: string, e: ReactPointerEvent<HTMLElement>) => {
      if (!currentDesignId) return;
      reorderRef.current = { pointerId: e.pointerId, designId: currentDesignId };
      e.currentTarget.setPointerCapture(e.pointerId);
      setReorder({
        draggingPath: path,
        dropTargetPath: null,
        cursorX: e.clientX,
        cursorY: e.clientY,
      });
      document.body.classList.add('ligma-panning');
    },
    [currentDesignId],
  );

  // Bind global pointermove / pointerup so the gesture survives even when
  // the cursor leaves the drag-handle button. The handle's setPointerCapture
  // would route events back to the button — but the user's intent is to
  // hover OTHER cards, so we listen on document instead and hit-test by
  // querying [data-wall-card-path] under the cursor.
  useEffect(() => {
    if (!reorder) return;
    const onMove = (e: PointerEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el?.closest('[data-wall-card-path]') as HTMLElement | null;
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
    const onUp = (_e: PointerEvent): void => {
      const ctx = reorderRef.current;
      const current = reorder;
      reorderRef.current = null;
      document.body.classList.remove('ligma-panning');
      setReorder(null);
      if (ctx && current?.dropTargetPath) {
        reorderWallCards(ctx.designId, current.draggingPath, current.dropTargetPath);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [reorder, reorderWallCards]);

  // Cold-load files when entering the wall. Idempotent; safe to call on
  // every mount because the action overwrites with fresh disk state.
  const lastHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentDesignId) return;
    if (lastHydratedRef.current === currentDesignId) return;
    lastHydratedRef.current = currentDesignId;
    void hydrateFilesForDesign(currentDesignId);
  }, [currentDesignId, hydrateFilesForDesign]);

  const paths = currentDesignId ? (fileListByDesign[currentDesignId] ?? []) : [];

  // Bucket comments by file path for the badge counts. Comments target a
  // snapshotId; snapshotsByDesign provides snapshotId → filePath. Build the
  // map once per render — cheap (O(snapshots + comments)) and avoids passing
  // the indexes deeper than necessary.
  const commentsByFile = useMemo(() => {
    if (!currentDesignId) return new Map<string, number>();
    const snapshots = snapshotsByDesign[currentDesignId] ?? [];
    const filePathBySnapshotId = new Map(snapshots.map((s) => [s.id, s.filePath]));
    const counts = new Map<string, number>();
    for (const c of comments) {
      const filePath = c.snapshotId ? filePathBySnapshotId.get(c.snapshotId) : undefined;
      if (filePath === undefined) continue;
      counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
    }
    return counts;
  }, [comments, currentDesignId, snapshotsByDesign]);

  if (!currentDesignId) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
        No design selected.
      </div>
    );
  }

  if (paths.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-[var(--space-3)] text-[var(--color-text-muted)]">
        <p>No files yet — start a generation to populate the wall.</p>
      </div>
    );
  }

  const downloadableEntries = paths
    .map((p) => ({ path: p, content: previewHtmlByFile[`${currentDesignId}::${p}`] ?? '' }))
    .filter((e) => e.content.length > 0);

  const onDownloadAll = async (): Promise<void> => {
    if (downloadableEntries.length === 0) return;
    const api = window.codesign?.exportMultiFileBundle;
    if (!api) return;
    try {
      await api({ entries: downloadableEntries, defaultFilename: 'project.zip' });
    } catch (err) {
      console.error('[wall] download-all failed', err);
    }
  };

  return (
    <div
      className="min-h-full"
      style={{
        padding: '20px 32px 32px',
        background: 'var(--color-background)',
      }}
    >
      {downloadableEntries.length >= 2 ? (
        <div
          className="flex items-center justify-end mb-[12px]"
          // Wrapper sits in the natural flow above the grid — it scrolls with
          // content rather than sticking, which keeps the wall mental model
          // simple (everything in one panable surface) and avoids fighting
          // CanvasViewport's overflow-auto for sticky positioning.
        >
          <button
            type="button"
            onClick={onDownloadAll}
            aria-label="Download all designs as a ZIP bundle"
            title={`Download all ${downloadableEntries.length} designs as a ZIP`}
            className="inline-flex items-center gap-[6px] rounded-full px-[12px] py-[5px] text-[12px] transition-shadow hover:shadow-[var(--shadow-soft)]"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <Package className="w-3.5 h-3.5" aria-hidden />
            Download all ({downloadableEntries.length})
          </button>
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
        {paths.map((path) => {
          const key = `${currentDesignId}::${path}`;
          const html = previewHtmlByFile[key];
          if (!html) return null;
          const selected = wallSelectedPaths.includes(path);
          const writing =
            agentWritingFile?.designId === currentDesignId && agentWritingFile.path === path;
          const commentCount = commentsByFile.get(path) ?? 0;
          const focused = currentFilePathByDesign[currentDesignId] === path;
          const dragging = reorder?.draggingPath === path;
          const dropTarget = reorder?.dropTargetPath === path;
          return (
            <WallCard
              key={path}
              designId={currentDesignId}
              path={path}
              html={html}
              selected={selected}
              focused={focused}
              writing={writing}
              commentCount={commentCount}
              dragging={dragging}
              dropTarget={dropTarget}
              onOpen={(p) => {
                openCanvasFileTab(p);
                setCurrentFilePath(currentDesignId, p);
              }}
              onToggleSelect={(p, _additive) => toggleWallSelection(p)}
              onReorderStart={onReorderStart}
            />
          );
        })}
      </div>
      {reorder ? (
        <div
          aria-hidden
          className="fixed pointer-events-none z-50 rounded-[var(--radius-lg)]"
          style={{
            left: reorder.cursorX - 60,
            top: reorder.cursorY - 16,
            width: 120,
            height: 32,
            background: 'var(--color-accent)',
            color: 'var(--color-on-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            boxShadow: 'var(--shadow-soft)',
            opacity: 0.9,
          }}
        >
          {reorder.draggingPath}
        </div>
      ) : null}
    </div>
  );
}
