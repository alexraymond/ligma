import { useT } from '@ligma/i18n';
import { FolderOpen, LayoutGrid, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from '../store';

function fileTabLabel(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function nextUntitledName(existing: string[]): string {
  const taken = new Set(existing);
  for (let n = 1; n < 1000; n++) {
    const candidate = `untitled-${n}.html`;
    if (!taken.has(candidate)) return candidate;
  }
  return `untitled-${Date.now()}.html`;
}

export function CanvasTabBar() {
  const t = useT();
  const tabs = useCodesignStore((s) => s.canvasTabs);
  const active = useCodesignStore((s) => s.activeCanvasTab);
  const setActive = useCodesignStore((s) => s.setActiveCanvasTab);
  const close = useCodesignStore((s) => s.closeCanvasTab);
  const createFile = useCodesignStore((s) => s.createCanvasFile);
  const designId = useCodesignStore((s) => s.currentDesignId);
  const setCurrentFilePath = useCodesignStore((s) => s.setCurrentFilePath);
  const [busy, setBusy] = useState(false);

  if (tabs.length === 0) return null;

  const existingPaths = tabs
    .filter((x): x is { kind: 'file'; path: string } => x.kind === 'file')
    .map((x) => x.path);

  return (
    <div
      role="tablist"
      aria-label={t('canvas.tabsAriaLabel')}
      className="flex items-stretch min-w-0"
    >
      {tabs.map((tab, index) => {
        const isActive = index === active;
        const isFiles = tab.kind === 'files';
        const isWall = tab.kind === 'wall';
        const path = tab.kind === 'file' ? tab.path : null;
        const label = isFiles
          ? t('canvas.filesTab')
          : isWall
            ? 'Wall'
            : fileTabLabel(path as string);
        const title = isFiles
          ? t('canvas.filesTab')
          : isWall
            ? 'All designs on one canvas'
            : (path as string);
        const key: string = isFiles ? 'files' : isWall ? 'wall' : `file:${path as string}`;
        const closable = !isFiles && !isWall;
        return (
          <div
            key={key}
            role="tab"
            aria-selected={isActive}
            className={`group relative flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[7px] text-[12px] transition-colors duration-[var(--duration-faster)] ${
              isActive
                ? 'text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setActive(index);
                if (path && designId) setCurrentFilePath(designId, path);
              }}
              title={title}
              className="flex items-center gap-[var(--space-1_5)] focus:outline-none"
            >
              {isFiles ? <FolderOpen className="w-3.5 h-3.5 opacity-80" aria-hidden /> : null}
              {isWall ? <LayoutGrid className="w-3.5 h-3.5 opacity-80" aria-hidden /> : null}
              <span
                className="truncate max-w-[220px]"
                style={isFiles || isWall ? undefined : { fontFamily: 'var(--font-mono)' }}
              >
                {label}
              </span>
            </button>
            {closable ? (
              <button
                type="button"
                onClick={() => close(index)}
                aria-label={t('canvas.closeTab', { name: label })}
                className="p-[2px] text-[var(--color-text-muted)] opacity-50 hover:opacity-100 hover:text-[var(--color-text-primary)] transition-opacity"
              >
                <X className="w-3 h-3" aria-hidden />
              </button>
            ) : null}
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-[var(--space-2)] bottom-[-1px] h-[1.5px] bg-[var(--color-accent)]"
              />
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        disabled={!designId || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const name = window.prompt('New file name', nextUntitledName(existingPaths));
            if (!name || name.trim().length === 0) return;
            await createFile(name.trim(), '');
          } finally {
            setBusy(false);
          }
        }}
        title="New file"
        aria-label="New file"
        className="flex items-center justify-center px-[var(--space-2)] py-[7px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden />
      </button>
    </div>
  );
}
