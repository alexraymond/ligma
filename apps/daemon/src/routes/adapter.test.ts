/**
 * The Express seam's two cross-cutting guards.
 *
 * P20: a page in the user's browser can fire a no-cors POST at 127.0.0.1 and
 * never read the response — the side effect is the attack. A cross-origin
 * request cannot declare `application/json` without a preflight the daemon
 * never answers, so the header is the gate.
 *
 * P15: every real route speaks JSON, so an unknown `/api/*` path must too.
 */

import express from 'express';
import { describe, expect, it } from 'vitest';
import { NextResponse } from '../http';
import { mountRoute } from './adapter';

/** `Response.json()` is `unknown` under this config; every assertion below reads fields. */
async function json<T = Record<string, string>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function app(): express.Express {
  const a = express();
  a.use(express.text({ type: '*/*' }));
  a.all(
    '/api/thing',
    mountRoute({
      POST: () => NextResponse.json({ ok: true }),
      GET: () => NextResponse.json({ ok: true }),
      DELETE: () => NextResponse.json({ ok: true }),
    }),
  );
  a.use('/api', (req, res) => {
    res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
  });
  return a;
}

async function serve<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = app().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('mutating routes require content-type: application/json (P20)', () => {
  it('accepts application/json, with or without a charset', async () => {
    await serve(async (base) => {
      for (const ct of [
        'application/json',
        'application/json; charset=utf-8',
        'application/merge-patch+json',
      ]) {
        const res = await fetch(`${base}/api/thing`, {
          method: 'POST',
          headers: { 'content-type': ct },
          body: '{}',
        });
        expect(res.status, ct).toBe(200);
      }
    });
  });

  it('415s the three content types a cross-origin POST can actually send', async () => {
    await serve(async (base) => {
      for (const ct of [
        'text/plain;charset=UTF-8',
        'application/x-www-form-urlencoded',
        'multipart/form-data',
      ]) {
        const res = await fetch(`${base}/api/thing`, {
          method: 'POST',
          headers: { 'content-type': ct },
          body: 'x=1',
        });
        expect(res.status, ct).toBe(415);
        expect((await json(res)).error).toMatch(/application\/json/);
      }
    });
  });

  it('415s a POST with no content-type at all', async () => {
    await serve(async (base) => {
      // undici adds one for a string body, so send none.
      const res = await fetch(`${base}/api/thing`, { method: 'POST' });
      expect(res.status).toBe(415);
    });
  });

  it('leaves GET and DELETE alone — neither is reachable from a form or no-cors fetch', async () => {
    await serve(async (base) => {
      expect((await fetch(`${base}/api/thing`)).status).toBe(200);
      expect((await fetch(`${base}/api/thing`, { method: 'DELETE' })).status).toBe(200);
    });
  });
});

describe('unknown /api paths answer JSON (P15)', () => {
  it('404s with an error object, not an HTML error page', async () => {
    await serve(async (base) => {
      const res = await fetch(`${base}/api/talk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect((await json(res)).error).toMatch(/No such endpoint/);
    });
  });
});
