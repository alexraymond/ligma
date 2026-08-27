import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decisionsAnswer } from '../src/commands/decisions';
import { type Handler, json, startMockDaemon } from './helpers';

describe('decisions answer', () => {
  let close: () => Promise<void>;

  afterEach(async () => {
    await close();
  });

  it("PATCHes /api/decisions with the deck UI's exact disposition body shape", async () => {
    let received: { req: IncomingMessage; body: string } | null = null;
    const routes: Record<string, Handler> = {
      'PATCH /api/decisions': (req, res, body) => {
        received = { req, body };
        json(res, 200, {
          decision: { id: 'dec_1', status: 'answered', answer: 'Go with option B' },
          undoExpiresAt: new Date().toISOString(),
        });
      },
    };
    const { baseUrl, close: c } = await startMockDaemon(routes);
    close = c;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await decisionsAnswer(baseUrl, 'dec_1', 'Go with option B');

    if (!received) throw new Error('no PATCH /api/decisions request received');
    expect(received.req.headers['content-type']).toContain('application/json');
    expect(JSON.parse(received.body)).toEqual({
      id: 'dec_1',
      action: 'answer',
      answer: 'Go with option B',
    });
    expect(logSpy.mock.calls.flat().join(' ')).toContain('dec_1');
    logSpy.mockRestore();
  });

  it("surfaces the server's error message plainly on failure", async () => {
    const routes: Record<string, Handler> = {
      'PATCH /api/decisions': (_req, res) => json(res, 404, { error: 'Decision not found' }),
    };
    const { baseUrl, close: c } = await startMockDaemon(routes);
    close = c;

    await expect(decisionsAnswer(baseUrl, 'dec_missing', 'anything')).rejects.toThrow(
      'Decision not found',
    );
  });
});
