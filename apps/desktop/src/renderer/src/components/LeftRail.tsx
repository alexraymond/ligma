import { useT } from '@ligma/i18n';
import { Home, Layers, Settings as SettingsIcon } from 'lucide-react';
import type { ComponentType, ReactElement, SVGProps } from 'react';
import { type AppView, useCodesignStore } from '../store';

interface RailSlotDef {
  view: AppView;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  labelKey: 'rail.home' | 'rail.designSystems' | 'rail.settings';
}

const SLOTS: readonly RailSlotDef[] = [
  { view: 'hub', icon: Home, labelKey: 'rail.home' },
  { view: 'designSystems', icon: Layers, labelKey: 'rail.designSystems' },
  { view: 'settings', icon: SettingsIcon, labelKey: 'rail.settings' },
] as const;

/**
 * Paper-sketchbook left rail — 56px wide, holds the three app destinations.
 * Active slot is wrapped in a red-pencil oval (see .ligma-pencil-oval in
 * index.css). A tiny red status dot anchors the bottom of the rail.
 */
export function LeftRail(): ReactElement {
  const t = useT();
  const view = useCodesignStore((s) => s.view);
  const setView = useCodesignStore((s) => s.setView);

  return (
    <nav
      aria-label={t('rail.aria')}
      className="shrink-0 h-full flex flex-col items-center"
      style={{
        width: 'var(--size-rail-width)',
        padding: '14px 0 16px',
        gap: '2px',
        borderRight: '1px dashed var(--color-rule)',
        background:
          'linear-gradient(to right, color-mix(in srgb, var(--color-paper) 55%, transparent), transparent)',
        position: 'relative',
        zIndex: 3,
      }}
    >
      {SLOTS.map(({ view: slotView, icon: Icon, labelKey }) => {
        const active = view === slotView;
        return (
          <button
            key={slotView}
            type="button"
            onClick={() => setView(slotView)}
            aria-label={t(labelKey)}
            aria-current={active ? 'page' : undefined}
            title={t(labelKey)}
            className="relative inline-flex items-center justify-center w-[40px] h-[40px] transition-colors"
            style={{
              color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
            }}
          >
            <Icon width={20} height={20} strokeWidth={1.7} aria-hidden />
            {active ? (
              <span
                aria-hidden
                className="pointer-events-none"
                style={{
                  position: 'absolute',
                  inset: 2,
                  border: '1.8px solid var(--color-accent)',
                  borderRadius: '48% 52% 50% 50% / 50% 50% 48% 52%',
                  transform: 'rotate(-7deg)',
                  opacity: 0.95,
                }}
              />
            ) : null}
          </button>
        );
      })}
      <span
        aria-hidden
        style={{
          marginTop: 'auto',
          width: 9,
          height: 9,
          background: 'var(--color-accent)',
          borderRadius: '50%',
          boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-accent) 18%, transparent)',
        }}
      />
    </nav>
  );
}
