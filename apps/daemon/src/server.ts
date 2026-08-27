import { DEFAULT_DAEMON_PORT } from '@ligma/api';
/**
 * The daemon's HTTP + SSE face, on 127.0.0.1 only (single user, localhost —
 * build brief §8). `LIGMA_DAEMON_PORT` overrides the port.
 *
 * Started in-process by the engine (src/engine/index.ts) so one `daemon:start`
 * gives you the API and the dispatcher loop together. Running this file
 * directly serves the API alone — the shape the web e2e run and the CLI want,
 * with no agent spawning.
 */
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { apiRouter } from './routes';

export const PORT = Number(process.env.LIGMA_DAEMON_PORT) || DEFAULT_DAEMON_PORT;
export const HOST = '127.0.0.1';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // The handlers parse their own bodies (`await request.json()`), exactly as
  // they did under Next — so the body arrives here as untouched text.
  app.use(express.text({ type: '*/*', limit: '50mb' }));
  app.use(apiRouter());
  // Every real route speaks JSON; an unknown `/api/*` path used to answer with
  // Express's HTML error page, so an agent probing the surface got
  // `<!DOCTYPE html>` where it expected an error object (process audit P15).
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // The message is logged in full and answered generically: `err.message`
    // from an unhandled throw is routinely an ENOENT carrying an absolute
    // server path, and the response is the one place that must not publish the
    // filesystem layout (codebase audit R6).
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[daemon] unhandled route error: ${message}`);
    res.status(500).json({ error: 'Internal daemon error — see the daemon log for the cause.' });
  });
  return app;
}

export interface DaemonServer {
  port: number;
  close: () => Promise<void>;
}

export function startHttpServer(port: number = PORT): Promise<DaemonServer> {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST);
    server.once('listening', () => {
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  startHttpServer()
    .then((server) => {
      console.log(`ligma daemon API listening on http://${HOST}:${server.port}`);
    })
    .catch((err: unknown) => {
      console.error(
        `Failed to start daemon API: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    });
}
