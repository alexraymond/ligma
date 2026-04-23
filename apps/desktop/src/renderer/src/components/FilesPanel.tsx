import { useT } from '@open-codesign/i18n';
import { FileCode2 } from 'lucide-react';
import { formatAbsoluteTime, formatRelativeTime, useDesignFiles } from '../hooks/useDesignFiles';
import { useCodesignStore } from '../store';

function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function FilesPanel() {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const openFileTab = useCodesignStore((s) => s.openCanvasFileTab);
  const { files, loading } = useDesignFiles(currentDesignId);

  if (!currentDesignId) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('sidebar.noDesign')}
      </div>
    );
  }

  if (loading && files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('common.loading')}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-[var(--space-3)] px-[var(--space-6)] text-center">
        <div className="w-12 h-12 rounded-full border border-dashed border-[var(--color-border)] flex items-center justify-center">
          <FileCode2 className="w-5 h-5 text-[var(--color-text-muted)] opacity-70" aria-hidden />
        </div>
        <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] max-w-sm leading-[var(--leading-body)]">
          {t('canvas.files.empty')}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-[var(--space-6)] py-[var(--space-8)]">
        <header className="mb-[var(--space-4)] flex items-center gap-[var(--space-2)]">
          <h2 className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium m-0">
            {t('canvas.files.sectionTitle')}
          </h2>
          <span
            className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-[5px] rounded-[var(--radius-sm)] bg-[var(--color-background-secondary)] text-[10px] text-[var(--color-text-muted)]"
            style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
          >
            {files.length}
          </span>
        </header>

        <ul className="list-none p-0 m-0 flex flex-col gap-[var(--space-2)]">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => openFileTab(f.path)}
                className="group w-full flex items-center gap-[var(--space-3)] px-[var(--space-4)] h-[52px] text-left rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-[background-color,border-color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)]"
              >
                <FileCode2
                  className="w-[18px] h-[18px] shrink-0 text-[var(--color-text-secondary)]"
                  aria-hidden
                />
                <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                  <span className="truncate text-[var(--text-sm)] text-[var(--color-text-primary)] font-sans leading-[var(--leading-ui)]">
                    {f.path}
                  </span>
                  <span
                    className="text-[11px] text-[var(--color-text-muted)] leading-[var(--leading-ui)]"
                    title={formatAbsoluteTime(f.updatedAt)}
                    style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
                  >
                    {formatBytes(f.size)} · {formatRelativeTime(f.updatedAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
