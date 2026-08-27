import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../src/client';
import { tailRun } from '../src/commands/tail';
import { type Handler, startMockDaemon } from './helpers';

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe('runs tail', () => {
  let close: () => Promise<void>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  afterEach(async () => {
    writeSpy.mockRestore();
    await close();
  });

  it("parses output/end frames off the SSE stream without double-printing the end frame's chunk", async () => {
    // Matches apps/daemon/src/routes/stream.ts: when a tick is both non-empty
    // and terminal, the `end` frame reuses the *same* RunOutputChunk (lines
    // included) as the `output` frame that preceded it — only `output` should render.
    const routes: Record<string, Handler> = {
      'GET /api/runs/r1/output/stream?offset=0': (_req, res) => {
        const chunk = {
          lines: [{ ts: 't', stream: 'stdout', text: 'hello' }],
          nextOffset: 5,
          done: true,
        };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(sseFrame('output', chunk));
        res.write(sseFrame('end', chunk));
        res.end();
      },
    };
    const { baseUrl, close: c } = await startMockDaemon(routes);
    close = c;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await tailRun(baseUrl, 'r1', new AbortController().signal);

    const printed = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(printed).toContain('hello');
    expect(printed.match(/hello/g)).toHaveLength(1);
  });

  it('falls back to polling /api/runs/:id/output when the SSE stream is unavailable', async () => {
    let polled = false;
    const routes: Record<string, Handler> = {
      'GET /api/runs/r1/output/stream?offset=0': (_req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'stream broken' }));
      },
      'GET /api/runs/r1/output?offset=0': (_req, res) => {
        polled = true;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            lines: [{ ts: 't', stream: 'stdout', text: 'polled output' }],
            nextOffset: 13,
            done: true,
          }),
        );
      },
    };
    const { baseUrl, close: c } = await startMockDaemon(routes);
    close = c;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await tailRun(baseUrl, 'r1', new AbortController().signal);

    expect(polled).toBe(true);
    expect(writeSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('polled output');
  });

  it('S1: surfaces a mid-stream `event: error` frame as a CliError instead of a clean end', async () => {
    // D6: a bogus/gone run id must fail loudly, not print nothing and exit 0.
    const routes: Record<string, Handler> = {
      'GET /api/runs/r1/output/stream?offset=0': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(sseFrame('error', { error: 'run r1 not found', status: 404 }));
        res.end();
      },
    };
    const { baseUrl, close: c } = await startMockDaemon(routes);
    close = c;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(tailRun(baseUrl, 'r1', new AbortController().signal)).rejects.toThrow(
      new CliError('run r1 not found'),
    );
  });
});
