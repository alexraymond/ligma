import type { DesignSystemRow } from '@ligma/shared';
import { Check, ChevronDown, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCodesignStore } from '../../store';

/**
 * DesignSystemPicker — per-design dropdown that binds the current Design to
 * one of the registered Design Systems (or none). Replaces the old global-
 * config chip that appeared when the user scanned a directory: the selection
 * now lives on the Design row in SQLite.
 *
 * Mount next to WorkspaceChip and FidelityChip in the Sidebar.
 */
export function DesignSystemPicker() {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const loadDesigns = useCodesignStore((s) => s.loadDesigns);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [rows, setRows] = useState<DesignSystemRow[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const design = currentDesignId ? designs.find((d) => d.id === currentDesignId) : undefined;
  const linkedId = design?.designSystemId ?? null;
  const linked = rows.find((r) => r.id === linkedId) ?? null;

  const refresh = useCallback(async () => {
    if (!window.codesign?.designSystems) {
      setRows([]);
      return;
    }
    const out = await window.codesign.designSystems.list();
    setRows(out);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!currentDesignId) return null;

  const setLink = async (id: string | null) => {
    if (!window.codesign?.designSystems) return;
    try {
      await window.codesign.designSystems.linkToDesign(currentDesignId, id);
      await loadDesigns();
      setOpen(false);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Could not link design system',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={linked?.rootPath ?? 'No design system'}
        className={`inline-flex items-center gap-[6px] rounded-full border px-[10px] py-[5px] text-[11px] transition-colors ${
          linked
            ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-muted,transparent)]'
            : 'border-[var(--color-border)] text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <FolderOpen className="w-3.5 h-3.5" aria-hidden />
        <span className="truncate max-w-[180px]">{linked ? linked.name : 'No design system'}</span>
        <ChevronDown className="w-3 h-3" aria-hidden />
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 bottom-full mb-[6px] z-20 min-w-[240px] max-h-[280px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] p-[var(--space-1)]"
        >
          <button
            type="button"
            role="option"
            aria-selected={linkedId === null}
            onClick={() => void setLink(null)}
            className={`flex items-center gap-[var(--space-2)] w-full text-left px-[var(--space-2)] py-[var(--space-1_5)] rounded-[var(--radius-sm)] text-[12px] hover:bg-[var(--color-surface-hover)] ${linkedId === null ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}
          >
            {linkedId === null ? (
              <Check className="w-3 h-3" aria-hidden />
            ) : (
              <span className="w-3" aria-hidden />
            )}
            <span>No design system</span>
          </button>
          {rows.length === 0 ? (
            <p className="px-[var(--space-2)] py-[var(--space-2)] text-[11px] text-[var(--color-text-muted)] italic">
              Scan one from the Design Systems hub tab.
            </p>
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={linkedId === r.id}
                onClick={() => void setLink(r.id)}
                className={`flex items-center gap-[var(--space-2)] w-full text-left px-[var(--space-2)] py-[var(--space-1_5)] rounded-[var(--radius-sm)] text-[12px] hover:bg-[var(--color-surface-hover)] ${linkedId === r.id ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}
                title={r.rootPath}
              >
                {linkedId === r.id ? (
                  <Check className="w-3 h-3" aria-hidden />
                ) : (
                  <span className="w-3" aria-hidden />
                )}
                <span className="truncate">{r.name}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
