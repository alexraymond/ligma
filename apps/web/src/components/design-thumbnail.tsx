'use client';

import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { DesignFilesResponse } from '@ligma/api';
import { useEffect, useState } from 'react';

/**
 * The design region a task realises, on the board card (UX spec §6 Board).
 *
 * A static scaled image, deliberately — **not** an iframe from the Studio pool.
 * The Wall needs live iframes because it is a canvas you interact with; a board
 * card needs a picture of what is being built, and forty live iframes to draw
 * forty thumbnails is the opposite of "keep state warm".
 *
 * Design bodies are served as text rather than bytes, so the source is the same
 * data-URI trick the Deck's design-approval card already uses. A design whose
 * files are not renderable as an image (JSX, HTML) simply has no thumbnail —
 * an empty space is honest, a broken image is not.
 *
 * ponytail: one in-memory promise per (project, design) so a column of cards
 * from one design costs one fetch. It lives for the page's lifetime; upgrade to
 * a real cache with invalidation if design bodies ever change under a board.
 */
const cache = new Map<string, Promise<string | null>>();

function isImage(path: string): boolean {
  return /\.svg$/i.test(path);
}

async function load(
  projectId: string,
  designId: string,
  preferred: string[],
): Promise<string | null> {
  const key = `${projectId}:${designId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const promise = (async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/designs/${designId}/files`);
      if (!res.ok) return null;
      const body = (await res.json()) as DesignFilesResponse;
      // The task's own region first; any renderable file second, so a task that
      // names an unrenderable path still shows what the design looks like.
      const file =
        body.files.find((f) => preferred.includes(f.path) && isImage(f.path)) ??
        body.files.find((f) => isImage(f.path));
      return file ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.body)}` : null;
    } catch {
      // A thumbnail is an enrichment; failing to fetch it must not break a card.
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}

export function DesignThumbnail({
  projectId,
  designId,
  designFilePaths,
  className,
}: {
  projectId: string | null;
  designId: string | null | undefined;
  designFilePaths: string[] | undefined;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const paths = (designFilePaths ?? []).join(',');

  useEffect(() => {
    if (!projectId || !designId) return;
    let live = true;
    void load(projectId, designId, paths ? paths.split(',') : []).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [projectId, designId, paths]);

  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a data: URI, not a remote asset
    <img
      src={src}
      alt=""
      aria-hidden
      className={cn('h-14 w-full rounded border bg-white object-cover object-top', className)}
    />
  );
}
