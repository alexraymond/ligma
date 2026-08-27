import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

/** A minimal mock daemon: routes by exact `METHOD path` (path includes query string). */
export async function startMockDaemon(
  routes: Record<string, Handler>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      const key = `${req.method} ${req.url}`;
      const handler = routes[key];
      if (!handler) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `no mock route for ${key}` }));
        return;
      }
      handler(req, res, body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected a bound port');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
