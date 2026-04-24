import { useT } from '@ligma/i18n';
import { Code2, Download, Maximize2, MessageSquare, Move, RotateCcw } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import type { ExportFormat } from '../../../preload/index';
import type { PreviewViewport } from '../store';
import { useCodesignStore } from '../store';

interface ExportItem {
  format: ExportFormat;
  label: string;
  hint?: string;
  ready: boolean;
}

const ZOOM_OPTIONS = [50, 75, 90, 100, 110, 125, 150, 175, 200] as const;

export function PreviewToolbar(): ReactElement {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const exportActive = useCodesignStore((s) => s.exportActive);
  const toastMessage = useCodesignStore((s) => s.toastMessage);
  const dismissToast = useCodesignStore((s) => s.dismissToast);
  const previewViewport = useCodesignStore((s) => s.previewViewport);
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const setPreviewZoom = useCodesignStore((s) => s.setPreviewZoom);
  const resetPreviewView = useCodesignStore((s) => s.resetPreviewView);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const setInteractionMode = useCodesignStore((s) => s.setInteractionMode);
  const fitPreviewToViewport = useCodesignStore((s) => s.fitPreviewToViewport);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const canvasSizeByDesign = useCodesignStore((s) => s.canvasSizeByDesign);
  const [open, setOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!zoomOpen) return;
    function onClick(e: MouseEvent): void {
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) setZoomOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [zoomOpen]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => dismissToast(), 4000);
    return () => clearTimeout(timeout);
  }, [toastMessage, dismissToast]);

  const artboardOffsetsByDesign = useCodesignStore((s) => s.artboardOffsetsByDesign);
  const resetArtboardOffsets = useCodesignStore((s) => s.resetArtboardOffsets);

  const disabled = !previewHtml;
  const commentActive = interactionMode === 'comment';
  const artboardSelectActive = interactionMode === 'artboard-select';
  const artboardMoveActive = interactionMode === 'artboard-move';
  const knownCanvasSize = currentDesignId ? canvasSizeByDesign[currentDesignId] : undefined;
  const fitDisabled = disabled || !knownCanvasSize;
  const hasArtboardOffsets =
    currentDesignId !== null &&
    Object.keys(artboardOffsetsByDesign[currentDesignId] ?? {}).length > 0;

  const handleFit = () => {
    const el = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
    if (!el) return;
    fitPreviewToViewport(el.clientWidth, el.clientHeight);
  };
  const exportItems: ExportItem[] = [
    {
      format: 'html',
      label: t('export.items.html.label'),
      ready: true,
      hint: t('export.items.html.hint'),
    },
    {
      format: 'pdf',
      label: t('export.items.pdf.label'),
      ready: true,
      hint: t('export.items.pdf.hint'),
    },
    {
      format: 'pptx',
      label: t('export.items.pptx.label'),
      ready: true,
      hint: t('export.items.pptx.hint'),
    },
    {
      format: 'zip',
      label: t('export.items.zip.label'),
      ready: true,
      hint: t('export.items.zip.hint'),
    },
    {
      format: 'markdown',
      label: t('export.items.markdown.label'),
      ready: true,
      hint: t('export.items.markdown.hint'),
    },
  ];

  return (
    <div className="ml-auto flex items-center justify-end gap-[var(--space-1)] pr-[var(--space-4)] py-[3px]">
      {toastMessage && (
        <output className="mr-auto text-[var(--text-xs)] text-[var(--color-text-secondary)] truncate max-w-[60%]">
          {toastMessage}
        </output>
      )}

      <button
        type="button"
        disabled={disabled}
        aria-pressed={artboardMoveActive}
        title="Drag artboards to rearrange them on the canvas"
        onClick={() => setInteractionMode(artboardMoveActive ? 'default' : 'artboard-move')}
        className={`inline-flex items-center gap-[6px] h-[26px] px-[10px] text-[12px] transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)] disabled:opacity-40 disabled:pointer-events-none ${
          artboardMoveActive
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
        }`}
      >
        <Move className="w-3.5 h-3.5" aria-hidden="true" />
        Move
      </button>

      {hasArtboardOffsets && !disabled ? (
        <button
          type="button"
          onClick={() => currentDesignId && resetArtboardOffsets(currentDesignId)}
          title="Reset artboard layout"
          className="inline-flex items-center justify-center h-[26px] w-[26px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          aria-label="Reset artboard layout"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        aria-pressed={artboardSelectActive}
        title="Click an artboard to view its source HTML"
        onClick={() => setInteractionMode(artboardSelectActive ? 'default' : 'artboard-select')}
        className={`inline-flex items-center gap-[6px] h-[26px] px-[10px] text-[12px] transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)] disabled:opacity-40 disabled:pointer-events-none ${
          artboardSelectActive
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
        }`}
      >
        <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
        Code
      </button>

      <button
        type="button"
        disabled={fitDisabled}
        title="Fit canvas to viewport"
        onClick={handleFit}
        className="inline-flex items-center gap-[6px] h-[26px] px-[10px] text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40 disabled:pointer-events-none transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)]"
      >
        <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
        Fit
      </button>

      <button
        type="button"
        disabled={disabled}
        aria-pressed={commentActive}
        onClick={() => setInteractionMode(commentActive ? 'default' : 'comment')}
        className={`inline-flex items-center gap-[6px] h-[26px] px-[10px] text-[12px] transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)] disabled:opacity-40 disabled:pointer-events-none ${
          commentActive
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
        }`}
      >
        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
        {t('preview.commentMode')}
      </button>

      {previewZoom !== 100 && !disabled ? (
        <button
          type="button"
          onClick={() => resetPreviewView()}
          className="h-[26px] px-[8px] text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          aria-label={t('preview.resetZoom')}
        >
          Reset
        </button>
      ) : null}
      <div className="relative" ref={zoomRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setZoomOpen((v) => !v)}
          className="inline-flex items-center justify-end w-[56px] h-[26px] pr-[10px] text-[12px] tabular-nums text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40 disabled:pointer-events-none transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)]"
          aria-haspopup="menu"
          aria-expanded={zoomOpen}
          aria-label={t('preview.zoom')}
          style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
        >
          {previewZoom}%
        </button>

        {zoomOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-[var(--space-1_5)] w-[56px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] p-[var(--space-1)] z-10"
          >
            {ZOOM_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={previewZoom === value}
                onClick={() => {
                  setPreviewZoom(value);
                  setZoomOpen(false);
                }}
                className={`block w-full pr-[10px] py-[var(--space-1)] text-[12px] text-right rounded-[var(--radius-sm)] tabular-nums transition-colors duration-100 hover:bg-[var(--color-surface-hover)] ${previewZoom === value ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-primary)]'}`}
                style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
              >
                {value}%
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={ref}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-[6px] h-[26px] px-[10px] text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40 disabled:pointer-events-none transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)]"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {t('export.button')}
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-[var(--space-1_5)] min-w-[320px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] p-[var(--space-1)] z-10"
          >
            {exportItems.map((item) => (
              <button
                key={item.format}
                type="button"
                role="menuitem"
                disabled={!item.ready}
                onClick={() => {
                  setOpen(false);
                  void exportActive(item.format);
                }}
                className="w-full flex flex-col items-start gap-[2px] px-[var(--space-3)] py-[var(--space-2)] text-left rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors duration-100"
              >
                <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                  {item.label}
                </span>
                {item.hint && (
                  <span className="text-[11px] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
                    {item.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
