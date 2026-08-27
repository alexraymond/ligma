import { DEFAULT_DAEMON_URL } from '@ligma/api';
import type { NextConfig } from 'next';

/**
 * The API lives in @ligma/daemon now. Web keeps calling the same `/api/*` URLs
 * with the same shapes — this rewrite is the only thing between them, so no
 * component, hook or test had to learn a new address.
 */
const DAEMON_URL = process.env.NEXT_PUBLIC_LIGMA_DAEMON_URL ?? DEFAULT_DAEMON_URL;

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${DAEMON_URL}/api/:path*` }];
  },
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost',
    'http://127.0.0.1',
    'localhost',
    '127.0.0.1',
  ],
  devIndicators: false,
  // @ligma/api and @ligma/runtime ship TypeScript source (no build step) — Next
  // compiles them. The Studio consumes @ligma/runtime/overlay (the sandboxed-iframe
  // pin overlay) as-is; its top-level entry stays unused because it inlines the
  // vendored UMD bundles through Vite's `?raw` assertion, which webpack lacks.
  transpilePackages: ['@ligma/api', '@ligma/runtime'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    /**
     * How long the `/api/*` rewrite above waits for the daemon. **Next's
     * default is 30s** (`next/dist/server/lib/router-utils/proxy-request.js`:
     * `proxyTimeout || 30000`), and that default is what made d1-attempt-1 red.
     *
     * The daemon's model-backed handlers answer in minutes, not seconds: one
     * live promote planner measured 48s, and discovery's spawn is capped at 5.
     * Past 30s the proxy abandons the request and answers with its own
     * plain-text "Internal Server Error" — no JSON body, so the client falls
     * back to `${status} ${statusText}` and the user reads the literal string
     * "500 Internal Server Error". The daemon meanwhile finishes the work
     * correctly and writes it to a socket nobody is listening on, which is why
     * its log had nothing to say. Every persona hit it, on every attempt, on
     * both `promote/preview` and `POST /api/briefs`.
     *
     * Ten minutes clears every synchronous daemon handler's own ceiling with
     * room to spare, and still fails a genuinely stuck request rather than
     * hanging the tab forever. The deadline that matters belongs in the
     * handler, which knows what it is waiting for; this is only the backstop.
     */
    proxyTimeout: 10 * 60_000,
  },
};

export default nextConfig;
