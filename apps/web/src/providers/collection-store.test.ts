import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionStore } from './collection-store';

/**
 * M1/M9: the cross-surface staleness and the polling bill were one defect —
 * every call site owned its own state, its own interval and no invalidation, so
 * a mutation refreshed one hook and the three deriving from it went stale while
 * idle tabs kept hammering the daemon. These pin the three properties the whole
 * fix rests on: invalidation reaches derived collections, a hidden tab polls
 * nothing, and N mounts of one collection make one request.
 *
 * DOM-free like `use-smart-poll.test.ts` — this repo's vitest runs in the
 * "node" environment, so `document` is faked where visibility is the subject.
 */

interface FakeDocument {
  hidden: boolean;
  listeners: Array<() => void>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  dispatch(): void;
}

function fakeDocument(): FakeDocument {
  return {
    hidden: false,
    listeners: [],
    addEventListener(_type, listener) {
      this.listeners.push(listener);
    },
    removeEventListener(_type, listener) {
      this.listeners = this.listeners.filter((l) => l !== listener);
    },
    dispatch() {
      for (const listener of [...this.listeners]) listener();
    },
  };
}

/** Lets the store's promise chain (`Promise.resolve().then(…)`) settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('CollectionStore', () => {
  let store: CollectionStore;

  beforeEach(() => {
    store = new CollectionStore();
  });

  afterEach(() => {
    store.stop();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('publishes a snapshot to every subscriber of a collection', async () => {
    const listener = vi.fn();
    store.subscribe('/api/tasks', async () => [{ id: 't1' }], undefined, listener);
    await flush();

    expect(store.getSnapshot<Array<{ id: string }>>('/api/tasks')).toEqual({
      data: [{ id: 't1' }],
      loading: false,
      error: null,
    });
    expect(listener).toHaveBeenCalled();
  });

  it('keeps the last confirmed data when a read fails, and reports the failure', async () => {
    let attempt = 0;
    const fetch = async () => {
      attempt += 1;
      if (attempt === 1) return ['first'];
      throw new Error('daemon unreachable');
    };
    store.subscribe('/api/deck', fetch, undefined, () => {});
    await flush();
    await store.invalidate('/api/deck');

    const snapshot = store.getSnapshot<string[]>('/api/deck');
    // Never `data: []` — "could not read it" and "there is nothing" are
    // different claims, and the second one is the lie (B5).
    expect(snapshot.data).toEqual(['first']);
    expect(snapshot.error).toBe('daemon unreachable');
  });

  it('runs one fetch for many mounts of the same collection', async () => {
    const fetch = vi.fn(async () => ['shared']);
    for (let i = 0; i < 4; i++) store.subscribe('/api/agents', fetch, undefined, () => {});
    await flush();

    // Four `useAgents()` mounts used to be four GET /api/agents.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot<string[]>('/api/agents').data).toEqual(['shared']);
  });

  it('joins an in-flight read instead of starting a second one', async () => {
    const fetch = vi.fn(async () => ['v1']);
    store.subscribe('/api/tasks', fetch, undefined, () => {});
    await Promise.all([store.refresh('/api/tasks'), store.refresh('/api/tasks')]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('invalidating a collection re-reads the collections derived from it', async () => {
    const decisions = vi.fn(async () => ['d1']);
    const deck = vi.fn(async () => ['card']);
    store.subscribe('/api/decisions', decisions, undefined, () => {});
    store.subscribe('/api/deck', deck, undefined, () => {});
    await flush();
    expect(deck).toHaveBeenCalledTimes(1);

    // Answering in Deck list mode refetched decisions only, so the rail badge
    // and the page's own "N waiting" stayed frozen (F5).
    await store.invalidate('/api/decisions');
    await flush();

    expect(decisions).toHaveBeenCalledTimes(2);
    expect(deck).toHaveBeenCalledTimes(2);
  });

  it('does not fetch a collection nothing is rendering', async () => {
    const fetch = vi.fn(async () => ['x']);
    const unsubscribe = store.subscribe('/api/inbox', fetch, undefined, () => {});
    await flush();
    unsubscribe();

    await store.invalidate('/api/inbox');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached value when a mount re-subscribes in the same commit', async () => {
    // React re-subscribes by unsubscribing first when the interval changes
    // (a verification list starting to poll). Evicting on that would blank a
    // collection that is still on screen.
    const fetch = vi.fn(async () => ['kept']);
    const unsubscribe = store.subscribe('/api/verification-runs', fetch, undefined, () => {});
    await flush();
    unsubscribe();
    store.subscribe('/api/verification-runs', fetch, 5000, () => {});

    await flush();
    expect(store.getSnapshot<string[]>('/api/verification-runs').data).toEqual(['kept']);
  });

  it('drops a collection nothing renders any more', async () => {
    const fetch = vi.fn(async () => ['gone']);
    const unsubscribe = store.subscribe('/api/projects/p1/brief', fetch, undefined, () => {});
    await flush();
    unsubscribe();
    await flush();

    // Per-project and per-task keys would otherwise pile up for the tab's life.
    expect(store.getSnapshot<string[]>('/api/projects/p1/brief')).toEqual({
      data: null,
      loading: true,
      error: null,
    });
  });

  it('optimistic writes reach every mount at once', async () => {
    const listener = vi.fn();
    store.subscribe(
      '/api/tasks',
      async () => [{ id: 't1' }],
      undefined,
      () => {},
    );
    store.subscribe('/api/tasks', async () => [{ id: 't1' }], undefined, listener);
    await flush();

    store.mutate<Array<{ id: string }>>('/api/tasks', (prev) => [...(prev ?? []), { id: 't2' }]);

    expect(store.getSnapshot<Array<{ id: string }>>('/api/tasks').data).toHaveLength(2);
    expect(listener).toHaveBeenCalled();
  });

  describe('polling', () => {
    it('polls on the interval while the tab is visible', async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => ['runs']);
      store.subscribe('/api/runs', fetch, 3000, () => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1); // fires on mount

      await vi.advanceTimersByTimeAsync(3000);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('stops polling while the tab is hidden and re-reads on return', async () => {
      vi.useFakeTimers();
      const doc = fakeDocument();
      Reflect.set(globalThis, 'document', doc);

      const fetch = vi.fn(async () => ['runs']);
      store.subscribe('/api/runs', fetch, 3000, () => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);

      // /api/runs was the one poller that kept hitting the daemon from a
      // backgrounded tab, forever (F11).
      doc.hidden = true;
      doc.dispatch();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetch).toHaveBeenCalledTimes(1);

      doc.hidden = false;
      doc.dispatch();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(2); // resuming reads immediately
    });

    it('polls once for many mounts, and stops when the last one leaves', async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => ['runs']);
      const unsubscribes = [0, 1, 2].map(() => store.subscribe('/api/runs', fetch, 3000, () => {}));
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetch).toHaveBeenCalledTimes(2); // mount + one interval, not three

      for (const unsubscribe of unsubscribes) unsubscribe();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('takes the fastest interval asked for, and drops the poller when nobody wants one', async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => ['runs']);
      const slow = store.subscribe('/api/verification-runs', fetch, 20_000, () => {});
      const fast = store.subscribe('/api/verification-runs', fetch, 5000, () => {});
      await vi.advanceTimersByTimeAsync(5000);
      const polled = fetch.mock.calls.length;
      expect(polled).toBeGreaterThanOrEqual(2);

      // The Verify list polls only while a run is still running.
      fast();
      slow();
      store.subscribe('/api/verification-runs', fetch, undefined, () => {});
      await vi.advanceTimersByTimeAsync(0); // the new mount's one read
      const settled = fetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(settled);
    });
  });
});
