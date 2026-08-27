/**
 * `/api/memory/:agentId` and `/api/memory/:agentId/:entryId` (OD-092).
 *
 * Same throwaway-data-dir setup as memory-store.test.ts; these tests exercise
 * the HTTP shapes (status codes, validation, 404s) rather than the store rules.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-memory-routes-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { DaemonRequest } = await import('../src/http');
const { GET, POST } = await import('../src/routes/memory/_agentId/route');
const { PATCH, DELETE } = await import('../src/routes/memory/_agentId/_entryId/route');

interface Entry {
  id: string;
  text: string;
  source: string | null;
  createdAt: string;
  pinned: boolean;
}

function url(suffix = ''): string {
  return `http://127.0.0.1/api/memory/agent_a${suffix}`;
}

function agentParams(agentId = 'agent_a') {
  return { params: Promise.resolve({ agentId }) };
}

function entryParams(entryId: string, agentId = 'agent_a') {
  return { params: Promise.resolve({ agentId, entryId }) };
}

function post(body: unknown, agentId = 'agent_a'): Promise<Response> {
  return Promise.resolve(
    POST(
      new DaemonRequest(url(), { method: 'POST', body: JSON.stringify(body) }),
      agentParams(agentId),
    ),
  );
}

async function listEntries(agentId = 'agent_a'): Promise<Entry[]> {
  const res = await GET(new DaemonRequest(url()), agentParams(agentId));
  const body = (await res.json()) as { entries: Entry[] };
  return body.entries;
}

beforeEach(async () => {
  await rm(path.join(dataDir, 'memory'), { recursive: true, force: true });
  writeFileSync(
    path.join(dataDir, 'daemon-config.json'),
    JSON.stringify({ execution: { memory: { enabled: true, maxEntries: 50 } } }, null, 2),
    'utf-8',
  );
});

describe('GET /api/memory/:agentId', () => {
  it('returns an empty list for an agent with no memories', async () => {
    const res = await GET(new DaemonRequest(url()), agentParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agentId: 'agent_a', entries: [] });
  });

  it('rejects an agent id that would escape the memory directory', async () => {
    const res = await GET(new DaemonRequest(url()), agentParams('../../etc/passwd'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Invalid agentId/);
  });
});

describe('POST /api/memory/:agentId', () => {
  it('adds a memory and returns it', async () => {
    const res = await post({ text: 'the product repo uses pnpm', source: 'task_1' });
    expect(res.status).toBe(201);

    const { entry } = (await res.json()) as { entry: Entry };
    expect(entry.text).toBe('the product repo uses pnpm');
    expect(entry.source).toBe('task_1');
    expect(entry.pinned).toBe(false);
    expect(await listEntries()).toHaveLength(1);
  });

  it('defaults source to null and pinned to false', async () => {
    const { entry } = (await (await post({ text: 'a bare note' })).json()) as { entry: Entry };
    expect(entry.source).toBeNull();
    expect(entry.pinned).toBe(false);
  });

  it('accepts pinned: true at creation', async () => {
    const { entry } = (await (await post({ text: 'keep me', pinned: true })).json()) as {
      entry: Entry;
    };
    expect(entry.pinned).toBe(true);
  });

  it('rejects missing or blank text', async () => {
    for (const body of [{}, { text: '' }, { text: '   ' }, { text: 42 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('text is required');
    }
  });

  it('rejects text over the cap', async () => {
    const res = await post({ text: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/1000 characters/);
  });

  it('rejects a non-string source', async () => {
    const res = await post({ text: 'fine', source: 7 });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/memory/:agentId/:entryId', () => {
  it('pins and unpins', async () => {
    const { entry } = (await (await post({ text: 'pin me' })).json()) as { entry: Entry };

    const pinned = await PATCH(
      new DaemonRequest(url(`/${entry.id}`), {
        method: 'PATCH',
        body: JSON.stringify({ pinned: true }),
      }),
      entryParams(entry.id),
    );
    expect(pinned.status).toBe(200);
    expect(((await pinned.json()) as { entry: Entry }).entry.pinned).toBe(true);
    expect((await listEntries())[0].pinned).toBe(true);

    await PATCH(
      new DaemonRequest(url(`/${entry.id}`), {
        method: 'PATCH',
        body: JSON.stringify({ pinned: false }),
      }),
      entryParams(entry.id),
    );
    expect((await listEntries())[0].pinned).toBe(false);
  });

  it('400s without a boolean pinned', async () => {
    const res = await PATCH(
      new DaemonRequest(url('/mem_x'), {
        method: 'PATCH',
        body: JSON.stringify({ pinned: 'yes' }),
      }),
      entryParams('mem_x'),
    );
    expect(res.status).toBe(400);
  });

  it('404s on an unknown entry', async () => {
    const res = await PATCH(
      new DaemonRequest(url('/mem_nope'), {
        method: 'PATCH',
        body: JSON.stringify({ pinned: true }),
      }),
      entryParams('mem_nope'),
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/memory/:agentId/:entryId', () => {
  it('forgets one memory', async () => {
    const { entry } = (await (await post({ text: 'forget me' })).json()) as { entry: Entry };

    const res = await DELETE(
      new DaemonRequest(url(`/${entry.id}`), { method: 'DELETE' }),
      entryParams(entry.id),
    );
    expect(res.status).toBe(200);
    expect(await listEntries()).toEqual([]);
  });

  it('404s on an unknown entry', async () => {
    const res = await DELETE(
      new DaemonRequest(url('/mem_nope'), { method: 'DELETE' }),
      entryParams('mem_nope'),
    );
    expect(res.status).toBe(404);
  });
});
