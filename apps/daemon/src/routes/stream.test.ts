/**
 * The run-output SSE stream's error frame (seam S1, process audit P14 / D6).
 *
 * `ligma runs tail run_typo` exited 0 with no output: the poll route's 404
 * carries `done: true`, and this stream turned that into a clean `end`. No
 * client could tell "no such run" from "finished silently".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const pollMock = vi.fn();
vi.mock('./runs/_id/output/route', () => ({ GET: (...args: unknown[]) => pollMock(...args) }));

import { DaemonRequest } from '../http';

async function collect(runId: string): Promise<string> {
  const { GET } = await import('./stream');
  const res = await GET(new DaemonRequest(`http://internal/api/runs/${runId}/output/stream`), {
    params: Promise.resolve({ id: runId }),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

beforeEach(() => pollMock.mockReset());

describe('GET /api/runs/:id/output/stream', () => {
  it('turns a non-2xx poll into an `error` frame carrying the status, then ends', async () => {
    pollMock.mockResolvedValue(
      Response.json(
        { error: 'Run not found', lines: [], nextOffset: 0, done: true },
        { status: 404 },
      ),
    );

    const out = await collect('run_typo');

    expect(out).toContain('event: error');
    expect(out).not.toContain('event: end');
    const data = JSON.parse(out.split('data: ')[1]?.trim());
    expect(data).toEqual({ error: 'Run not found', status: 404 });
  });

  it("falls back to a generic message when the poll's body carries no error string", async () => {
    pollMock.mockResolvedValue(new Response('nope', { status: 500 }));

    const data = JSON.parse((await collect('run_x')).split('data: ')[1]?.trim());

    expect(data.status).toBe(500);
    expect(data.error).toMatch(/500/);
  });

  it('still ends cleanly on a real finished run', async () => {
    pollMock.mockResolvedValue(
      Response.json({
        lines: [{ ts: 't', stream: 'stdout', text: 'hi' }],
        nextOffset: 1,
        done: true,
      }),
    );

    const out = await collect('run_ok');

    expect(out).toContain('event: output');
    expect(out).toContain('event: end');
    expect(out).not.toContain('event: error');
  });
});
