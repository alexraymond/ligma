/**
 * W23: `useConnection` used to only check the daemon on the first 30s
 * `setInterval` tick, and treated the browser's `online` event as proof the
 * daemon itself was reachable. No jsdom in this vitest config (the hook needs
 * a real `window`/`navigator` to render), so this pins the source facts a
 * render would otherwise verify — same convention as `task-detail-panel.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './use-connection.ts'), 'utf-8');

describe('useConnection — checks the daemon, not just the network (W23)', () => {
  it('checks immediately on mount rather than waiting for the first interval tick', () => {
    const effectStart = SOURCE.indexOf('useEffect(() => {');
    const intervalCall = SOURCE.indexOf('setInterval(checkConnection', effectStart);
    const eagerCall = SOURCE.lastIndexOf('void checkConnection();', intervalCall);
    expect(eagerCall).toBeGreaterThan(effectStart);
    expect(eagerCall).toBeLessThan(intervalCall);
  });

  it("re-verifies against the daemon on the browser's `online` event instead of assuming reachable", () => {
    expect(SOURCE).toContain('const handleOnline = () => void checkConnection();');
    expect(SOURCE).not.toContain('const handleOnline = () => setOnline(true);');
  });

  it("still trusts the browser's `offline` event directly — no network means no daemon either", () => {
    expect(SOURCE).toContain('const handleOffline = () => setOnline(false);');
  });
});
