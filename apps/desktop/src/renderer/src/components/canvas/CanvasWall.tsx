import { buildSrcdoc } from '@ligma/runtime';
import { Download, ExternalLink } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useCodesignStore } from '../../store';

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
  onOpen: (path: string) => void;
  onToggleSelect: (path: string, additive: boolean) => void;
}

function WallCard({
  designId: _designId,
  path,
  html,
  selected,
  onOpen,
  onToggleSelect,
}: WallCardProps): ReactElement {
  const srcDoc = useMemo(() => injectThumbnailStyle(buildSrcdoc(html)), [html]);
  const scale = CARD_WIDTH / NATURAL_WIDTH;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          onToggleSelect(path, true);
        } else {
          onOpen(path);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(path);
      }}
      className={`group relative flex flex-col overflow-hidden cursor-pointer transition-shadow ${
        selected ? 'ring-2 ring-[var(--color-accent)]' : 'hover:shadow-[var(--shadow-tape)]'
      }`}
      style={{
        width: CARD_WIDTH,
        background: 'var(--color-paper-card)',
        border: '1px solid var(--color-border-muted)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div
        className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--color-border-muted)]"
        style={{ background: 'var(--color-surface)' }}
      >
        <span
          className="truncate text-[12px] text-[var(--color-text-secondary)]"
          style={{ fontFamily: 'var(--font-mono)' }}
          title={path}
        >
          {path}
        </span>
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

  return (
    <div
      className="min-h-full"
      style={{
        padding: 32,
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, ${CARD_WIDTH}px)`,
        gap: 32,
        justifyContent: 'start',
        alignContent: 'start',
        background: 'var(--color-background)',
      }}
    >
      {paths.map((path) => {
        const key = `${currentDesignId}::${path}`;
        const html = previewHtmlByFile[key];
        if (!html) return null;
        const selected = wallSelectedPaths.includes(path);
        return (
          <WallCard
            key={path}
            designId={currentDesignId}
            path={path}
            html={html}
            selected={selected}
            onOpen={(p) => {
              openCanvasFileTab(p);
              setCurrentFilePath(currentDesignId, p);
            }}
            onToggleSelect={(p, _additive) => toggleWallSelection(p)}
          />
        );
      })}
    </div>
  );
}
