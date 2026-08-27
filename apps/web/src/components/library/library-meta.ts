'use client';

/**
 * Client side of the Library's use-tracking and bookmarks (OD-156/157).
 */

import { apiFetch } from '@/lib/api-client';
import { API_ROUTES } from '@ligma/api';
import type {
  LibraryCatalogKind,
  LibraryMetaEntry,
  LibraryMetaResponse,
  SkillFacetEntry,
  SkillFacetsResponse,
} from '@ligma/api';
import { useCallback, useEffect, useState } from 'react';

const LIBRARY_META = API_ROUTES.libraryMeta;
const LIBRARY_META_USE = API_ROUTES.libraryMetaUse;
const LIBRARY_META_BOOKMARK = API_ROUTES.libraryMetaBookmark;
const LIBRARY_META_FACETS = API_ROUTES.libraryMetaFacets;

async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchLibraryMeta(): Promise<LibraryMetaEntry[]> {
  return (await getJson<LibraryMetaResponse>(LIBRARY_META)).entries;
}

export function recordLibraryUse(kind: LibraryCatalogKind, id: string): Promise<LibraryMetaEntry> {
  return postJson(LIBRARY_META_USE, { kind, id });
}

export function setLibraryBookmark(
  kind: LibraryCatalogKind,
  id: string,
  saved: boolean,
): Promise<LibraryMetaEntry> {
  return postJson(LIBRARY_META_BOOKMARK, { kind, id, saved });
}

export async function fetchSkillFacets(): Promise<SkillFacetEntry[]> {
  return (await getJson<SkillFacetsResponse>(LIBRARY_META_FACETS)).skills;
}

/** `${kind}:${id}` — the same key the daemon store uses, so a lookup is one string compare. */
export function metaKey(kind: LibraryCatalogKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Use counts and bookmarks for one kind, loaded once and updated optimistically
 * — a bookmark star that waited for the round trip would feel broken.
 */
export function useLibraryMeta(kind: LibraryCatalogKind): {
  metaFor: (id: string) => { useCount: number; saved: boolean };
  toggleSaved: (id: string) => void;
  recordUse: (id: string) => void;
} {
  const [byKey, setByKey] = useState<Record<string, { useCount: number; saved: boolean }>>({});

  useEffect(() => {
    let live = true;
    fetchLibraryMeta()
      .then((entries) => {
        if (!live) return;
        const next: Record<string, { useCount: number; saved: boolean }> = {};
        for (const entry of entries)
          next[metaKey(entry.kind, entry.id)] = { useCount: entry.useCount, saved: entry.saved };
        setByKey(next);
      })
      .catch(() => {
        // ponytail: a Library that can't reach its own meta store still browses
        // — every count/star just reads as its zero state, not an error banner.
      });
    return () => {
      live = false;
    };
  }, []);

  const metaFor = useCallback(
    (id: string) => byKey[metaKey(kind, id)] ?? { useCount: 0, saved: false },
    [byKey, kind],
  );

  const toggleSaved = useCallback(
    (id: string) => {
      const next = !metaFor(id).saved;
      setByKey((prev) => ({
        ...prev,
        [metaKey(kind, id)]: { useCount: metaFor(id).useCount, saved: next },
      }));
      setLibraryBookmark(kind, id, next).catch(() => {
        // Revert on failure — an optimistic star that lies is worse than a slow one.
        setByKey((prev) => ({
          ...prev,
          [metaKey(kind, id)]: { useCount: metaFor(id).useCount, saved: !next },
        }));
      });
    },
    [kind, metaFor],
  );

  const recordUseFn = useCallback(
    (id: string) => {
      setByKey((prev) => {
        const current = prev[metaKey(kind, id)] ?? { useCount: 0, saved: false };
        return { ...prev, [metaKey(kind, id)]: { ...current, useCount: current.useCount + 1 } };
      });
      recordLibraryUse(kind, id).catch(() => {
        // Non-fatal: the count is a ranking signal, not a ledger — a dropped
        // beacon costs a slightly stale rank, not a broken feature.
      });
    },
    [kind],
  );

  return { metaFor, toggleSaved, recordUse: recordUseFn };
}
