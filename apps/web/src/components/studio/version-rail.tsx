'use client';

/**
 * The version rail — new in this product, absent from both parents.
 *
 * "New: a version rail per design (content-addressed snapshots already exist in
 * the engine) — restore, and side-by-side before/after compare. Both parent
 * products lack this; an iteration tool without memory is half a tool" (UX spec
 * F4). It is built on the daemon's content-addressed snapshots, not on a port
 * of ligma-classic's SQLite `design_snapshots` table — studio map finding #2
 * says that table is the wrong system to carry forward.
 *
 * Restore appends rather than rewrites: the version you restored away from
 * stays on the rail. That is the difference between a rail and an undo button.
 *
 * OD-049: each version can also expand to list its files and view one
 * syntax-highlighted, via `onLoadFiles` — the `/files?versionId=` route reads
 * off the same content-addressed store the compare pair does, so an older
 * version's source is exactly as available as the head's.
 */

import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import type { DesignFileBody, DesignSnapshotSummary } from '@ligma/api';
import { ChevronDown, ChevronRight, FileCode, GitCompare, History, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { comparePair, toggleCompare, versionTimeLabel } from './api';
import { CodeView } from './code-view';

const ORIGIN_LABEL: Record<DesignSnapshotSummary['origin'], string> = {
  initial: 'initial',
  prompt: 'prompt',
  'comment-apply': 'pins',
  tweak: 'tweak',
  restore: 'restore',
};

export interface VersionRailProps {
  snapshots: DesignSnapshotSummary[];
  /** Version ids picked for the before/after compare (0, 1 or 2 of them). */
  compareSelection: string[];
  onCompareSelectionChange: (selection: string[]) => void;
  onRestore: (versionId: string) => void;
  /** Renders the two versions side by side; the Studio supplies the previews. */
  renderCompare: (before: DesignSnapshotSummary, after: DesignSnapshotSummary) => React.ReactNode;
  /** Fetches one version's file bodies for the code viewer. Omit to hide the
   * "Files" disclosure entirely (e.g. a host with no `/files` route yet). */
  onLoadFiles?: (versionId: string) => Promise<DesignFileBody[]>;
  disabled?: boolean;
}

export function VersionRail({
  snapshots,
  compareSelection,
  onCompareSelectionChange,
  onRestore,
  renderCompare,
  onLoadFiles,
  disabled,
}: VersionRailProps) {
  const pair = comparePair(compareSelection, snapshots);
  const ordered = [...snapshots].sort((a, b) => b.n - a.n);

  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [filesByVersion, setFilesByVersion] = useState<Record<string, DesignFileBody[]>>({});
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null);

  const toggleFiles = async (versionId: string): Promise<void> => {
    if (expandedVersion === versionId) {
      setExpandedVersion(null);
      return;
    }
    setExpandedVersion(versionId);
    setOpenFilePath(null);
    if (filesByVersion[versionId] || !onLoadFiles) return;
    setLoadingVersion(versionId);
    try {
      const files = await onLoadFiles(versionId);
      setFilesByVersion((prev) => ({ ...prev, [versionId]: files }));
    } finally {
      setLoadingVersion((current) => (current === versionId ? null : current));
    }
  };

  return (
    <aside aria-label="Version rail" className="flex w-60 shrink-0 flex-col border-l">
      <header className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <History className="h-4 w-4" aria-hidden />
        Versions
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {snapshots.length}
        </span>
      </header>

      <ol className="flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <li className="px-3 py-4 text-xs text-muted-foreground">No versions yet.</li>
        ) : null}
        {ordered.map((snapshot) => {
          const picked = compareSelection.includes(snapshot.versionId);
          const { relative, absolute } = versionTimeLabel(snapshot.createdAt);
          return (
            <li key={snapshot.versionId} className="border-b last:border-b-0">
              <div className="flex items-start gap-2 px-3 py-2">
                <button
                  type="button"
                  aria-pressed={picked}
                  aria-label={`Compare v${snapshot.n}`}
                  onClick={() =>
                    onCompareSelectionChange(toggleCompare(compareSelection, snapshot.versionId))
                  }
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border text-[9px] leading-none ${picked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}
                >
                  {picked ? '✓' : ''}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs tabular-nums">v{snapshot.n}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {ORIGIN_LABEL[snapshot.origin]}
                    </span>
                  </div>
                  <p className="truncate text-xs" title={snapshot.label}>
                    {snapshot.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground" title={absolute}>
                    {snapshot.fileCount} file{snapshot.fileCount === 1 ? '' : 's'} ·{' '}
                    {Math.round(snapshot.totalBytes / 1024)} KB · {relative}
                  </p>
                </div>
                {onLoadFiles ? (
                  <Tip content="View this version's files">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label={`${expandedVersion === snapshot.versionId ? 'Hide' : 'View'} v${snapshot.n} files`}
                      onClick={() => void toggleFiles(snapshot.versionId)}
                    >
                      {expandedVersion === snapshot.versionId ? (
                        <ChevronDown className="h-3 w-3" aria-hidden />
                      ) : (
                        <FileCode className="h-3 w-3" aria-hidden />
                      )}
                    </Button>
                  </Tip>
                ) : null}
                <Tip content="Restore this version (appends a new one)">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={disabled}
                    aria-label={`Restore v${snapshot.n}`}
                    onClick={() => onRestore(snapshot.versionId)}
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden />
                  </Button>
                </Tip>
              </div>

              {expandedVersion === snapshot.versionId ? (
                <div className="border-t bg-muted/30 px-3 py-2">
                  {loadingVersion === snapshot.versionId ? (
                    <p className="text-[11px] text-muted-foreground">Loading files…</p>
                  ) : (filesByVersion[snapshot.versionId]?.length ?? 0) === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      preview unavailable — no source route
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {filesByVersion[snapshot.versionId]!.map((file) => (
                        <li key={file.path}>
                          <button
                            type="button"
                            onClick={() =>
                              setOpenFilePath((current) =>
                                current === file.path ? null : file.path,
                              )
                            }
                            className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left font-mono text-[10px] hover:bg-muted"
                          >
                            {openFilePath === file.path ? (
                              <ChevronDown className="h-2.5 w-2.5 shrink-0" aria-hidden />
                            ) : (
                              <ChevronRight className="h-2.5 w-2.5 shrink-0" aria-hidden />
                            )}
                            <span className="truncate" title={file.path}>
                              {file.path}
                            </span>
                          </button>
                          {openFilePath === file.path ? (
                            <div className="mt-1">
                              <CodeView path={file.path} body={file.body} />
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {pair ? (
        <div className="border-t p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
            <GitCompare className="h-3.5 w-3.5" aria-hidden />v{pair.before.n} → v{pair.after.n}
          </p>
          {renderCompare(pair.before, pair.after)}
        </div>
      ) : compareSelection.length === 1 ? (
        <p className="border-t p-3 text-[11px] text-muted-foreground">
          Pick a second version to compare.
        </p>
      ) : null}
    </aside>
  );
}
