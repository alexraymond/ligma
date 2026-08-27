import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchAllPages } from './use-data';

// No jsdom in this vitest config, so the hooks (which need a React tree +
// fetch) aren't rendered here — same approach as task-detail-panel.test.ts:
// pin the source facts a render would otherwise verify.
const SOURCE = readFileSync(path.resolve(__dirname, './use-data.ts'), 'utf-8');

describe('useDataResource — bulk mutations check the response (W8)', () => {
  it('bulkUpdate throws on a non-ok bulk PUT instead of reporting success', () => {
    const start = SOURCE.indexOf('const bulkUpdate = useCallback');
    const end = SOURCE.indexOf('const bulkRemove = useCallback');
    const body = SOURCE.slice(start, end);
    expect(body).toContain('if (!res.ok) throw new Error(`Failed to bulk update ${endpoint}`);');
    expect(body).toContain(
      'if (results.some((res) => !res.ok)) throw new Error(`Failed to bulk update ${endpoint}`);',
    );
  });

  it('bulkRemove throws on a non-ok bulk DELETE instead of reporting success', () => {
    const start = SOURCE.indexOf('const bulkRemove = useCallback');
    const end = SOURCE.indexOf('return { items, loading');
    const body = SOURCE.slice(start, end);
    expect(body).toContain('if (!res.ok) throw new Error(`Failed to bulk delete ${endpoint}`);');
    expect(body).toContain(
      'if (results.some((res) => !res.ok)) throw new Error(`Failed to bulk delete ${endpoint}`);',
    );
  });
});

describe('useDataResource — Undo only offered where the server can restore (W2)', () => {
  it('remove() confirms before an unrestorable delete instead of offering a doomed Undo', () => {
    expect(SOURCE).toContain('!supportsUndo &&');
    expect(SOURCE).toContain('!window.confirm(');
    expect(SOURCE).toContain('`${label} deleted`,');
    expect(SOURCE).toContain('supportsUndo && deletedItem');
  });

  it('brain-dump, inbox, and decisions are hard-deleted server-side — opted out of Undo', () => {
    expect(SOURCE).toMatch(/'brain-dump',\s*'entries',\s*'Entry',\s*undefined,\s*false,/);
    expect(SOURCE).toMatch(/'inbox',\s*'messages',\s*'Message',\s*10_000,\s*false,/);
    expect(SOURCE).toMatch(/'decisions',\s*'decisions',\s*'Decision',\s*10_000,\s*false,/);
  });

  it("tasks, goals, and projects keep Undo — they're soft-deleted server-side", () => {
    expect(SOURCE).toContain("useDataResource<Task>('tasks', 'tasks', 'Task', 15_000);");
    expect(SOURCE).toContain("useDataResource<Goal>('goals', 'goals', 'Goal');");
    expect(SOURCE).toMatch(/'projects',\s*'projects',\s*'Project',\s*30_000,/);
  });
});

function pagedStore<T>(all: T[], pageSize: number) {
  let calls = 0;
  return {
    fetchPage: async (offset: number) => {
      calls++;
      return { items: all.slice(offset, offset + pageSize), filtered: all.length };
    },
    callCount: () => calls,
  };
}

describe('fetchAllPages', () => {
  it('follows meta.filtered past the first page (208 vs 200)', async () => {
    const all = Array.from({ length: 208 }, (_, i) => ({ id: `task_${i}` }));
    const store = pagedStore(all, 200);
    const result = await fetchAllPages(store.fetchPage);
    expect(result).toHaveLength(208);
    expect(store.callCount()).toBe(2);
  });

  it('returns a single page when the route reports no meta', async () => {
    const result = await fetchAllPages(async () => ({ items: [1, 2, 3] }));
    expect(result).toEqual([1, 2, 3]);
  });

  it('stops on an empty page even if filtered overstates', async () => {
    const result = await fetchAllPages(async (offset) =>
      offset === 0 ? { items: [1], filtered: 5 } : { items: [], filtered: 5 },
    );
    expect(result).toEqual([1]);
  });
});
