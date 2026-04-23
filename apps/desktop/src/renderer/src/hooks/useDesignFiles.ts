import type { DesignFile } from '@ligma/shared';
import { useCallback, useEffect, useState } from 'react';
import { useCodesignStore } from '../store';

export type DesignFileKind = 'html' | 'asset';

export interface DesignFileEntry {
  path: string;
  kind: DesignFileKind;
  updatedAt: string;
  size?: number;
}

export interface UseDesignFilesResult {
  files: DesignFileEntry[];
  loading: boolean;
  backend: 'snapshots' | 'files-ipc';
  refresh: () => Promise<void>;
}

function kindForPath(path: string): DesignFileKind {
  return /\.(html?|jsx?|tsx?|svg)$/i.test(path) ? 'html' : 'asset';
}

function toEntry(file: DesignFile): DesignFileEntry {
  return {
    path: file.path,
    kind: kindForPath(file.path),
    updatedAt: file.updatedAt,
    size: file.content.length,
  };
}

/**
 * Reads the design's virtual-FS rows via `files:v1:list` when the IPC
 * namespace is registered, and otherwise synthesizes a single `index.html`
 * entry from the current preview so callers that mount before IPC is up
 * still render something. Refreshes on `previewHtml` changes and
 * `filesRefreshCounter` bumps so successful generations show up
 * immediately.
 */
export function useDesignFiles(designId: string | null): UseDesignFilesResult {
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const designs = useCodesignStore((s) => s.designs);
  const refreshCounter = useCodesignStore((s) => s.filesRefreshCounter);
  const [files, setFiles] = useState<DesignFileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const filesIpcAvailable =
    typeof window !== 'undefined' &&
    Boolean((window.codesign as unknown as { files?: unknown })?.files);

  const refresh = useCallback(async () => {
    if (!designId || !window.codesign) {
      setFiles([]);
      return;
    }
    if (!filesIpcAvailable) {
      if (previewHtml) {
        const design = designs.find((d) => d.id === designId);
        const updatedAt = design?.updatedAt ?? new Date().toISOString();
        setFiles([
          {
            path: 'index.html',
            kind: 'html',
            updatedAt,
            size: previewHtml.length,
          },
        ]);
      } else {
        setFiles([]);
      }
      return;
    }
    setLoading(true);
    try {
      const rows = await window.codesign.files.list(designId);
      setFiles(rows.map(toEntry));
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [designId, designs, filesIpcAvailable, previewHtml]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshCounter]);

  return {
    files,
    loading,
    backend: filesIpcAvailable ? 'files-ipc' : 'snapshots',
    refresh,
  };
}

// Format an ISO timestamp as "22h ago" / "3d ago". Pure for testability.
export function formatRelativeTime(isoTime: string, now: Date = new Date()): string {
  const then = new Date(isoTime).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Math.max(0, now.getTime() - then);
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

// Precise tooltip form: "Modified Apr 20, 2026, 14:32".
export function formatAbsoluteTime(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
