/**
 * Device chrome for the focus-preview viewport (OD-046) — cosmetic bezel
 * around the existing preview iframe.
 *
 * Adapted from the copied frame assets (`assets/frames/*.html`, Apache-2.0
 * open-design — see that dir's own LICENSE). The reference frames are
 * standalone gallery pages: each is its own document with a nested
 * `<iframe id="screen">` loaded via a `?screen=` query param. That doesn't
 * fit here — `focus-preview.tsx` already owns one iframe per screen and talks
 * to it directly (the pin-overlay postMessage bridge), so nesting a *second*
 * iframe just to draw a bezel would double the message-passing surface for a
 * purely decorative wrapper. What's ported is the bezel itself: the
 * proportions, gradients and chrome markup (Dynamic Island, home indicator,
 * camera dot, traffic lights + URL bar), re-authored as plain CSS/SVG around
 * `children` instead of around a nested iframe.
 *
 * Cosmetic only — `DEVICE_SIZE` and the zoom transform in `focus-preview.tsx`
 * are untouched; this only decides what wraps the already-sized content.
 */
import type { ReactNode } from 'react';
import type { DeviceViewport } from './focus-preview';

const BEZEL_GRADIENT = 'linear-gradient(160deg, #2a2a2c 0%, #1a1a1c 50%, #0e0e10 100%)';
const BEZEL_SHADOW =
  '0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 0 2px #000 inset, 0 28px 60px -12px rgba(0,0,0,0.45), 0 8px 20px -8px rgba(0,0,0,0.35)';

function PhoneChrome({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative rounded-[52px] p-3"
      style={{ background: BEZEL_GRADIENT, boxShadow: BEZEL_SHADOW }}
    >
      <span
        aria-hidden
        className="absolute left-1/2 top-[14px] h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black"
      />
      <div className="overflow-hidden rounded-[40px] bg-white">{children}</div>
      <span
        aria-hidden
        className="absolute bottom-[10px] left-1/2 h-[4px] w-[100px] -translate-x-1/2 rounded-full bg-white/85"
      />
    </div>
  );
}

function TabletChrome({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative rounded-[32px] p-3.5"
      style={{ background: BEZEL_GRADIENT, boxShadow: BEZEL_SHADOW }}
    >
      <span
        aria-hidden
        className="absolute left-1/2 top-[10px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-black"
      />
      <div className="overflow-hidden rounded-[18px] bg-white">{children}</div>
    </div>
  );
}

function BrowserChrome({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white"
      style={{
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.06) inset, 0 1px 0 rgba(255,255,255,0.95) inset, 0 28px 60px -12px rgba(0,0,0,0.18), 0 8px 20px -8px rgba(0,0,0,0.12)',
      }}
    >
      <div
        className="flex h-[34px] shrink-0 items-center gap-3 border-b border-black/10 px-3"
        style={{ background: 'linear-gradient(to bottom, #ececeb 0%, #dadad8 100%)' }}
      >
        <span className="inline-flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto max-w-[60%] flex-1 truncate rounded-md border border-black/10 bg-white px-3 py-0.5 text-center text-[11px] text-[#6b6964]">
          preview
        </span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function DeviceChrome({
  viewport,
  children,
}: { viewport: DeviceViewport; children: ReactNode }) {
  if (viewport === 'mobile') return <PhoneChrome>{children}</PhoneChrome>;
  if (viewport === 'tablet') return <TabletChrome>{children}</TabletChrome>;
  return <BrowserChrome>{children}</BrowserChrome>;
}
