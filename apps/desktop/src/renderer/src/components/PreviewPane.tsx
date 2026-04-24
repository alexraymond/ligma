import { useT } from '@ligma/i18n';
import {
  type ArtboardMovedMessage,
  type ArtboardSelectedMessage,
  type CanvasPanDragMessage,
  type CanvasPanWheelMessage,
  type CanvasSizeMessage,
  type ElementRectsMessage,
  type IframeErrorMessage,
  type OverlayMessage,
  buildSrcdoc,
  isArtboardMovedMessage,
  isArtboardSelectedMessage,
  isCanvasPanDragMessage,
  isCanvasPanWheelMessage,
  isCanvasSizeMessage,
  isElementRectsMessage,
  isIframeErrorMessage,
  isOverlayMessage,
} from '@ligma/runtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../preview/EmptyState';
import { ErrorState } from '../preview/ErrorState';
import { useCodesignStore } from '../store';
import { CanvasErrorBar } from './CanvasErrorBar';
import { CanvasTabBar } from './CanvasTabBar';
import { FilesTabView } from './FilesTabView';
import { PhoneFrame } from './PhoneFrame';
import { PreviewToolbar } from './PreviewToolbar';
import { TweakPanel } from './TweakPanel';
import { ArtboardCodeDrawer } from './canvas/ArtboardCodeDrawer';
import { CanvasViewport } from './canvas/CanvasViewport';
import { CommentBubble } from './comment/CommentBubble';
import { PinOverlay } from './comment/PinOverlay';

export interface PreviewPaneProps {
  onPickStarter: (prompt: string) => void;
}

export function formatIframeError(
  kind: string,
  message: string,
  source?: string,
  lineno?: number,
): string {
  const location = source && lineno ? ` (${source}:${lineno})` : '';
  return `${kind}: ${message}${location}`;
}

export function isTrustedPreviewMessageSource(
  source: MessageEventSource | null,
  previewWindow: Window | null | undefined,
): boolean {
  return source !== null && source === previewWindow;
}

export function postModeToPreviewWindow(
  win: Window | null | undefined,
  mode: string,
  onError: (message: string) => void,
): boolean {
  if (!win) return false;
  try {
    win.postMessage({ __codesign: true, type: 'SET_MODE', mode }, '*');
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    onError(`SET_MODE postMessage failed: ${reason}`);
    return false;
  }
}

export function scaleRectForZoom(
  rect: { top: number; left: number; width: number; height: number },
  zoomPercent: number,
): { top: number; left: number; width: number; height: number } {
  const scale = zoomPercent / 100;
  return {
    top: rect.top * scale,
    left: rect.left * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function stablePreviewSourceKey(source: string): string {
  const head = source.trimStart().slice(0, 2048).toLowerCase();
  // Full HTML documents do not get the JSX tweaks bridge injected, so token
  // changes must invalidate srcdoc and force a reload to take effect.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return source;
  return source
    .replace(
      /\/\*\s*EDITMODE-BEGIN\s*\*\/[\s\S]*?\/\*\s*EDITMODE-END\s*\*\//g,
      '/*EDITMODE-BEGIN*/__STABLE__/*EDITMODE-END*/',
    )
    .replace(
      /\/\*\s*TWEAK-SCHEMA-BEGIN\s*\*\/[\s\S]*?\/\*\s*TWEAK-SCHEMA-END\s*\*\//g,
      '/*TWEAK-SCHEMA-BEGIN*/__STABLE__/*TWEAK-SCHEMA-END*/',
    );
}

export type AllowedPreviewMessageType =
  | 'ELEMENT_SELECTED'
  | 'IFRAME_ERROR'
  | 'ELEMENT_RECTS'
  | 'CANVAS_SIZE'
  | 'ARTBOARD_SELECTED'
  | 'ARTBOARD_MOVED'
  | 'CANVAS_PAN_WHEEL'
  | 'CANVAS_PAN_DRAG';

export interface PreviewMessageHandlers {
  onElementSelected: (msg: OverlayMessage) => void;
  onIframeError: (msg: IframeErrorMessage) => void;
  onElementRects: (msg: ElementRectsMessage) => void;
  onCanvasSize: (msg: CanvasSizeMessage) => void;
  onArtboardSelected: (msg: ArtboardSelectedMessage) => void;
  onArtboardMoved: (msg: ArtboardMovedMessage) => void;
  onCanvasPanWheel: (msg: CanvasPanWheelMessage) => void;
  onCanvasPanDrag: (msg: CanvasPanDragMessage) => void;
}

export type PreviewMessageOutcome =
  | { status: 'handled'; type: AllowedPreviewMessageType }
  | { status: 'rejected'; reason: 'envelope' | 'unknown-type' | 'shape'; type?: string };

export function handlePreviewMessage(
  data: unknown,
  handlers: PreviewMessageHandlers,
): PreviewMessageOutcome {
  if (typeof data !== 'object' || data === null) {
    return { status: 'rejected', reason: 'envelope' };
  }
  const envelope = data as { __codesign?: unknown; type?: unknown };
  if (envelope.__codesign !== true || typeof envelope.type !== 'string') {
    return { status: 'rejected', reason: 'envelope' };
  }

  switch (envelope.type) {
    case 'ELEMENT_SELECTED':
      if (isOverlayMessage(data)) {
        handlers.onElementSelected(data);
        return { status: 'handled', type: 'ELEMENT_SELECTED' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'IFRAME_ERROR':
      if (isIframeErrorMessage(data)) {
        handlers.onIframeError(data);
        return { status: 'handled', type: 'IFRAME_ERROR' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'ELEMENT_RECTS':
      if (isElementRectsMessage(data)) {
        handlers.onElementRects(data);
        return { status: 'handled', type: 'ELEMENT_RECTS' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'CANVAS_SIZE':
      if (isCanvasSizeMessage(data)) {
        handlers.onCanvasSize(data);
        return { status: 'handled', type: 'CANVAS_SIZE' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'ARTBOARD_SELECTED':
      if (isArtboardSelectedMessage(data)) {
        handlers.onArtboardSelected(data);
        return { status: 'handled', type: 'ARTBOARD_SELECTED' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'ARTBOARD_MOVED':
      if (isArtboardMovedMessage(data)) {
        handlers.onArtboardMoved(data);
        return { status: 'handled', type: 'ARTBOARD_MOVED' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'CANVAS_PAN_WHEEL':
      if (isCanvasPanWheelMessage(data)) {
        handlers.onCanvasPanWheel(data);
        return { status: 'handled', type: 'CANVAS_PAN_WHEEL' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'CANVAS_PAN_DRAG':
      if (isCanvasPanDragMessage(data)) {
        handlers.onCanvasPanDrag(data);
        return { status: 'handled', type: 'CANVAS_PAN_DRAG' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    default:
      return { status: 'rejected', reason: 'unknown-type', type: envelope.type };
  }
}

const COMMENT_HINT_CLASS =
  'absolute left-[var(--space-5)] top-[var(--space-5)] z-10 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-xs)] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)] backdrop-blur';

function latestToolSummary(
  calls: ReadonlyArray<{
    toolName: string;
    command?: string;
    args?: Record<string, unknown>;
    status: string;
  }>,
): string | null {
  // Surface the most recent running tool (or the last one that ran) so the
  // user sees "edit index.html" / "view dashboard.html" during the silent
  // long stretches of a generation. Mirrors WorkingCard's label logic
  // without importing its internals.
  if (!calls || calls.length === 0) return null;
  const running =
    [...calls].reverse().find((c) => c.status === 'running') ?? calls[calls.length - 1];
  if (!running) return null;
  const path = typeof running.args?.['path'] === 'string' ? (running.args['path'] as string) : null;
  const name = typeof running.args?.['name'] === 'string' ? (running.args['name'] as string) : null;
  const url = typeof running.args?.['url'] === 'string' ? (running.args['url'] as string) : null;
  const verb = running.command ?? running.toolName;
  const detail = path ?? name ?? url ?? '';
  return detail ? `${verb} · ${detail}` : verb;
}

function StreamingBanner({
  text,
  stage,
  latestTool,
}: {
  text: string;
  stage: string;
  latestTool: string | null;
}): React.ReactElement {
  const tail = text.length > 640 ? `…${text.slice(-640)}` : text;
  return (
    <div className="w-[72%] max-w-[900px] rounded-[var(--radius-lg)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] p-[var(--space-5)] flex flex-col gap-[var(--space-3)]">
      <div className="flex items-center gap-[var(--space-2)]">
        <span
          aria-hidden
          className="inline-block w-[8px] h-[8px] rounded-full bg-[var(--color-accent)] animate-pulse"
        />
        <span
          className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {stage}
        </span>
        {latestTool ? (
          <span
            className="ml-auto text-[11px] text-[var(--color-text-secondary)] truncate max-w-[60%]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {latestTool}
          </span>
        ) : null}
      </div>
      {tail.length > 0 ? (
        <pre
          className="m-0 max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-[var(--color-text-secondary)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {tail}
        </pre>
      ) : (
        <p className="m-0 text-[12px] text-[var(--color-text-muted)]">
          Waiting for the first chunk from the model…
        </p>
      )}
    </div>
  );
}

interface PreviewSlotProps {
  designId: string;
  html: string;
  active: boolean;
  viewport: 'mobile' | 'tablet' | 'desktop';
  zoom: number;
  canvasSize: { width: number; height: number } | undefined;
  showCommentUi: boolean;
  commentHintLabel: string;
  pinOverlay: React.ReactNode;
  interactionMode: string;
  registerIframe: (designId: string, el: HTMLIFrameElement | null) => void;
  onIframeError: (message: string) => void;
  onIframeLoaded: (designId: string) => void;
}

// One iframe per pool entry. Hidden (display:none) when not active, but kept
// in the DOM so its document — already parsed HTML, executed scripts, laid
// out — survives design switches. That's the whole point of the pool. The
// srcDocStableKey trick is per-slot so token-only tweaks via postMessage
// don't rebuild the document (~300-500ms blank on JSX cards).
function PreviewSlot({
  designId,
  html,
  active,
  viewport,
  zoom,
  canvasSize,
  showCommentUi,
  commentHintLabel,
  pinOverlay,
  interactionMode,
  registerIframe,
  onIframeError,
  onIframeLoaded,
}: PreviewSlotProps) {
  const srcDocStableKey = useMemo(() => stablePreviewSourceKey(html), [html]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: srcDocStableKey is the intentional dependency. html flows through naturally because the factory closes over it and re-runs whenever the stable key flips, which is exactly when structural changes (anything outside EDITMODE / TWEAK_SCHEMA markers) are present.
  const srcDoc = useMemo(() => buildSrcdoc(html), [srcDocStableKey]);

  const setRef = useCallback(
    (el: HTMLIFrameElement | null) => registerIframe(designId, el),
    [designId, registerIframe],
  );

  const isMobile = viewport === 'mobile';
  const scale = zoom / 100;
  const inversePct = `${10000 / zoom}%`;

  // Canvas-sized path: the in-iframe overlay reports natural body
  // scrollWidth/scrollHeight via CANVAS_SIZE. When present for a desktop
  // viewport, size the iframe element itself to that natural size and apply
  // zoom via transform: scale. The parent CanvasViewport (overflow-auto) then
  // provides native trackpad pan over the overflowing area — no Space+drag
  // required. Mobile/tablet keep their device-frame sizing.
  const useNaturalCanvas =
    !isMobile &&
    viewport === 'desktop' &&
    canvasSize !== undefined &&
    canvasSize.width > 0 &&
    canvasSize.height > 0;

  const rawIframe = (
    <iframe
      ref={setRef}
      title={`design-preview-${designId}`}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      onLoad={(e) => {
        // Once the iframe's document has actually loaded, its in-page message
        // handler is ready — this is the reliable moment to (re)post SET_MODE.
        // The parent's currentDesignId useEffect can fire before the document
        // loads, so that post may be dropped. Only re-post for the active
        // slot so we don't redirect background iframes into comment mode.
        if (!active) return;
        const target = e.currentTarget as HTMLIFrameElement;
        postModeToPreviewWindow(target.contentWindow, interactionMode, onIframeError);
        // The parent's WATCH_SELECTORS post can race past a freshly-mounted
        // iframe before its message listener installs. Ping the parent so it
        // re-broadcasts after load has confirmed the overlay is live.
        onIframeLoaded(designId);
      }}
      style={
        useNaturalCanvas && canvasSize
          ? { width: canvasSize.width, height: canvasSize.height }
          : undefined
      }
      className={
        useNaturalCanvas
          ? 'block bg-transparent border-0'
          : isMobile
            ? 'block w-full h-full bg-transparent border-0'
            : 'w-full h-full bg-transparent border-0'
      }
    />
  );
  let iframe: React.ReactNode;
  if (useNaturalCanvas && canvasSize) {
    iframe = (
      <div
        className="origin-top-left"
        style={{
          transform: `scale(${scale})`,
          width: canvasSize.width * scale,
          height: canvasSize.height * scale,
        }}
      >
        <div style={{ width: canvasSize.width, height: canvasSize.height }}>{rawIframe}</div>
      </div>
    );
  } else if (zoom === 100) {
    iframe = rawIframe;
  } else {
    iframe = (
      <div
        className="origin-top-left"
        style={{ transform: `scale(${scale})`, width: inversePct, height: inversePct }}
      >
        {rawIframe}
      </div>
    );
  }

  let body: React.ReactNode;
  if (isMobile) {
    body = (
      <div className="min-h-full p-8 flex flex-col items-center justify-center overflow-auto">
        <div className="relative inline-flex">
          <PhoneFrame>{iframe}</PhoneFrame>
          {active ? pinOverlay : null}
        </div>
      </div>
    );
  } else if (viewport === 'tablet') {
    body = (
      <div className="h-full p-8 flex flex-col items-center justify-start overflow-auto">
        <div
          className="relative"
          style={{
            width: 'var(--size-preview-tablet-width)',
            height: 'var(--size-preview-tablet-height)',
            flexShrink: 0,
          }}
        >
          {showCommentUi && active ? (
            <div className={COMMENT_HINT_CLASS}>{commentHintLabel}</div>
          ) : null}
          {iframe}
          {active ? pinOverlay : null}
        </div>
      </div>
    );
  } else if (useNaturalCanvas && canvasSize) {
    // Inline-sized wrapper: parent CanvasViewport's overflow-auto relies on
    // this element reporting its natural dimensions (width * scale / height
    // * scale) so scroll/pan engages on overflow. No `h-full w-full` here.
    body = (
      <div
        className="relative"
        style={{ width: canvasSize.width * scale, height: canvasSize.height * scale }}
      >
        {showCommentUi && active ? (
          <div className={COMMENT_HINT_CLASS}>{commentHintLabel}</div>
        ) : null}
        {iframe}
        {active ? pinOverlay : null}
      </div>
    );
  } else {
    body = (
      <div className="h-full w-full relative">
        {showCommentUi && active ? (
          <div className={COMMENT_HINT_CLASS}>{commentHintLabel}</div>
        ) : null}
        {iframe}
        {active ? pinOverlay : null}
      </div>
    );
  }

  // Paper-sketchbook label: handwritten caption pinned at the top-left of the
  // canvas (outside the iframe so it doesn't get overwritten by model output).
  // Shows the active file name so it's obvious which turn is currently open.
  const captionNode = active ? <FrameCaption /> : null;

  // When natural-sizing, don't force h-full w-full — let the wrapper report
  // its intrinsic size so the ancestor scroll container handles overflow.
  const outerClass = useNaturalCanvas ? '' : 'h-full w-full';
  return (
    <div hidden={!active} className={outerClass}>
      {captionNode}
      {body}
    </div>
  );
}

function FrameCaption(): React.ReactElement | null {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const currentFilePathByDesign = useCodesignStore((s) => s.currentFilePathByDesign);
  const path = currentDesignId ? currentFilePathByDesign[currentDesignId] : undefined;
  const label = path ?? 'index.html';
  // Pinned at top-left, rotated a touch so it reads as a hand-written margin
  // note; pointer-events-none so it never blocks iframe clicks. Uses Kalam
  // (the hand font) to match the sketchbook aesthetic.
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10"
      style={{
        top: 12,
        left: 12,
        transform: 'rotate(-1.5deg)',
        fontFamily: 'var(--font-hand)',
        fontSize: 14,
        fontStyle: 'italic',
        color: 'var(--color-accent)',
        background: 'var(--color-paper-card)',
        padding: '2px 10px',
        border: '1px dashed var(--color-accent)',
        boxShadow: 'var(--shadow-tape)',
        maxWidth: 280,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </div>
  );
}

export function PreviewPane({ onPickStarter }: PreviewPaneProps) {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const previewHtmlByDesign = useCodesignStore((s) => s.previewHtmlByDesign);
  const recentDesignIds = useCodesignStore((s) => s.recentDesignIds);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const chatMessages = useCodesignStore((s) => s.chatMessages);
  const canvasTabs = useCodesignStore((s) => s.canvasTabs);
  const activeCanvasTab = useCodesignStore((s) => s.activeCanvasTab);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const retry = useCodesignStore((s) => s.retryLastPrompt);
  const clearError = useCodesignStore((s) => s.clearError);
  const pushIframeError = useCodesignStore((s) => s.pushIframeError);
  const selectCanvasElement = useCodesignStore((s) => s.selectCanvasElement);
  const previewViewport = useCodesignStore((s) => s.previewViewport);
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const comments = useCodesignStore((s) => s.comments);
  const currentSnapshotId = useCodesignStore((s) => s.currentSnapshotId);
  const commentBubble = useCodesignStore((s) => s.commentBubble);
  const openCommentBubble = useCodesignStore((s) => s.openCommentBubble);
  const closeCommentBubble = useCodesignStore((s) => s.closeCommentBubble);
  const submitComment = useCodesignStore((s) => s.submitComment);
  const applyLiveRects = useCodesignStore((s) => s.applyLiveRects);
  const clearLiveRects = useCodesignStore((s) => s.clearLiveRects);
  const liveRects = useCodesignStore((s) => s.liveRects);
  const canvasSizeByDesign = useCodesignStore((s) => s.canvasSizeByDesign);
  const setCanvasSize = useCodesignStore((s) => s.setCanvasSize);
  const openArtboardCode = useCodesignStore((s) => s.openArtboardCode);
  const streamingAssistantText = useCodesignStore((s) => s.streamingAssistantText);
  const artboardOffsetsByDesign = useCodesignStore((s) => s.artboardOffsetsByDesign);
  const setArtboardOffset = useCodesignStore((s) => s.setArtboardOffset);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const generationStage = useCodesignStore((s) => s.generationStage);
  const pendingToolCalls = useCodesignStore((s) => s.pendingToolCalls);

  // Active iframe ref consumed by TweakPanel (postMessage target) and by the
  // window.message guard. We re-point this whenever the active design changes
  // or the active iframe element re-mounts.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Unsent bubble drafts, keyed by bubbleKey (edit:<id> | new:<selector>).
  // Lives across bubble remounts so switching to another chip / element and
  // coming back restores the text the user had typed. Cleared on successful
  // submit; explicit close (Esc / ×) deliberately preserves.
  const bubbleDraftsRef = useRef<Map<string, string>>(new Map());
  const iframesByDesign = useRef<Map<string, HTMLIFrameElement>>(new Map());
  // Bumped every time the active iframe fires onLoad — used to re-trigger
  // the WATCH_SELECTORS effect so we don't race past overlay installation
  // on first mount.
  const [iframeLoadTick, setIframeLoadTick] = useState(0);

  const registerIframe = useCallback((designId: string, el: HTMLIFrameElement | null) => {
    if (el) {
      iframesByDesign.current.set(designId, el);
    } else {
      iframesByDesign.current.delete(designId);
    }
  }, []);

  const handleIframeLoaded = useCallback(
    (designId: string) => {
      if (designId === currentDesignId) setIframeLoadTick((t) => t + 1);
    },
    [currentDesignId],
  );

  // When the active design changes, retarget iframeRef and re-broadcast the
  // current interaction mode. Background iframes keep their last mode — fine,
  // they're inert until reactivated.
  useEffect(() => {
    if (currentDesignId === null) {
      iframeRef.current = null;
      return;
    }
    const el = iframesByDesign.current.get(currentDesignId) ?? null;
    iframeRef.current = el;
    if (el) {
      postModeToPreviewWindow(el.contentWindow, interactionMode, pushIframeError);
    }
    // New iframe / new design → liveRects from the old one are stale.
    clearLiveRects();
  }, [currentDesignId, interactionMode, pushIframeError, clearLiveRects]);

  // Tell the sandbox which selectors to track. The sandbox re-measures each
  // on scroll/resize and broadcasts ELEMENT_RECTS; we merge into liveRects.
  // Selectors: all comments on the current snapshot + the active bubble's
  // selector (usually the freshly-pinned one, included for the moment
  // between click and save).
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentDesignId and iframeLoadTick are deliberate triggers — iframeRef.current is a ref so biome can't see it swap when the active design changes, and we must wait for the iframe's onLoad before the overlay's message listener exists (otherwise the post is dropped).
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const selectors = new Set<string>();
    if (currentSnapshotId) {
      for (const c of comments) {
        if (c.snapshotId === currentSnapshotId) selectors.add(c.selector);
      }
    }
    if (commentBubble) selectors.add(commentBubble.selector);
    try {
      win.postMessage(
        { __codesign: true, type: 'WATCH_SELECTORS', selectors: Array.from(selectors) },
        '*',
      );
    } catch {
      /* sandbox gone — retry happens next render */
    }
  }, [comments, currentSnapshotId, commentBubble, currentDesignId, iframeLoadTick]);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      // Only accept messages from the ACTIVE iframe — background pool members
      // are inert from the user's POV and their messages would race with the
      // foreground design's state.
      if (!isTrustedPreviewMessageSource(event.source, iframeRef.current?.contentWindow)) return;

      const outcome = handlePreviewMessage(event.data, {
        onElementSelected: (msg) => {
          const scaled = scaleRectForZoom(msg.rect, previewZoom);
          selectCanvasElement({
            selector: msg.selector,
            tag: msg.tag,
            outerHTML: msg.outerHTML,
            rect: scaled,
          });
          openCommentBubble({
            selector: msg.selector,
            tag: msg.tag,
            outerHTML: msg.outerHTML,
            rect: scaled,
            ...(typeof msg.parentOuterHTML === 'string' && msg.parentOuterHTML.length > 0
              ? { parentOuterHTML: msg.parentOuterHTML }
              : {}),
          });
        },
        onIframeError: (msg) =>
          pushIframeError(formatIframeError(msg.kind, msg.message, msg.source, msg.lineno)),
        onElementRects: (msg) => {
          applyLiveRects(msg.entries);
        },
        onCanvasSize: (msg) => {
          if (currentDesignId)
            setCanvasSize(currentDesignId, { width: msg.width, height: msg.height });
        },
        onArtboardSelected: (msg) => {
          if (!currentDesignId) return;
          openArtboardCode({
            designId: currentDesignId,
            label: msg.label,
            viewport: msg.viewport,
            outerHTML: msg.outerHTML,
          });
        },
        onArtboardMoved: (msg) => {
          if (!currentDesignId) return;
          setArtboardOffset(currentDesignId, msg.label, { x: msg.x, y: msg.y });
        },
        onCanvasPanWheel: (msg) => {
          // Iframes are separate browsing contexts so wheel events inside
          // never reach the outer scroll container. The overlay forwards
          // them here so we can translate to scrollLeft / scrollTop on the
          // viewport the user is actually looking at. Ctrl/Cmd + wheel
          // zooms — matching Figma and the existing outer-viewport
          // behaviour for events that happen to miss the iframe.
          if (msg.ctrlKey || msg.metaKey) {
            const current = useCodesignStore.getState().previewZoom;
            const step = msg.deltaY > 0 ? -5 : 5;
            const next = Math.min(400, Math.max(25, Math.round(current + step)));
            useCodesignStore.getState().setPreviewZoom(next);
            return;
          }
          const el = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
          if (!el) return;
          el.scrollLeft += msg.deltaX;
          el.scrollTop += msg.deltaY;
        },
        onCanvasPanDrag: (msg) => {
          const el = document.querySelector('[data-canvas-viewport]') as HTMLElement | null;
          if (!el) return;
          // Drag direction is opposite to scroll direction (dragging right
          // moves the content right, which for the viewport means scrolling
          // LEFT by the same delta). Match Figma / Miro's grab-hand feel.
          el.scrollLeft -= msg.dx;
          el.scrollTop -= msg.dy;
        },
      });

      if (outcome.status === 'rejected' && outcome.reason === 'unknown-type') {
        console.warn('[PreviewPane] rejected iframe message type:', outcome.type);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    pushIframeError,
    selectCanvasElement,
    openCommentBubble,
    previewZoom,
    applyLiveRects,
    setCanvasSize,
    openArtboardCode,
    setArtboardOffset,
    currentDesignId,
  ]);

  // Push the current design's artboard offsets into the iframe once the
  // overlay is live. Re-broadcast on any change so parent-side edits
  // (e.g. a "Reset layout" button) propagate without requiring a reload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: iframeLoadTick and currentDesignId are deliberate re-triggers; iframeRef.current is a ref (not seen by the linter) and swaps when the active design changes.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !currentDesignId) return;
    const offsets = artboardOffsetsByDesign[currentDesignId] ?? {};
    try {
      win.postMessage({ __codesign: true, type: 'APPLY_ARTBOARD_OFFSETS', offsets }, '*');
    } catch {
      /* sandbox gone — retries happen on next render */
    }
  }, [artboardOffsetsByDesign, currentDesignId, iframeLoadTick]);

  // Pool entries: active design first (using the freshest in-memory
  // previewHtml), then any other recently-visited designs that still have a
  // cached preview. Store-side LRU bounds the size; we just render what's
  // handed to us.
  const poolEntries = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; html: string }> = [];
    if (currentDesignId !== null) {
      const html = previewHtml ?? previewHtmlByDesign[currentDesignId];
      if (typeof html === 'string' && html.length > 0) {
        out.push({ id: currentDesignId, html });
        seen.add(currentDesignId);
      }
    }
    for (const id of recentDesignIds) {
      if (seen.has(id)) continue;
      const html = previewHtmlByDesign[id];
      if (typeof html === 'string' && html.length > 0) {
        out.push({ id, html });
        seen.add(id);
      }
    }
    return out;
  }, [currentDesignId, previewHtml, previewHtmlByDesign, recentDesignIds]);

  const activeTab = canvasTabs[activeCanvasTab];
  const showCommentUi = interactionMode === 'comment';
  const snapshotComments = currentSnapshotId
    ? comments.filter((c) => c.snapshotId === currentSnapshotId)
    : [];
  const pinOverlay = (
    <PinOverlay
      comments={snapshotComments}
      zoom={previewZoom}
      liveRects={liveRects}
      onPinClick={(c) => {
        const live = liveRects[c.selector] ?? c.rect;
        openCommentBubble({
          selector: c.selector,
          tag: c.tag,
          outerHTML: c.outerHTML,
          rect: scaleRectForZoom(live, previewZoom),
          existingCommentId: c.id,
          initialText: c.text,
        });
      }}
    />
  );

  const activeHasHtml =
    currentDesignId !== null && poolEntries.some((e) => e.id === currentDesignId);

  // When a design already has persisted content (thumbnail from a prior save,
  // or chat history), the preview IS coming — we're just waiting on the IPC
  // round-trip for the snapshot. Show a skeleton instead of the new-design
  // welcome screen so users don't read the transient state as "load failed".
  const currentDesign = currentDesignId ? designs.find((d) => d.id === currentDesignId) : undefined;
  const designHasContent =
    currentDesign !== undefined &&
    ((currentDesign.thumbnailText !== null && currentDesign.thumbnailText.length > 0) ||
      chatMessages.length > 0);

  let body: React.ReactNode;
  // Only take over the whole pane with ErrorState when there's nothing to
  // show yet. If the agent produced a preview before failing on the last
  // step (common with token-overflow / validation errors), keep the preview
  // visible — the user can still inspect and tweak what did generate.
  // A small dismissible error banner surfaces via CanvasErrorBar / toast.
  if (errorMessage && !previewHtml) {
    body = (
      <ErrorState
        message={errorMessage}
        onRetry={() => {
          void retry();
        }}
        onDismiss={clearError}
      />
    );
  } else if (activeTab?.kind === 'files' && previewHtml) {
    body = <FilesTabView />;
  } else {
    // Pool slots stay mounted even when the current design has no preview —
    // background iframes for recently-visited designs keep their documents
    // alive for instant switch-back. EmptyState is overlaid in the same
    // stacking context when the active design has no content yet. The
    // CanvasViewport gives the canvas scroll + space-drag pan + ctrl-wheel
    // zoom for large multi-artboard outputs (DESIGN_CANVAS pattern).
    body = (
      <CanvasViewport>
        <div className="relative h-full w-full">
          {poolEntries.map((entry) => (
            <PreviewSlot
              key={entry.id}
              designId={entry.id}
              html={entry.html}
              active={entry.id === currentDesignId}
              viewport={previewViewport}
              zoom={previewZoom}
              canvasSize={canvasSizeByDesign[entry.id]}
              showCommentUi={showCommentUi}
              commentHintLabel={t('preview.commentModeHint')}
              pinOverlay={pinOverlay}
              interactionMode={interactionMode}
              registerIframe={registerIframe}
              onIframeError={pushIframeError}
              onIframeLoaded={handleIframeLoaded}
            />
          ))}
          {!activeHasHtml ? (
            designHasContent ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-background)] p-[var(--space-8)]">
                {isGenerating ? (
                  <StreamingBanner
                    text={
                      streamingAssistantText && streamingAssistantText.designId === currentDesignId
                        ? streamingAssistantText.text
                        : ''
                    }
                    stage={generationStage.toString().toUpperCase()}
                    latestTool={latestToolSummary(pendingToolCalls)}
                  />
                ) : (
                  <div className="w-[60%] max-w-[720px] aspect-[4/3] rounded-[var(--radius-lg)] bg-[linear-gradient(110deg,var(--color-background-secondary)_0%,rgba(0,0,0,0.03)_40%,var(--color-background-secondary)_80%)] animate-pulse" />
                )}
              </div>
            ) : (
              <EmptyState onPickStarter={onPickStarter} />
            )
          ) : null}
        </div>
      </CanvasViewport>
    );
  }

  const hasTabs = canvasTabs.length > 0;
  const isWelcome = !errorMessage && !previewHtml && !designHasContent;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex flex-col min-h-0 flex-1">
        {isWelcome ? null : (
          <div className="flex items-stretch justify-between gap-[var(--space-2)] border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)] pl-[var(--space-2)]">
            {hasTabs ? <CanvasTabBar /> : <div />}
            <PreviewToolbar />
          </div>
        )}
        <CanvasErrorBar />
        <div className="relative flex-1 overflow-hidden">
          {body}
          {previewHtml ? <TweakPanel iframeRef={iframeRef} /> : null}
          <ArtboardCodeDrawer />
        </div>
        {commentBubble && interactionMode === 'comment'
          ? (() => {
              const liveForBubble = liveRects[commentBubble.selector];
              const scaled = liveForBubble
                ? scaleRectForZoom(liveForBubble, previewZoom)
                : commentBubble.rect;
              const existingId = commentBubble.existingCommentId;
              // Keying by comment id (when editing) rather than selector alone
              // means two comments on the same element each get their own draft
              // state and don't stomp each other on reopen.
              const bubbleKey = existingId ? `edit:${existingId}` : `new:${commentBubble.selector}`;
              // Draft precedence: prior unsent draft for this anchor > DB text
              // on a reopened chip > empty. This preserves mid-typing context
              // when the user clicks another chip and comes back.
              const stashed = bubbleDraftsRef.current.get(bubbleKey);
              const initialText = stashed ?? commentBubble.initialText;
              return (
                <CommentBubble
                  key={bubbleKey}
                  selector={commentBubble.selector}
                  tag={commentBubble.tag}
                  outerHTML={commentBubble.outerHTML}
                  rect={scaled}
                  {...(initialText !== undefined ? { initialText } : {})}
                  onDraftChange={(text) => {
                    if (text.length === 0) bubbleDraftsRef.current.delete(bubbleKey);
                    else bubbleDraftsRef.current.set(bubbleKey, text);
                  }}
                  onClose={() => {
                    const win = iframeRef.current?.contentWindow;
                    if (win) {
                      try {
                        win.postMessage({ __codesign: true, type: 'CLEAR_PIN' }, '*');
                      } catch {
                        /* noop */
                      }
                    }
                    closeCommentBubble();
                  }}
                  onSendToClaude={async (text: string) => {
                    const row = await submitComment({
                      kind: 'edit',
                      selector: commentBubble.selector,
                      tag: commentBubble.tag,
                      outerHTML: commentBubble.outerHTML,
                      rect: commentBubble.rect,
                      text,
                      scope: 'element',
                      ...(existingId ? { existingCommentId: existingId } : {}),
                      ...(commentBubble.parentOuterHTML
                        ? { parentOuterHTML: commentBubble.parentOuterHTML }
                        : {}),
                    });
                    // On failure (no snapshot, IPC error, duplicate) keep the
                    // bubble open so the user's draft survives. A toast has
                    // already been surfaced by the store layer.
                    if (!row) return;
                    // Persisted — wipe the stashed draft so the next open
                    // starts clean (a reopened chip re-reads from DB).
                    bubbleDraftsRef.current.delete(bubbleKey);
                    const win = iframeRef.current?.contentWindow;
                    if (win) {
                      try {
                        win.postMessage({ __codesign: true, type: 'CLEAR_PIN' }, '*');
                      } catch {
                        /* noop */
                      }
                    }
                    closeCommentBubble();
                    // Stage only — user clicks the "Apply" button on the chip bar
                    // to send all accumulated edits in one go.
                  }}
                />
              );
            })()
          : null}
      </div>
    </div>
  );
}
