'use client';

/**
 * DesignFilesPanel — per-project uploaded design files (OD-138).
 *
 * Reuses References' store and upload machinery (one JSON file, two views —
 * see `../../../daemon/src/routes/references/store.ts`'s docblock): this panel
 * is `workspace.json.designFiles` rendered as a list rather than a card grid,
 * because a file list wants a name and a size, not a preview-first layout.
 */

import { ErrorState } from '@/components/error-state';
import { WidgetSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { showError } from '@/lib/toast';
import { FileUp, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_DESIGN_FILE_BYTES,
  formatBytes,
  readFileAsDataUrl,
  validateFileSize,
} from './file-upload';
import {
  type DesignFileItem,
  deleteDesignFile,
  listDesignFiles,
  uploadDesignFile,
} from './workspace-api';

export function DesignFilesPanel({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<DesignFileItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setFiles(await listDesignFiles(projectId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    const tooBig = validateFileSize(file, MAX_DESIGN_FILE_BYTES);
    if (tooBig) {
      showError(`File too large — ${tooBig}`);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setFiles(await uploadDesignFile(projectId, file.name, dataUrl));
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteDesignFile(projectId, id);
      setFiles((prev) => prev?.filter((f) => f.id !== id) ?? prev);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (files === null) return <WidgetSkeleton rows={3} />;

  return (
    <div className="space-y-4" data-testid="design-files-panel">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          <FileUp className="size-3.5" /> Upload a design file
        </Button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No design files uploaded yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)} · {file.mime}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(file.id)}
                aria-label={`Delete ${file.name}`}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
