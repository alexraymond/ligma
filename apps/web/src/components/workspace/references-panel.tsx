'use client';

/**
 * ReferencesPanel — the project's reference/mood-board (OD-048, OD-137).
 *
 * A grid of cards: saved links show as title + domain (no favicon fetch, no
 * re-scraping on read — the title was scraped once, server-side, at add
 * time), user screenshots render inline from the `data:` URI the daemon
 * already stored. Deleting is the only mutation besides adding; there is no
 * edit, same as a mood board has no "rename this pin".
 */

import { ErrorState } from '@/components/error-state';
import { WidgetSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { showError } from '@/lib/toast';
import { ImagePlus, Link2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_IMAGE_BYTES, readFileAsDataUrl, validateFileSize } from './file-upload';
import {
  type ReferenceItem,
  addLinkReference,
  addScreenshotReference,
  deleteReference,
  listReferences,
} from './workspace-api';

export function ReferencesPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listReferences(projectId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addLink() {
    const url = urlDraft.trim();
    if (!url || busy) return;
    setBusy(true);
    try {
      setItems(await addLinkReference(projectId, url));
      setUrlDraft('');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addScreenshot(file: File) {
    const tooBig = validateFileSize(file, MAX_IMAGE_BYTES);
    if (tooBig) {
      showError(`Screenshot too large — ${tooBig}`);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setItems(await addScreenshotReference(projectId, dataUrl));
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteReference(projectId, id);
      setItems((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (items === null) return <WidgetSkeleton rows={3} />;

  return (
    <div className="space-y-4" data-testid="references-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addLink()}
          placeholder="https://…"
          className="max-w-sm"
          disabled={busy}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void addLink()}
          disabled={busy || !urlDraft.trim()}
        >
          <Link2 className="size-3.5" /> Save link
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          <ImagePlus className="size-3.5" /> Add screenshot
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void addScreenshot(file);
          }}
        />
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No references yet — save a link or drop in a screenshot.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <ReferenceCard key={item.id} item={item} onDelete={() => void remove(item.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReferenceCard({ item, onDelete }: { item: ReferenceItem; onDelete: () => void }) {
  return (
    <Card className="group relative overflow-hidden">
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete reference"
        className="absolute right-1.5 top-1.5 z-10 rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
      {item.kind === 'screenshot' ? (
        // Inline data: URI — never re-fetched, matches what the daemon stored.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.dataUrl}
          alt={item.note || 'Screenshot'}
          className="aspect-video w-full object-cover"
        />
      ) : (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="flex aspect-video w-full flex-col items-center justify-center gap-1 bg-muted px-3 text-center"
        >
          <Link2 className="size-4 text-muted-foreground" />
        </a>
      )}
      <CardContent className="space-y-0.5 p-2.5">
        {item.kind === 'link' ? (
          <>
            <p className="truncate text-xs font-medium" title={item.title}>
              {item.title}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{item.domain}</p>
          </>
        ) : (
          <p className="truncate text-xs text-muted-foreground">{item.note || 'Screenshot'}</p>
        )}
      </CardContent>
    </Card>
  );
}
