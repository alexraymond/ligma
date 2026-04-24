import { useT } from '@ligma/i18n';
import { IconButton, Wordmark } from '@ligma/ui';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BookOpen,
  FolderOpen,
  Settings as SettingsIcon,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect } from 'react';
import { useCodesignStore } from '../store';
import { HomePromptBar } from './HomePromptBar';
import { ModelSwitcher } from './ModelSwitcher';
import { ThemeToggle } from './ThemeToggle';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface TopStripProps {
  /** Optional handler for the "templates" link — typically scrolls to the
   *  starter-row anchor inside HomeView or opens a template picker. */
  onShowTemplates?: () => void;
}

/**
 * Paper-sketchbook top strip — replaces the previous TopBar. Renders brand
 * on the left, a view-conditional middle (home prompt / breadcrumb / back),
 * and a right cluster (templates link, model pill, bell, theme, settings).
 */
export function TopStrip({ onShowTemplates }: TopStripProps = {}) {
  const t = useT();
  const view = useCodesignStore((s) => s.view);
  const previousView = useCodesignStore((s) => s.previousView);
  const setView = useCodesignStore((s) => s.setView);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const unreadErrorCount = useCodesignStore((s) => s.unreadErrorCount);
  const refreshDiagnosticEvents = useCodesignStore((s) => s.refreshDiagnosticEvents);
  const openSettingsTab = useCodesignStore((s) => s.openSettingsTab);

  // Pull-based: refresh the diagnostic counter on mount so a page reload
  // surfaces errors recorded while the window was closed. No polling.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    void refreshDiagnosticEvents();
  }, []);

  let middle: ReactNode;
  if (view === 'hub') {
    middle = <HomePromptBar />;
  } else if (view === 'workspace') {
    middle = (
      <div className="flex items-center gap-[var(--space-2)]" style={noDragStyle}>
        <span style={{ color: 'var(--color-rule-subtle)' }}>/</span>
        <button
          type="button"
          onClick={() => setView('hub')}
          aria-label={t('topbar.openMyDesigns')}
          className="inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] transition-colors duration-[var(--duration-faster)] max-w-[520px] hover:bg-[var(--color-surface-hover)]"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '18px',
            letterSpacing: '-0.015em',
            color: 'var(--color-text-secondary)',
          }}
        >
          <FolderOpen className="w-4 h-4 shrink-0" aria-hidden />
          <span className="truncate" title={currentDesign?.name ?? ''}>
            {currentDesign?.name ?? t('sidebar.noDesign')}
          </span>
        </button>
      </div>
    );
  } else {
    // settings / designSystems — back link to the previous view (falls back to hub)
    const back = previousView === view ? 'hub' : previousView;
    const label = view === 'settings' ? t('topbar.settingsLabel') : t('hub.tabs.designSystems');
    middle = (
      <div className="flex items-center gap-[var(--space-2)]" style={noDragStyle}>
        <span style={{ color: 'var(--color-rule-subtle)' }}>/</span>
        <button
          type="button"
          onClick={() => setView(back)}
          className="inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)]"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '18px',
            letterSpacing: '-0.015em',
            color: 'var(--color-text-secondary)',
          }}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden />
          <span>{label}</span>
        </button>
      </div>
    );
  }

  return (
    <header
      className="shrink-0 flex items-center justify-between"
      style={{
        ...dragStyle,
        height: 'var(--size-titlebar-height)',
        paddingLeft: 'var(--size-titlebar-pad-left)',
        paddingRight: 'var(--space-5)',
        borderBottom: '1px dashed var(--color-rule)',
        background:
          'linear-gradient(to bottom, color-mix(in srgb, var(--color-paper) 65%, transparent), color-mix(in srgb, var(--color-paper) 25%, transparent))',
        position: 'relative',
        zIndex: 3,
      }}
    >
      <div
        className="flex items-center gap-[var(--space-5)] min-w-0 flex-1 h-full"
        style={noDragStyle}
      >
        <div className="flex items-baseline gap-[var(--space-2_5)]">
          <Wordmark badge={`v${__APP_VERSION__}`} size="sm" />
        </div>

        <div className="min-w-0 flex-1">{middle}</div>
      </div>

      <div className="flex items-center gap-[var(--space-3)] shrink-0" style={noDragStyle}>
        {onShowTemplates ? (
          <button
            type="button"
            onClick={onShowTemplates}
            className="inline-flex items-center gap-[6px] px-[var(--space-2)] py-[var(--space-1)] text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '13.5px',
            }}
          >
            <BookOpen className="w-4 h-4" aria-hidden />
            <span>templates</span>
          </button>
        ) : null}

        <ModelSwitcher variant="topbar" />

        <button
          type="button"
          onClick={() => openSettingsTab('diagnostics')}
          aria-label={t('topbar.unreadErrors', { count: unreadErrorCount })}
          title={t('topbar.unreadErrors', { count: unreadErrorCount })}
          className="relative inline-flex items-center justify-center w-[28px] h-[28px] text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
        >
          <Bell className="w-[18px] h-[18px]" aria-hidden strokeWidth={1.6} />
          {unreadErrorCount > 0 ? (
            <span
              aria-hidden
              className="absolute -top-[5px] -right-[6px] min-w-[15px] h-[15px] px-[3px] rounded-full flex items-center justify-center"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-paper-card)',
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 600,
                border: '1.5px solid var(--color-paper)',
              }}
            >
              <AlertCircle className="w-[9px] h-[9px] hidden" aria-hidden />
              {unreadErrorCount > 99 ? '99+' : unreadErrorCount}
            </span>
          ) : null}
        </button>

        <ThemeToggle />

        <IconButton label={t('settings.title')} size="md" onClick={() => setView('settings')}>
          <SettingsIcon className="w-[18px] h-[18px]" />
        </IconButton>
      </div>
    </header>
  );
}
