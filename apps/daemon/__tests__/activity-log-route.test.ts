import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ActivityEvent, ActivityLogFile } from '@ligma/api';
/**
 * PUT /api/activity-log — undo-restore round trip (B6/F4).
 *
 * The route used to export only GET/POST/DELETE, so `useDataResource`'s undo
 * toast (which PUTs `{ id, deletedAt: null }` after a delete) 405'd. Activity
 * events are hard-deleted (no `deletedAt` field, unlike Task/Goal/Project), so
 * the fix isn't just exporting PUT — it's giving PUT something to restore
 * from, which DELETE now stashes.
 *
 * Same throwaway-`LIGMA_DATA_DIR` technique as decisions-bulk-route.test.ts:
 * the route module is imported dynamically so its top-level data-dir read
 * happens after the env var is set.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-activity-log-'));
process.env.LIGMA_DATA_DIR = dataDir;

function event(id: string, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id,
    type: 'task_updated',
    actor: 'me',
    taskId: null,
    summary: `Event ${id}`,
    details: '',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function writeEvents(events: ActivityEvent[]): void {
  const file: ActivityLogFile = { events };
  writeFileSync(path.join(dataDir, 'activity-log.json'), JSON.stringify(file), 'utf-8');
}

mkdirSync(dataDir, { recursive: true });
writeEvents([event('evt_1'), event('evt_2')]);

const { GET, DELETE: deleteEvent, PUT } = await import('../src/routes/activity-log/route');
const { getActivityLog } = await import('../src/store/data');

function deleteRequest(id: string): Request {
  return new Request(`http://internal/api/activity-log?id=${id}`, { method: 'DELETE' });
}

function putRequest(body: unknown): Request {
  return new Request('http://internal/api/activity-log', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/activity-log', () => {
  beforeAll(() => {
    writeEvents([event('evt_1'), event('evt_2')]);
  });

  it('restores a deleted event', async () => {
    const del = await deleteEvent(deleteRequest('evt_1'));
    expect(del.status).toBe(200);

    const afterDelete = await getActivityLog();
    expect(afterDelete.events.find((e) => e.id === 'evt_1')).toBeUndefined();

    const restore = await PUT(putRequest({ id: 'evt_1' }));
    expect(restore.status).toBe(200);
    const restored = (await restore.json()) as ActivityEvent;
    expect(restored.id).toBe('evt_1');
    expect(restored.summary).toBe('Event evt_1');

    const afterRestore = await getActivityLog();
    expect(afterRestore.events.find((e) => e.id === 'evt_1')).toEqual(event('evt_1'));
  });

  it('round-trips through GET too — the restored event is listed again', async () => {
    const res = await GET(new Request('http://internal/api/activity-log'));
    const body = (await res.json()) as { events: ActivityEvent[] };
    expect(body.events.map((e) => e.id)).toEqual(expect.arrayContaining(['evt_1', 'evt_2']));
  });

  it('404s restoring an id that was never deleted', async () => {
    const res = await PUT(putRequest({ id: 'evt_never_deleted' }));
    expect(res.status).toBe(404);
  });

  it('404s restoring the same id twice — undo is not replayable', async () => {
    await deleteEvent(deleteRequest('evt_2'));
    const first = await PUT(putRequest({ id: 'evt_2' }));
    expect(first.status).toBe(200);

    const second = await PUT(putRequest({ id: 'evt_2' }));
    expect(second.status).toBe(404);
  });

  it('400s a PUT with no id', async () => {
    const res = await PUT(putRequest({}));
    expect(res.status).toBe(400);
  });
});
