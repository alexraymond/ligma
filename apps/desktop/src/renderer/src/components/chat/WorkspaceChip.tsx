import { FolderOpen, X } from 'lucide-react';
import { basename } from '../../lib/path-basename';
import { useCodesignStore } from '../../store';

/**
 * Per-chat workspace indicator. Shows the current `cwd` (or a "pick
 * directory" affordance) that scopes Claude's filesystem tools. Clicking
 * the chip opens the OS folder picker; clicking the X clears the scope.
 *
 * Visible only when a design is active — no workspace concept outside a
 * chat. When no cwd is set, the chip reads "No workspace" and tapping
 * it behaves like the "set" action.
 */
export function WorkspaceChip() {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const workspaceByDesign = useCodesignStore((s) => s.workspaceByDesign);
  const pickWorkspaceDirectory = useCodesignStore((s) => s.pickWorkspaceDirectory);
  const setWorkspaceForDesign = useCodesignStore((s) => s.setWorkspaceForDesign);

  if (currentDesignId === null) return null;

  const workspace = workspaceByDesign[currentDesignId] ?? null;
  const cwd = workspace?.cwd ?? null;
  const label = cwd !== null ? basename(cwd) : 'No workspace';
  const titleAttr = cwd ?? 'Click to pick a workspace directory';

  const onPick = (): void => {
    if (currentDesignId !== null) void pickWorkspaceDirectory(currentDesignId);
  };

  const onClear = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (currentDesignId !== null) void setWorkspaceForDesign(currentDesignId, null);
  };

  return (
    <button
      type="button"
      onClick={onPick}
      title={titleAttr}
      className="inline-flex max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[10px] py-[5px] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors"
    >
      <FolderOpen className="w-[12px] h-[12px] shrink-0" aria-hidden />
      <span className="truncate max-w-[220px]">{label}</span>
      {cwd !== null ? (
        <span
          role="button"
          aria-label="Clear workspace"
          tabIndex={0}
          onClick={onClear}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onClear(e as unknown as React.MouseEvent);
          }}
          className="inline-flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
        >
          <X className="w-3 h-3" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}
