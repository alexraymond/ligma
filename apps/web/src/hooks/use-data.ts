'use client';

import { apiFetch } from '@/lib/api-client';
import { showError, showSuccess } from '@/lib/toast';
import { useCollection, useCollectionStore } from '@/providers/collections-provider';
import type {
  ActivityEvent,
  AgentDefinition,
  BrainDumpEntry,
  DecisionItem,
  Goal,
  InboxMessage,
  Project,
  SkillDefinition,
  Task,
} from '@ligma/api';
import { useCallback } from 'react';

/** Stable identity for "loaded nothing yet", so consumers don't re-render on it. */
const EMPTY: readonly never[] = [];

/**
 * Follows `meta.filtered` pagination until the whole collection is loaded, so
 * consumers count the store, never a silently truncated page (the Board's
 * "208 done" header vs its 200-row list). Routes without `meta` return one page.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; filtered?: number }>,
): Promise<T[]> {
  const all: T[] = [];
  for (;;) {
    const { items, filtered } = await fetchPage(all.length);
    all.push(...items);
    if (items.length === 0 || filtered === undefined || all.length >= filtered) return all;
  }
}

// Generic hook factory for CRUD operations.
//
// State lives in the shared collection store (providers/collection-store.ts),
// keyed by the endpoint URL: every mount of the same collection reads one
// cache, shares one in-flight fetch and one visibility-paused poller, and a
// mutation here invalidates the collections that derive from it. The hook's
// surface is unchanged — call sites destructure exactly what they always did.
//
// pollInterval: optional polling interval in ms (e.g. 10_000 for 10s)
function useDataResource<T extends { id: string }>(
  endpoint: string,
  dataKey: string,
  label: string,
  pollInterval?: number,
  // Whether the server soft-deletes this resource (`deletedAt`, restorable via
  // `PUT {deletedAt: null}`). Only tasks/goals/projects do — brain-dump/inbox/
  // decisions hard-delete server-side, so offering "Undo" there always fails
  // with "Failed to restore" after the data is already gone (W2). Those get an
  // honest confirm before the irreversible delete instead.
  supportsUndo = true,
) {
  const url = `/api/${endpoint}`;
  const store = useCollectionStore();

  const fetcher = useCallback(
    () =>
      fetchAllPages<T>(async (offset) => {
        const res = await apiFetch(offset === 0 ? url : `${url}?offset=${offset}`);
        if (!res.ok) throw new Error(`Failed to fetch ${endpoint}`);
        const json = await res.json();
        return {
          // Support both new envelope { data: [...] } and legacy { [dataKey]: [...] }
          items: (json.data ?? json[dataKey] ?? []) as T[],
          filtered: typeof json.meta?.filtered === 'number' ? json.meta.filtered : undefined,
        };
      }),
    [url, endpoint, dataKey],
  );

  const { data, loading, error, refetch } = useCollection<T[]>(url, fetcher, pollInterval);
  // A failed read leaves the last confirmed list in place and reports `error`;
  // it is never folded into an empty collection.
  const items = (data ?? EMPTY) as T[];

  /** Optimistic write — every mount of this collection sees it immediately. */
  const setItems = useCallback(
    (update: (prev: T[]) => T[]) => store.mutate<T[]>(url, (prev) => update(prev ?? [])),
    [store, url],
  );

  const create = useCallback(
    async (item: Partial<T>) => {
      try {
        const res = await apiFetch(`/api/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        if (!res.ok) throw new Error(`Failed to create ${endpoint}`);
        const created = await res.json();
        setItems((prev) => [...prev, created]);
        showSuccess(`${label} created`);
        return created as T;
      } catch (err) {
        showError(`Failed to create ${label.toLowerCase()}`);
        throw err;
      }
    },
    [endpoint, label, setItems],
  );

  const update = useCallback(
    async (id: string, updates: Partial<T>) => {
      // Optimistic update
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
      try {
        const res = await apiFetch(`/api/${endpoint}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...updates }),
        });
        if (!res.ok) {
          await refetch(); // Revert on failure
          throw new Error(`Failed to update ${endpoint}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        showError(`Failed to update ${label.toLowerCase()}`);
        await refetch();
        throw err;
      }
    },
    [endpoint, refetch, label, setItems],
  );

  const remove = useCallback(
    async (id: string) => {
      // Hard-deleted resources can't be restored server-side — confirm before
      // the irreversible delete instead of offering an "Undo" that would fail.
      if (
        !supportsUndo &&
        !window.confirm(`Delete this ${label.toLowerCase()}? This can't be undone.`)
      ) {
        return;
      }
      // Capture the item before deleting (for undo)
      const deletedItem = items.find((item) => item.id === id);
      // Optimistic delete
      setItems((prev) => prev.filter((item) => item.id !== id));
      try {
        const res = await apiFetch(`/api/${endpoint}?id=${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          await refetch(); // Revert on failure
          throw new Error(`Failed to delete ${endpoint}`);
        }
        // Show undo toast with 5-second window (uses PUT to restore soft-deleted item)
        showSuccess(
          `${label} deleted`,
          supportsUndo && deletedItem
            ? {
                action: {
                  label: 'Undo',
                  onClick: async () => {
                    try {
                      await apiFetch(`/api/${endpoint}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: deletedItem.id, deletedAt: null }),
                      });
                      await refetch();
                      showSuccess(`${label} restored`);
                    } catch {
                      showError(`Failed to restore ${label.toLowerCase()}`);
                    }
                  },
                },
                duration: 5000,
              }
            : undefined,
        );
      } catch (err) {
        showError(`Failed to delete ${label.toLowerCase()}`);
        await refetch();
        throw err;
      }
    },
    [endpoint, refetch, label, items, setItems, supportsUndo],
  );

  const bulkUpdate = useCallback(
    async (ids: string[], updates: Partial<T>) => {
      // Optimistic update
      setItems((prev) =>
        prev.map((item) => (ids.includes(item.id) ? { ...item, ...updates } : item)),
      );
      try {
        if (endpoint === 'tasks') {
          // Single atomic bulk request
          const res = await apiFetch('/api/tasks/bulk', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: ids.map((id) => ({ id, ...updates })) }),
          });
          if (!res.ok) throw new Error(`Failed to bulk update ${endpoint}`);
        } else {
          // Fallback: parallel individual calls for non-task entities
          const results = await Promise.all(
            ids.map((id) =>
              apiFetch(`/api/${endpoint}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...updates }),
              }),
            ),
          );
          if (results.some((res) => !res.ok)) throw new Error(`Failed to bulk update ${endpoint}`);
        }
        showSuccess(`${ids.length} ${label.toLowerCase()}${ids.length > 1 ? 's' : ''} updated`);
      } catch (err) {
        showError(`Failed to bulk update ${label.toLowerCase()}s`);
        await refetch();
        throw err;
      }
    },
    [endpoint, refetch, label, setItems],
  );

  const bulkRemove = useCallback(
    async (ids: string[]) => {
      // Optimistic delete
      setItems((prev) => prev.filter((item) => !ids.includes(item.id)));
      try {
        if (endpoint === 'tasks') {
          // Single atomic bulk request
          const res = await apiFetch('/api/tasks/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          });
          if (!res.ok) throw new Error(`Failed to bulk delete ${endpoint}`);
        } else {
          // Fallback: parallel individual calls
          const results = await Promise.all(
            ids.map((id) => apiFetch(`/api/${endpoint}?id=${id}`, { method: 'DELETE' })),
          );
          if (results.some((res) => !res.ok)) throw new Error(`Failed to bulk delete ${endpoint}`);
        }
        showSuccess(`${ids.length} ${label.toLowerCase()}${ids.length > 1 ? 's' : ''} deleted`);
      } catch (err) {
        showError(`Failed to bulk delete ${label.toLowerCase()}s`);
        await refetch();
        throw err;
      }
    },
    [endpoint, refetch, label, setItems],
  );

  return { items, loading, error, create, update, remove, bulkUpdate, bulkRemove, refetch };
}

export function useTasks() {
  const { items: tasks, ...rest } = useDataResource<Task>('tasks', 'tasks', 'Task', 15_000);
  return { tasks, ...rest };
}

export function useGoals() {
  const { items: goals, ...rest } = useDataResource<Goal>('goals', 'goals', 'Goal');
  return { goals, ...rest };
}

export function useProjects() {
  // Polled (F8): a project renamed, archived or given a repoPath elsewhere used
  // to stay wrong for the whole session, including the tab gates derived from it.
  const { items: projects, ...rest } = useDataResource<Project>(
    'projects',
    'projects',
    'Project',
    30_000,
  );
  return { projects, ...rest };
}

export function useBrainDump() {
  const { items: entries, ...rest } = useDataResource<BrainDumpEntry>(
    'brain-dump',
    'entries',
    'Entry',
    undefined,
    false,
  );
  return { entries, ...rest };
}

export function useActivityLog() {
  const { items: events, ...rest } = useDataResource<ActivityEvent>(
    'activity-log',
    'events',
    'Event',
    30_000,
  );
  return { events, ...rest };
}

export function useInbox() {
  const { items: messages, ...rest } = useDataResource<InboxMessage>(
    'inbox',
    'messages',
    'Message',
    10_000,
    false,
  );
  return { messages, ...rest };
}

export function useDecisions() {
  const { items: decisions, ...rest } = useDataResource<DecisionItem>(
    'decisions',
    'decisions',
    'Decision',
    10_000,
    false,
  );
  return { decisions, ...rest };
}

export function useAgents() {
  const { items: agents, ...rest } = useDataResource<AgentDefinition>('agents', 'agents', 'Agent');
  return { agents, ...rest };
}

export function useSkills() {
  const { items: skills, ...rest } = useDataResource<SkillDefinition>('skills', 'skills', 'Skill');
  return { skills, ...rest };
}
