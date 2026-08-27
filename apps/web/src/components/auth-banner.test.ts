/**
 * Pins the wiring `auth-banner.test.ts` (in `lib/`) can't reach without a
 * jsdom render — this vitest config is node-only, so this reads the source
 * with fs, same convention as `governor-card.test.ts` / `use-connection.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './auth-banner.tsx'), 'utf-8');

describe('AuthBanner — rescan flow', () => {
  it('"Check again" POSTs /api/backends/rescan and refreshes from its response', () => {
    const rescanStart = SOURCE.indexOf('async function rescan()');
    expect(rescanStart).toBeGreaterThan(-1);
    const rescanBody = SOURCE.slice(rescanStart, SOURCE.indexOf('\n}', rescanStart));
    expect(rescanBody).toContain("apiFetch('/api/backends/rescan', { method: 'POST' })");
    expect(rescanBody).toContain('setBackends((await res.json()).backends)');
  });

  it('polls /api/backends on its own — GET, not the rescan route', () => {
    expect(SOURCE).toContain("apiFetch('/api/backends')");
    expect(SOURCE).toContain('useSmartPoll(refetch');
  });
});

describe('AuthBanner — trigger gate', () => {
  it('derives the active backend from execution.backendMode via the shared helper', () => {
    expect(SOURCE).toContain('activeBackend(config.execution.backendMode)');
  });

  it('renders nothing when authBannerReason has no reason', () => {
    expect(SOURCE).toContain('if (!reason) return null;');
  });

  it('does not hard-block submission — no disabling of the composer or its submit path', () => {
    expect(SOURCE).not.toMatch(/disabled(Composer|Submit)/);
  });

  it('links to Settings → Agents, matching the #agents anchor added to AgentsCard', () => {
    expect(SOURCE).toContain('href="/settings#agents"');
  });
});
