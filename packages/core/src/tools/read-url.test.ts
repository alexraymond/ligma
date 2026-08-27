import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeReadUrlTool } from './read-url.js';

const tool = makeReadUrlTool();
const run = (url: string) => tool.execute('id', { url }, undefined as never);

afterEach(() => {
  vi.unstubAllGlobals();
});

// P7 — the URL here is model-chosen and the model's context can carry
// attacker text, so an injected `read_url` was a straight line to the cloud
// metadata endpoint or the user's own localhost daemon.
describe('read_url request guard', () => {
  it('rejects non-http(s) schemes', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(run('file:///etc/passwd')).rejects.toThrow(/http\/https/);
    await expect(run('data:text/html,<b>x</b>')).rejects.toThrow(/http\/https/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects loopback, link-local and private addresses', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const url of [
      'http://localhost:4477/api/tasks',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
    ]) {
      await expect(run(url)).rejects.toThrow(/private \/ loopback/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows a public https URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<p>hello</p>', { status: 200 })),
    );
    const res = await run('https://example.test/page');
    expect(res.details.status).toBe(200);
    expect(res.content[0]).toMatchObject({ text: 'hello' });
  });

  it('re-validates every redirect hop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          }),
      ),
    );
    await expect(run('https://example.test/redirector')).rejects.toThrow(/private \/ loopback/);
  });

  it('stops reading once the body cap is hit', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(256 * 1024));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                pulled += 1;
                if (pulled > 200) {
                  controller.close();
                  return;
                }
                controller.enqueue(chunk);
              },
            }),
            { status: 200 },
          ),
      ),
    );
    await run('https://example.test/huge');
    // 2 MB cap / 256 KB chunks — a handful of pulls, not the whole 50 MB.
    expect(pulled).toBeLessThan(16);
  });
});
