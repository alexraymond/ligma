'use client';

/**
 * Focus mode: one screen at full size, with device frames and the pin overlay.
 *
 * Ported from ligma-classic's `PreviewPane.tsx` (studio map §2), keeping the
 * thing that file existed for:
 *
 *  - **The iframe pool.** One `<iframe>` per recently-visited screen, kept
 *    mounted and hidden with `visibility`/`display` rather than unmounted —
 *    "that's the whole point of the pool", because a fresh iframe re-parses the
 *    HTML, re-executes the scripts and re-lays out. Switching screens is
 *    instant. LRU-bounded to `POOL_SIZE` entries here (the store bounded it
 *    there).
 *
 * `stablePreviewSourceKey` (srcdoc.ts) — keying the srcdoc memo on a
 * token-blanked source so a live EDITMODE tweak rides a postMessage instead of
 * rebuilding the document — is NOT used here: the postMessage side of that
 * bridge was never ported into the overlay script (codebase audit P3), so a
 * tweak keyed out of the memo never reached the iframe at all. `srcDoc` below
 * is keyed on the raw `body`, so a tweak takes the same rebuild every other
 * edit does — a real (flash-on) update instead of a silent no-op.
 *
 * Only the active slot is sent `SET_MODE` / `WATCH_SELECTORS`, so background
 * pool iframes are never redirected into comment mode — ported guard.
 */

import type { DesignPin } from '@ligma/api';
import { isElementRectsMessage, isOverlayMessage } from '@ligma/runtime/overlay';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceChrome } from './device-chrome';
import { PinOverlay, type PinRect } from './pin-overlay';
import {
  type DeckSlideInfo,
  SlideNav,
  clampSlide,
  isDeckInfoMessage,
  isDeckSlideMessage,
  withDeckNav,
} from './slide-nav';
import { buildDesignSrcdoc, postToIframe } from './srcdoc';

const POOL_SIZE = 4;

export type DeviceViewport = 'mobile' | 'tablet' | 'desktop';

const DEVICE_SIZE: Record<DeviceViewport, { width: number; height: number } | null> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: null,
};

/** What the overlay captured when the user clicked an element in comment mode. */
export interface PinTarget {
  filePath: string;
  selector: string;
  tag: string;
  outerHTML: string;
  parentOuterHTML: string | null;
  rect: PinRect;
}

interface PreviewSlotProps {
  path: string;
  body: string;
  active: boolean;
  viewport: DeviceViewport;
  zoom: number;
  registerIframe: (path: string, el: HTMLIFrameElement | null) => void;
  onLoaded: (path: string) => void;
}

function PreviewSlot({
  path,
  body,
  active,
  viewport,
  zoom,
  registerIframe,
  onLoaded,
}: PreviewSlotProps) {
  // `stablePreviewSourceKey` was meant to key this memo so a token-only
  // EDITMODE edit skips the rebuild and rides a postMessage to the live
  // iframe instead — but that postMessage side of the bridge was never built
  // (codebase audit P3): the overlay script (@ligma/runtime/overlay) has no
  // message type that updates a live token, so a tweak keyed out of this memo
  // simply never reached the iframe at all — "Applied live" and the preview
  // silently stayed on the old value. Keying on the raw `body` instead means
  // a tweak now takes the same (brief-flash) rebuild every other edit already
  // does, which is a real update instead of no update.
  const srcDoc = useMemo(() => withDeckNav(buildDesignSrcdoc(body)), [body]);
  const setRef = useCallback(
    (el: HTMLIFrameElement | null) => registerIframe(path, el),
    [path, registerIframe],
  );

  const device = DEVICE_SIZE[viewport];
  const scale = zoom / 100;

  const iframe = (
    <iframe
      ref={setRef}
      title={`design-preview-${path}`}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      onLoad={() => onLoaded(path)}
      className="block border-0 bg-white"
      style={
        device
          ? { width: device.width, height: device.height }
          : { width: '100%', height: '100%', minHeight: 640 }
      }
    />
  );

  return (
    <div
      data-preview-slot={path}
      style={{ display: active ? 'block' : 'none' }}
      className={device ? 'flex justify-center p-8' : 'h-full w-full'}
    >
      {device ? (
        <div className="origin-top" style={{ transform: `scale(${scale})` }}>
          <DeviceChrome viewport={viewport}>{iframe}</DeviceChrome>
        </div>
      ) : zoom === 100 ? (
        <DeviceChrome viewport={viewport}>{iframe}</DeviceChrome>
      ) : (
        <div
          className="origin-top-left"
          style={{
            transform: `scale(${scale})`,
            width: `${10000 / zoom}%`,
            height: `${10000 / zoom}%`,
          }}
        >
          <DeviceChrome viewport={viewport}>{iframe}</DeviceChrome>
        </div>
      )}
    </div>
  );
}

export interface FocusPreviewProps {
  path: string;
  bodies: Record<string, string>;
  pins: DesignPin[];
  viewport: DeviceViewport;
  zoom: number;
  /** True while the composer is in "click an element to pin" mode. */
  commentMode: boolean;
  onPinTarget: (target: PinTarget) => void;
  onPinClick: (pin: DesignPin) => void;
}

export function FocusPreview({
  path,
  bodies,
  pins,
  viewport,
  zoom,
  commentMode,
  onPinTarget,
  onPinClick,
}: FocusPreviewProps) {
  const [pool, setPool] = useState<string[]>([path]);
  const [liveRects, setLiveRects] = useState<Record<string, PinRect>>({});
  const [loadTick, setLoadTick] = useState(0);
  const [deck, setDeck] = useState<DeckSlideInfo[] | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const iframes = useRef(new Map<string, HTMLIFrameElement>());

  // LRU: the active path first, older visits trail it, oldest falls off.
  useEffect(() => {
    setPool((prev) =>
      prev[0] === path ? prev : [path, ...prev.filter((p) => p !== path)].slice(0, POOL_SIZE),
    );
  }, [path]);

  const registerIframe = useCallback((slotPath: string, el: HTMLIFrameElement | null) => {
    if (el) iframes.current.set(slotPath, el);
    else iframes.current.delete(slotPath);
  }, []);

  const onLoaded = useCallback(
    (slotPath: string) => {
      // The document's message listener is only live after load; the parent's
      // SET_MODE / WATCH_SELECTORS posts can race past a fresh mount, so a load
      // re-triggers the broadcast rather than being dropped. Ported.
      if (slotPath === path) setLoadTick((n) => n + 1);
    },
    [path],
  );

  const activeWindow = useCallback(
    (): Window | null => iframes.current.get(path)?.contentWindow ?? null,
    [path],
  );

  // Only the active slot is switched into comment mode.
  useEffect(() => {
    postToIframe(activeWindow(), { type: 'SET_MODE', mode: commentMode ? 'comment' : 'default' });
  }, [commentMode, activeWindow, loadTick]);

  const watched = useMemo(
    () => pins.filter((pin) => pin.filePath === path).map((pin) => pin.selector),
    [pins, path],
  );

  useEffect(() => {
    postToIframe(activeWindow(), { type: 'WATCH_SELECTORS', selectors: watched });
  }, [watched, activeWindow, loadTick]);

  // Ask whether this screen is a deck. A pooled iframe answered once already,
  // on its own load, and this host dropped it as a background slot's message —
  // so the question is re-asked whenever the focus moves back to it.
  useEffect(() => {
    setDeck(null);
    setSlideIndex(0);
    postToIframe(activeWindow(), { type: 'DECK_QUERY' });
  }, [activeWindow, loadTick]);

  // The overlay's two inbound channels: a click-to-pin selection, and the live
  // rect stream that keeps existing pins glued to their elements.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const source = iframes.current.get(path)?.contentWindow;
      if (!source || event.source !== source) return;
      const data: unknown = event.data;
      if (isElementRectsMessage(data)) {
        setLiveRects((prev) => {
          const next = { ...prev };
          for (const entry of data.entries) next[entry.selector] = entry.rect;
          return next;
        });
        return;
      }
      if (isDeckInfoMessage(data)) {
        // A pooled iframe kept its place while it was in the background, so the
        // deck reports where it actually is — not where a fresh mount would be.
        setDeck(data.slides.length > 0 ? data.slides : null);
        setSlideIndex(data.index);
        return;
      }
      if (isDeckSlideMessage(data)) {
        setSlideIndex(data.index);
        return;
      }
      if (isOverlayMessage(data)) {
        onPinTarget({
          filePath: path,
          selector: data.selector,
          tag: data.tag,
          outerHTML: data.outerHTML,
          parentOuterHTML: data.parentOuterHTML ?? null,
          rect: data.rect,
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [path, onPinTarget]);

  const filePins = useMemo(() => pins.filter((pin) => pin.filePath === path), [pins, path]);

  return (
    <div className="relative min-h-full">
      {pool.map((slotPath) =>
        bodies[slotPath] === undefined ? null : (
          <PreviewSlot
            key={slotPath}
            path={slotPath}
            body={bodies[slotPath]}
            active={slotPath === path}
            viewport={viewport}
            zoom={zoom}
            registerIframe={registerIframe}
            onLoaded={onLoaded}
          />
        ),
      )}
      {bodies[path] === undefined ? (
        <div
          className="flex h-full min-h-[320px] items-center justify-center font-mono text-xs"
          style={{ color: 'var(--paper-ink-muted)' }}
        >
          preview unavailable — no source route
        </div>
      ) : null}
      <PinOverlay pins={filePins} liveRects={liveRects} zoom={zoom} onPinClick={onPinClick} />
      {deck ? (
        <SlideNav
          slides={deck}
          index={clampSlide(slideIndex, deck.length)}
          onGo={(next) => {
            setSlideIndex(next);
            postToIframe(activeWindow(), { type: 'GOTO_SLIDE', index: next });
          }}
        />
      ) : null}
    </div>
  );
}
