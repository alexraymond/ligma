import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CliError, daemonJson } from '../src/client';

describe('daemon unreachable', () => {
  it('prints a plain, actionable message instead of a raw fetch error', async () => {
    // Bind and immediately close to get a port nothing is listening on.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('expected a bound port');
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const baseUrl = `http://127.0.0.1:${port}`;
    await expect(daemonJson(baseUrl, '/api/projects')).rejects.toThrow(
      new CliError(
        `daemon not reachable at ${baseUrl} — is it running? (pnpm --filter @ligma/daemon daemon:start)`,
      ),
    );
  });
});
