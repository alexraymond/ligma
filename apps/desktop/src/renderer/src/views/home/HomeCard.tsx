import { useT } from '@ligma/i18n';
import type { Design } from '@ligma/shared';
import { MoreHorizontal } from 'lucide-react';
import { type CSSProperties, type MouseEvent, type ReactElement, useEffect, useState } from 'react';
import { useCodesignStore } from '../../store';
import { DesignCardPreview } from '../hub/DesignCardPreview';
import { formatRelativeTime } from './formatRelativeTime';

// FNV-1a style hash → deterministic jitter keyed by design id. A hash lets
// each card keep its own rotation across renders (and remounts) so the wall
// doesn't wobble when something upstream refetches.
function hashToUnit(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1000) / 1000;
}

function stableCardRotation(id: string, maxDeg: number): number {
  return (hashToUnit(id) - 0.5) * 2 * maxDeg;
}

function stableTapeRotation(id: string, maxDeg: number): number {
  // Offset the hash so tape and card rotations don't correlate.
  return (hashToUnit(`${id}:tape`) - 0.5) * 2 * maxDeg;
}

export interface HomeCardProps {
  design: Design;
  /** Hero cards span two grid cells and bump up the preview/title sizing. */
  variant?: 'default' | 'hero';
}

const EMPTY_PLAQUE_CACHE = new Map<string, string>();

// Returns the plaque text — the latest snapshot's prompt — or `null` when
// the design has no usable prompt. Returning null (instead of falling back
// to design.name) lets the caller suppress the plaque row entirely, which
// avoids duplicating the title in Caveat italic directly under the title
// in Fraunces bold.
function usePlaqueText(design: Design): string | null {
  const [plaque, setPlaque] = useState<string | null>(() => {
    const cached = EMPTY_PLAQUE_CACHE.get(design.id);
    return cached !== undefined ? cached : null;
  });
  useEffect(() => {
    let cancelled = false;
    const cached = EMPTY_PLAQUE_CACHE.get(design.id);
    if (cached !== undefined) {
      setPlaque(cached);
      return;
    }
    void (async () => {
      try {
        const snaps = await window.codesign?.snapshots.list(design.id);
        if (cancelled) return;
        const latest = snaps?.[0];
        const text = latest?.prompt?.trim() ?? '';
        // Drop plaque when it would just repeat the title (Fraunces bold) —
        // the point of the Caveat plaque is a *description*, not a duplicate.
        const resolved = text.length > 0 && text !== design.name ? text : null;
        EMPTY_PLAQUE_CACHE.set(design.id, resolved ?? '');
        setPlaque(resolved);
      } catch {
        if (!cancelled) setPlaque(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [design.id, design.name]);
  // Cache stores empty-string sentinel to mean "known-empty"; surface as null.
  return plaque === '' ? null : plaque;
}

export function HomeCard({ design, variant = 'default' }: HomeCardProps): ReactElement {
  const t = useT();
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const setView = useCodesignStore((s) => s.setView);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);
  const requestDeleteDesign = useCodesignStore((s) => s.requestDeleteDesign);
  const plaque = usePlaqueText(design);
  const updated = formatRelativeTime(design.updatedAt);
  const isHero = variant === 'hero';
  const rotation = stableCardRotation(design.id, 1.1);
  const tapeRotation = stableTapeRotation(design.id, 5);
  const tapeWidth = isHero ? 36 : 22;
  const tapeHeight = isHero ? 9 : 8;

  // Hero cards sit in a fixed 344-px grid cell and use `height: 100%` + the
  // preview's `flex: 1` to fill it. Non-hero cards live in an auto-sized
  // plain-grid row; `height: 100%` there would clamp the card to whatever
  // pixel height the grid row resolved to, pushing meta + plaque *outside*
  // the paper frame. So: no `height: 100%` for non-hero — let the card size
  // to its content, and give the preview an explicit aspect ratio instead.
  const cardStyle: CSSProperties = {
    position: 'relative',
    background: 'var(--color-paper-card)',
    border: '1px solid var(--color-pencil-faint)',
    padding: isHero ? '12px 14px 14px' : '8px 10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: isHero ? 8 : 6,
    boxShadow: 'var(--shadow-card)',
    transform: `rotate(${rotation}deg)`,
    transition: 'transform 200ms var(--ease-out), box-shadow 200ms var(--ease-out)',
    cursor: 'pointer',
    width: '100%',
    ...(isHero ? { height: '100%' } : {}),
  };

  async function onOpen(): Promise<void> {
    await switchDesign(design.id);
    setView('workspace');
  }

  function onMore(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    requestRenameDesign(design);
  }

  function onContext(e: MouseEvent): void {
    e.preventDefault();
    requestDeleteDesign(design);
  }

  return (
    <div className="group" style={cardStyle} onContextMenu={onContext}>
      {/* Transparent button overlay → whole-card click target. Kept as a
       *  sibling rather than wrapping the whole card so the "More actions"
       *  button can remain a real <button> without nesting. */}
      <button
        type="button"
        onClick={() => void onOpen()}
        aria-label={t('hub.your.openAria', { name: design.name })}
        className="absolute inset-0 z-[1] text-left focus-visible:outline-none"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <span className="sr-only">{design.name}</span>
      </button>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -4,
          left: '50%',
          marginLeft: -(tapeWidth / 2),
          width: tapeWidth,
          height: tapeHeight,
          background: 'var(--color-accent)',
          opacity: 0.9,
          transform: `rotate(${tapeRotation}deg)`,
          boxShadow: 'var(--shadow-tape)',
        }}
      />
      <div
        className="relative overflow-hidden"
        style={{
          background: '#ffffff',
          border: '1px solid rgba(42,38,32,0.16)',
          // Hero: grow into the fixed 344-px cell via flex + min-height.
          // Non-hero: fixed aspect so card can size to content and row auto.
          ...(isHero ? { flex: 1, minHeight: 260 } : { aspectRatio: '4 / 3' }),
        }}
      >
        <DesignCardPreview design={design} />
      </div>

      <div
        className="flex items-baseline justify-between gap-[var(--space-2)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        <span
          className="truncate"
          style={{
            fontSize: isHero ? 21 : 14.5,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.008em',
            lineHeight: 1.1,
          }}
        >
          {design.name}
        </span>
        {updated ? (
          <span
            aria-hidden
            style={{
              fontFamily: 'var(--font-hand)',
              fontSize: isHero ? 22 : 17,
              fontWeight: 600,
              color: 'var(--color-accent)',
              transform: 'rotate(-4deg)',
              display: 'inline-block',
              lineHeight: 1,
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
            {updated}
          </span>
        ) : null}
      </div>

      {plaque !== null ? (
        <div
          className="truncate"
          style={{
            fontFamily: 'var(--font-hand)',
            fontSize: isHero ? 19 : 16,
            fontStyle: 'italic',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.05,
            paddingTop: isHero ? 6 : 4,
            borderTop: '1px dashed var(--color-rule)',
            fontWeight: 500,
          }}
        >
          {plaque}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onMore}
        aria-label={t('hub.card.moreActions', { name: design.name })}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 3,
          width: 24,
          height: 24,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-paper-card)',
          border: '1px solid var(--color-rule)',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
      >
        <MoreHorizontal width={14} height={14} />
      </button>
    </div>
  );
}
