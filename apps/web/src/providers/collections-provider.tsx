'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { type CollectionSnapshot, CollectionStore, UNLOADED } from './collection-store';

/**
 * The React face of `CollectionStore`: one cache for the always-on collections
 * (tasks, projects, decisions, the Deck queue, runs — plus every other
 * `useDataResource` endpoint, which now costs one request instead of one per
 * mount), and one `invalidate()` for mutations to name what they changed.
 *
 * Hooks keep their existing signatures; they just read through here, so call
 * sites didn't have to change to get shared state and cross-surface refresh.
 */

// One cache per browser tab. The provider exists to scope its lifetime and to
// let a test hand in its own store; a hook used outside the provider falls back
// to this instance rather than throwing, so no surface can lose its data by
// rendering above the shell.
const defaultStore = new CollectionStore();

const CollectionsContext = createContext<CollectionStore | null>(null);

export function CollectionsProvider({
  children,
  store,
}: { children: ReactNode; store?: CollectionStore }) {
  return (
    <CollectionsContext.Provider value={store ?? defaultStore}>
      {children}
    </CollectionsContext.Provider>
  );
}

export function useCollectionStore(): CollectionStore {
  return useContext(CollectionsContext) ?? defaultStore;
}

export interface CollectionResult<T> extends CollectionSnapshot<T> {
  /** Re-read this collection (and anything derived from it) now. */
  refetch: () => Promise<void>;
}

/**
 * Read a collection by the URL that produces it. `intervalMs` polls it —
 * paused while the tab is hidden, deduped across mounts, and shared: two
 * components asking for the same key get one request and one interval.
 */
export function useCollection<T>(
  key: string,
  fetcher: () => Promise<T>,
  intervalMs?: number,
): CollectionResult<T> {
  const store = useCollectionStore();

  // The fetcher is a fresh closure every render; the store holds a stable
  // indirection to the latest one so re-rendering never re-subscribes.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback(
    (listener: () => void) =>
      store.subscribe(key, () => fetcherRef.current(), intervalMs, listener),
    [store, key, intervalMs],
  );

  const snapshot = useSyncExternalStore(
    subscribe,
    () => store.getSnapshot<T>(key),
    () => UNLOADED as CollectionSnapshot<T>,
  );

  const refetch = useCallback(() => store.invalidate(key), [store, key]);

  return useMemo(() => ({ ...snapshot, refetch }), [snapshot, refetch]);
}

/**
 * The mutation side: `invalidate("/api/tasks", "/api/deck")` after a write, and
 * every surface reading those re-renders. Keys are the request URLs.
 */
export function useInvalidate(): (...keys: string[]) => Promise<void> {
  const store = useCollectionStore();
  return useCallback((...keys: string[]) => store.invalidate(...keys), [store]);
}
