import { useT } from '@ligma/i18n';
import type { DesignSystemRow } from '@ligma/shared';
import { FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useCodesignStore } from '../../store';

function Swatches({ colors }: { colors: string[] }) {
  const shown = colors.slice(0, 8);
  if (shown.length === 0) {
    return (
      <div className="text-[11px] text-[var(--color-text-muted)] italic">No color tokens</div>
    );
  }
  return (
    <div className="flex items-center gap-[4px]">
      {shown.map((c, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: colors are stable within a row
          key={`${c}-${i}`}
          title={c}
          style={{ background: c }}
          className="w-[16px] h-[16px] rounded-[var(--radius-sm)] border border-[var(--color-border-muted)]"
        />
      ))}
      {colors.length > shown.length ? (
        <span className="text-[10px] text-[var(--color-text-muted)]">
          +{colors.length - shown.length}
        </span>
      ) : null}
    </div>
  );
}

export function DesignSystemsTab() {
  const t = useT();
  const [systems, setSystems] = useState<DesignSystemRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const pickDirectory = useCodesignStore((s) => s.pickWorkspaceDirectory);

  const refresh = useCallback(async () => {
    if (!window.codesign?.designSystems) {
      setSystems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await window.codesign.designSystems.list();
      setSystems(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const scanNew = async () => {
    const rootPath = window.prompt(
      'Root path of the design system to scan (absolute path)',
      '',
    );
    if (!rootPath || rootPath.trim().length === 0) return;
    if (!window.codesign?.designSystems) return;
    try {
      const row = await window.codesign.designSystems.scan(rootPath.trim());
      pushToast({
        variant: 'success',
        title: 'Design system scanned',
        description: row.summary,
      });
      await refresh();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Scan failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
    // silence unused-lint on the picker hook — it's reserved for a later
    // directory-picker upgrade.
    void pickDirectory;
  };

  const onRename = async (row: DesignSystemRow) => {
    const name = window.prompt('Rename design system', row.name);
    if (!name || name.trim().length === 0 || name === row.name) return;
    if (!window.codesign?.designSystems) return;
    try {
      await window.codesign.designSystems.rename(row.id, name.trim());
      await refresh();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Rename failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onDelete = async (row: DesignSystemRow) => {
    if (!window.confirm(`Delete design system "${row.name}"? Linked designs stay, unbound.`)) return;
    if (!window.codesign?.designSystems) return;
    try {
      await window.codesign.designSystems.delete(row.id);
      await refresh();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Delete failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <section className="space-y-[var(--space-6)]">
      <header className="flex items-center justify-between gap-[var(--space-4)]">
        <div>
          <h2 className="display text-[var(--text-lg)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)] m-0">
            {t('hub.designSystems.title')}
          </h2>
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)] m-0">
            Scan a repo once; link it to any number of designs from the Sidebar picker.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void scanNew()}
          className="inline-flex items-center gap-[6px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden /> Scan new
        </button>
      </header>

      {loading ? (
        <p className="text-[var(--text-sm)] text-[var(--color-text-muted)]">Loading…</p>
      ) : systems.length === 0 ? (
        <p className="text-[var(--text-sm)] text-[var(--color-text-muted)]">
          No design systems yet. Click "Scan new" to point at a repo.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-[var(--space-4)] grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {systems.map((row) => (
            <li
              key={row.id}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)] space-y-[var(--space-3)]"
            >
              <div className="flex items-start justify-between gap-[var(--space-2)]">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-[var(--color-text-primary)] truncate">
                    {row.name}
                  </div>
                  <div
                    className="text-[11px] text-[var(--color-text-muted)] truncate"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    <FolderOpen className="inline w-3 h-3 mr-[4px]" aria-hidden />
                    {row.rootPath}
                  </div>
                </div>
              </div>
              <p className="text-[12px] text-[var(--color-text-secondary)] leading-[var(--leading-body)] line-clamp-3 m-0">
                {row.summary}
              </p>
              <Swatches colors={row.colors} />
              <div className="flex items-center gap-[var(--space-2)] pt-[var(--space-1)]">
                <button
                  type="button"
                  onClick={() => void onRename(row)}
                  className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(row)}
                  className="inline-flex items-center gap-[4px] text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-danger,#c05050)]"
                >
                  <Trash2 className="w-3 h-3" aria-hidden />
                  Delete
                </button>
                <span className="ml-auto inline-flex items-center gap-[4px] text-[10px] text-[var(--color-text-muted)]">
                  <RefreshCw className="w-3 h-3" aria-hidden />
                  {new Date(row.extractedAt).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
