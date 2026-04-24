import { useT } from '@ligma/i18n';
import type { DesignSystemRow } from '@ligma/shared';
import { FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useCodesignStore } from '../store';

function Swatches({ colors }: { colors: string[] }): ReactElement {
  const shown = colors.slice(0, 8);
  if (shown.length === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-hand)',
          fontSize: 15,
          fontStyle: 'italic',
          color: 'var(--color-text-muted)',
        }}
      >
        No color tokens
      </div>
    );
  }
  return (
    <div className="flex items-center gap-[4px]">
      {shown.map((c, i) => (
        <span
          key={`${c}-${i}`}
          title={c}
          style={{
            background: c,
            width: 18,
            height: 18,
            borderRadius: 3,
            border: '1px solid var(--color-rule)',
            display: 'inline-block',
          }}
        />
      ))}
      {colors.length > shown.length ? (
        <span
          style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}
        >
          +{colors.length - shown.length}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Paper-sketchbook Design Systems view — sibling of Home & Settings. Lists
 * scanned design systems as tape-pinned cards with swatch rows, summary,
 * rootPath, and rename/delete actions. Replaces the old DesignSystemsTab.
 */
export function DesignSystemsView(): ReactElement {
  const t = useT();
  const [systems, setSystems] = useState<DesignSystemRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const pushToast = useCodesignStore((s) => s.pushToast);

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
    if (!window.codesign?.workspace || !window.codesign?.designSystems) return;
    const rootPath = await window.codesign.workspace.pickDirectory();
    if (rootPath === null) return;
    try {
      const row = await window.codesign.designSystems.scan(rootPath);
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
    if (!window.confirm(`Delete design system "${row.name}"? Linked designs stay, unbound.`))
      return;
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px]" style={{ padding: '16px 30px 20px 32px' }}>
        <header
          className="flex items-baseline justify-between gap-[var(--space-4)]"
          style={{ marginBottom: 14 }}
        >
          <h2
            className="ligma-pencil-oval m-0"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.24em',
              color: 'var(--color-text-primary)',
            }}
          >
            {t('hub.tabs.designSystems')}
          </h2>
          <button
            type="button"
            onClick={() => void scanNew()}
            className="inline-flex items-center gap-[6px]"
            style={{
              padding: '6px 12px',
              borderRadius: 3,
              border: '1px solid var(--color-accent)',
              color: 'var(--color-accent)',
              background: 'var(--color-paper-card)',
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: 'var(--shadow-tilt-badge)',
              transform: 'rotate(-0.8deg)',
            }}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> Scan new
          </button>
        </header>

        {loading ? (
          <p
            style={{
              fontFamily: 'var(--font-hand)',
              fontSize: 18,
              fontStyle: 'italic',
              color: 'var(--color-text-muted)',
            }}
          >
            Loading…
          </p>
        ) : systems.length === 0 ? (
          <p
            style={{
              fontFamily: 'var(--font-hand)',
              fontSize: 20,
              fontStyle: 'italic',
              color: 'var(--color-text-secondary)',
              maxWidth: 560,
              lineHeight: 1.4,
            }}
          >
            No design systems yet. Click "Scan new" to point at a repo.
          </p>
        ) : (
          <ul
            className="list-none p-0 m-0"
            style={{
              display: 'grid',
              gap: 18,
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {systems.map((row, i) => (
              <li
                key={row.id}
                style={{
                  position: 'relative',
                  background: 'var(--color-paper-card)',
                  border: '1px solid var(--color-pencil-faint)',
                  padding: '12px 14px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: 'var(--shadow-card)',
                  transform: `rotate(${(i % 2 === 0 ? -0.6 : 0.8).toString()}deg)`,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: -4,
                    left: '50%',
                    marginLeft: -11,
                    width: 22,
                    height: 8,
                    background: 'var(--color-accent)',
                    opacity: 0.9,
                    transform: `rotate(${i % 2 === 0 ? -5 : 4}deg)`,
                    boxShadow: 'var(--shadow-tape)',
                  }}
                />
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 17,
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    lineHeight: 1.1,
                  }}
                  className="truncate"
                >
                  {row.name}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--color-text-muted)',
                  }}
                  className="truncate"
                >
                  <FolderOpen className="inline w-3 h-3 mr-[4px]" aria-hidden />
                  {row.rootPath}
                </div>
                <p
                  className="m-0 line-clamp-3"
                  style={{
                    fontFamily: 'var(--font-hand)',
                    fontSize: 16,
                    fontStyle: 'italic',
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.25,
                  }}
                >
                  {row.summary}
                </p>
                <Swatches colors={row.colors} />
                <div
                  className="flex items-center gap-[var(--space-3)]"
                  style={{
                    paddingTop: 6,
                    borderTop: '1px dashed var(--color-rule)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void onRename(row)}
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(row)}
                    className="inline-flex items-center gap-[4px]"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 className="w-3 h-3" aria-hidden />
                    Delete
                  </button>
                  <span
                    className="ml-auto inline-flex items-center gap-[4px]"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden />
                    {new Date(row.extractedAt).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
