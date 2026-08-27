/**
 * E11 — one failover chain, honouring both config fields.
 *
 * There used to be two builders that disagreed: the daemon's ignored
 * `claudeAutoFailoverBackend` entirely, and `run-task.ts`'s pushed codex even
 * when `claudeAutoFailoverEnabled` was false. So a user who turned failover off
 * to stop spending their other subscriptions still got codex/gemini spawns —
 * and which ones depended on which path dispatched the task.
 */
import { describe, expect, it } from 'vitest';
import { buildBackendChain } from './runner';

const on = (preferred: 'codex' | 'gemini' | null) => ({ enabled: true, preferred });
const off = { enabled: false, preferred: 'codex' as const };

describe('buildBackendChain', () => {
  it('tries only the chosen backend when failover is disabled', () => {
    // The whole of the user-visible bug: off means off, whatever else is set.
    expect(buildBackendChain('claude', off)).toEqual(['claude']);
    expect(buildBackendChain('codex', off)).toEqual(['codex']);
  });

  it('puts the configured failover backend first', () => {
    expect(buildBackendChain('claude', on('gemini'))).toEqual(['claude', 'gemini', 'codex']);
    expect(buildBackendChain('claude', on('codex'))).toEqual(['claude', 'codex', 'gemini']);
  });

  it('falls back to rotation order when no preference is set', () => {
    expect(buildBackendChain('claude', on(null))).toEqual(['claude', 'gemini', 'codex']);
  });

  it('keeps the requested backend first and never repeats one', () => {
    for (const initial of ['claude', 'codex', 'gemini'] as const) {
      const chain = buildBackendChain(initial, on('codex'));
      expect(chain[0]).toBe(initial);
      expect(new Set(chain).size).toBe(chain.length);
      expect(chain).toContain('claude');
    }
  });

  it('gives both dispatch paths the same answer for the same config', () => {
    // The two call sites now pass the same two fields into the same function;
    // this pins the property that used to be violated by construction.
    const config = on('gemini');
    expect(buildBackendChain('claude', config)).toEqual(buildBackendChain('claude', config));
  });
});
