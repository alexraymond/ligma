import { SmartPollScheduler } from '@/hooks/use-smart-poll';

/**
 * One cache for the collections every surface derives from, keyed by the URL
 * that produces them.
 *
 * The app had 29 independent fetch mechanisms and no invalidation model, so a
 * mutation refreshed the one hook that owned the thing it changed and the three
 * hooks deriving from it never heard about it (answers left the rail badge
 * frozen, promote refreshed nothing, Home's "needs you" was frozen at page
 * load). Every call site keeping its own state and its own interval also
 * multiplied identical requests — four `useAgents()` mounts meant four
 * `GET /api/agents`.
 *
 * This is the cache, not a data library: one entry per key, one in-flight fetch
 * per key regardless of how many components mount the hook, one poller per key
 * (visibility-paused, backing off on failure via the existing
 * `SmartPollScheduler`), and an explicit `invalidate()` mutations call.
 *
 * Deliberately DOM-free apart from the two `visibilitychange` lines, for the
 * reason `use-smart-poll.ts` states: this repo's vitest config runs in the
 * "node" environment, so the logic has to be reachable without a render.
 */

/**
 * What a collection currently is. `data` is the last *confirmed* value and
 * stays put when a read fails — "could not read it" and "there is nothing" are
 * different claims (`project-health-board.tsx`'s rule), so a failure shows up
 * in `error` with the previous data intact, never as an empty result.
 */
export interface CollectionSnapshot<T> {
  /** Last confirmed value; `null` until one arrives. Never reset by a failure. */
  data: T | null;
  /** True until the first fetch settles — success or failure. */
  loading: boolean;
  /** Last failure, or null. Cleared by the next successful read. */
  error: string | null;
}

/** Stable identity so `useSyncExternalStore` doesn't loop on unknown keys. */
export const UNLOADED: CollectionSnapshot<never> = Object.freeze({
  data: null,
  loading: true,
  error: null,
});

/**
 * Collections the daemon composes out of another one: invalidating the key on
 * the left must re-read the keys on the right, or the derived surface keeps
 * rendering the pre-mutation answer. `GET /api/deck` folds decisions into the
 * Deck queue, which is what the rail badge and Home's "needs you" count.
 */
const DERIVED: Readonly<Record<string, readonly string[]>> = {
  '/api/decisions': ['/api/deck', '/api/dashboard'],
  '/api/tasks': ['/api/dashboard'],
};

type Fetcher = () => Promise<unknown>;

interface Entry {
  fetch: Fetcher;
  snapshot: CollectionSnapshot<unknown>;
  /** Each live mount and the interval it wants; the fastest one wins. */
  listeners: Map<() => void, number | undefined>;
  inflight: Promise<void> | null;
  scheduler: SmartPollScheduler | null;
  /** Interval the running scheduler was built with, so changes restart it. */
  pollingAt: number | undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export class CollectionStore {
  private readonly entries = new Map<string, Entry>();
  private detachVisibility: (() => void) | null = null;

  /**
   * Subscribe a mount to `key`, registering the fetcher on first use. Starting
   * a poller fires immediately; an unpolled collection is re-read by every new
   * mount, which is the fetch-on-mount every hook used to do — deduped, so
   * mounting the same collection four times in one render is one request.
   */
  subscribe(
    key: string,
    fetch: Fetcher,
    intervalMs: number | undefined,
    listener: () => void,
  ): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        fetch,
        snapshot: UNLOADED,
        listeners: new Map(),
        inflight: null,
        scheduler: null,
        pollingAt: undefined,
      };
      this.entries.set(key, entry);
    } else {
      // Same key means the same request, so the latest mount's closure is as
      // good as the first one's — and it can't go stale behind an unmount.
      entry.fetch = fetch;
    }
    const target = entry;

    target.listeners.set(listener, intervalMs);
    const started = this.syncScheduler(key, target);
    // A started scheduler has already fired; otherwise this mount reads now.
    if (!started && target.scheduler === null) void this.refresh(key);

    return () => {
      target.listeners.delete(listener);
      this.syncScheduler(key, target);
      if (target.listeners.size > 0) return;
      // Drop the entry once nothing renders it, so per-project and per-task
      // keys don't pile up for the life of the tab. Deferred a tick because
      // React re-subscribes by unsubscribing first *in the same commit* when
      // the interval changes — evicting synchronously would blank a collection
      // that is about to be subscribed again.
      setTimeout(() => {
        if (this.entries.get(key) === target && target.listeners.size === 0) {
          this.entries.delete(key);
        }
      }, 0);
    };
  }

  getSnapshot<T>(key: string): CollectionSnapshot<T> {
    const entry = this.entries.get(key);
    return (entry?.snapshot ?? UNLOADED) as CollectionSnapshot<T>;
  }

  /** Re-read `key` now. A read already in flight is joined, not duplicated. */
  refresh(key: string): Promise<void> {
    const entry = this.entries.get(key);
    // Nothing is rendering it: whatever mounts next reads it fresh anyway, so
    // invalidating a collection nobody is watching costs no request.
    if (!entry || entry.listeners.size === 0) return Promise.resolve();
    if (entry.inflight) return entry.inflight;

    // `Promise.resolve().then(…)` rather than an async IIFE: the continuations
    // can only run in a later microtask, so `finally` cannot clear `inflight`
    // before the assignment below sets it.
    const run = Promise.resolve()
      .then(() => entry.fetch())
      .then(
        (data) => this.publish(entry, { data, loading: false, error: null }),
        (err) => this.publish(entry, { ...entry.snapshot, loading: false, error: messageOf(err) }),
      )
      .finally(() => {
        entry.inflight = null;
      });

    entry.inflight = run;
    return run;
  }

  /**
   * The mutation-side API: name what changed, and every surface reading it
   * re-renders. Resolves when the named keys have been re-read; collections
   * *derived* from them are refreshed in the background, because the row the
   * user just acted on must not wait out a second round-trip to settle.
   */
  invalidate(...keys: string[]): Promise<void> {
    const derived = new Set<string>();
    for (const key of keys) {
      for (const dep of DERIVED[key] ?? []) {
        if (!keys.includes(dep)) derived.add(dep);
      }
    }
    for (const dep of derived) void this.refresh(dep);
    return Promise.all(keys.map((key) => this.refresh(key))).then(() => undefined);
  }

  /** Optimistic local write — visible to every mount of the collection at once. */
  mutate<T>(key: string, update: (prev: T | null) => T | null): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.publish(entry, { ...entry.snapshot, data: update(entry.snapshot.data as T | null) });
  }

  /**
   * Drop every poller, listener and cached value. For a store somebody owns
   * explicitly (a test, a provider handed its own instance) — the app-wide one
   * outlives every mount on purpose, which is what makes the cache shared.
   */
  stop(): void {
    for (const entry of this.entries.values()) {
      entry.scheduler?.stop();
      entry.scheduler = null;
      entry.pollingAt = undefined;
    }
    this.entries.clear();
    this.detachVisibility?.();
    this.detachVisibility = null;
  }

  private publish(entry: Entry, snapshot: CollectionSnapshot<unknown>): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners.keys()) listener();
  }

  /**
   * Make the poller match the live subscribers: the fastest interval any of
   * them asked for, nothing at all once they've gone or stopped asking (a
   * verification list polls only while a run is still running). Returns true
   * when it started a scheduler, which fires an immediate read.
   */
  private syncScheduler(key: string, entry: Entry): boolean {
    let wanted: number | undefined;
    for (const intervalMs of entry.listeners.values()) {
      if (intervalMs !== undefined) wanted = Math.min(wanted ?? intervalMs, intervalMs);
    }
    if (entry.listeners.size === 0) wanted = undefined;
    if (wanted === entry.pollingAt) return false;

    entry.scheduler?.stop();
    entry.scheduler = null;
    entry.pollingAt = wanted;
    if (wanted === undefined) return false;

    const scheduler = new SmartPollScheduler(async () => {
      await this.refresh(key);
      // `refresh` never rejects; rethrowing the recorded failure is what feeds
      // the scheduler's backoff, so a dead daemon isn't polled at full rate.
      if (entry.snapshot.error) throw new Error(entry.snapshot.error);
    }, wanted);
    entry.scheduler = scheduler;
    this.attachVisibility();
    if (typeof document !== 'undefined' && document.hidden) scheduler.pause();
    scheduler.start();
    return true;
  }

  /**
   * One listener for the whole app: a hidden tab polls nothing, and coming back
   * to a tab re-reads every collection immediately (`SmartPollScheduler.resume`
   * fires at once) instead of waiting out an interval.
   */
  private attachVisibility(): void {
    if (this.detachVisibility || typeof document === 'undefined') return;
    const onChange = () => {
      for (const entry of this.entries.values()) {
        if (!entry.scheduler) continue;
        if (document.hidden) entry.scheduler.pause();
        else entry.scheduler.resume();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    this.detachVisibility = () => document.removeEventListener('visibilitychange', onChange);
  }
}
