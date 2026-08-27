import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * CRUD over the external MCP server registry (OD-101), against a throwaway
 * data dir — `LIGMA_DATA_DIR` must be set before the route modules (or
 * routes/mcp/store.ts) are first imported.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { McpServerEntry } from '../store';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-mcp-registry-'));
process.env.LIGMA_DATA_DIR = dataDir;

const listRoute = await import('./route');
const itemRoute = await import('./_id/route');

const asServer = (v: unknown) => v as McpServerEntry;
const asList = (v: unknown) => v as { servers: McpServerEntry[] };
const asOk = (v: unknown) => v as { ok: boolean };

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  listRoute.POST(
    new Request('http://x/api/mcp/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const patch = (id: string, body: unknown) =>
  itemRoute.PATCH(
    new Request(`http://x/api/mcp/servers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('GET/POST /api/mcp/servers', () => {
  it('starts empty', async () => {
    const res = await listRoute.GET();
    expect(asList(await res.json()).servers).toEqual([]);
  });

  it('creates a stdio server', async () => {
    const res = await post({
      name: 'local-fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'some-mcp'],
    });
    expect(res.status).toBe(201);
    const server = await res.json();
    expect(server).toMatchObject({
      name: 'local-fs',
      transport: 'stdio',
      command: 'npx',
      enabled: true,
    });

    const list = asList(await (await listRoute.GET()).json());
    expect(list.servers).toHaveLength(1);
  });

  it('creates an http server', async () => {
    const res = await post({ name: 'remote', transport: 'http', url: 'http://127.0.0.1:9999/mcp' });
    expect(res.status).toBe(201);
  });

  it('rejects a stdio server with no command', async () => {
    const res = await post({ name: 'broken', transport: 'stdio' });
    expect(res.status).toBe(400);
  });

  it('rejects an http server with no url', async () => {
    const res = await post({ name: 'broken', transport: 'http' });
    expect(res.status).toBe(400);
  });
});

describe('GET/PATCH/DELETE /api/mcp/servers/:id', () => {
  it('round-trips an update and a delete', async () => {
    const created = asServer(
      await (await post({ name: 'toggle-me', transport: 'stdio', command: 'true' })).json(),
    );

    const fetched = await itemRoute.GET(new Request(`http://x/api/mcp/servers/${created.id}`), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(asServer(await fetched.json()).enabled).toBe(true);

    const disabled = await patch(created.id, { enabled: false });
    expect(asServer(await disabled.json()).enabled).toBe(false);

    const deleted = await itemRoute.DELETE(
      new Request(`http://x/api/mcp/servers/${created.id}`, { method: 'DELETE' }),
      {
        params: Promise.resolve({ id: created.id }),
      },
    );
    expect(asOk(await deleted.json()).ok).toBe(true);

    const gone = await itemRoute.GET(new Request(`http://x/api/mcp/servers/${created.id}`), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(gone.status).toBe(404);
  });

  it('404s an update to an id that never existed', async () => {
    const res = await patch('mcpsrv_nope', { enabled: false });
    expect(res.status).toBe(404);
  });
});
