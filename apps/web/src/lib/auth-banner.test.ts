/**
 * The auth banner's trigger logic and copy — DOM-free, same convention as
 * `composer.test.ts` (vitest covers this without mounting `<AuthBanner>`).
 */
import { describe, expect, it } from 'vitest';
import {
  type AuthStatus,
  type Backend,
  activeBackend,
  authBannerCopy,
  authBannerReason,
} from './auth-banner';

function probe(available: boolean, authStatus: AuthStatus) {
  return { available, authStatus };
}

describe('activeBackend', () => {
  it('mixed still counts as claude — dispatcher.ts routes builder work through it', () => {
    expect(activeBackend('mixed')).toBe('claude');
  });

  it('passes claude/codex/gemini through unchanged', () => {
    expect(activeBackend('claude')).toBe('claude');
    expect(activeBackend('codex')).toBe('codex');
    expect(activeBackend('gemini')).toBe('gemini');
  });
});

describe('authBannerReason', () => {
  it('stays quiet while the probe has not answered yet — unknown is not broken', () => {
    expect(authBannerReason('claude', undefined)).toBeNull();
  });

  it('triggers "no-binary" for any active backend with no binary found', () => {
    const backends: Backend[] = ['claude', 'codex', 'gemini'];
    for (const b of backends) {
      expect(authBannerReason(b, probe(false, 'unknown'))).toBe('no-binary');
    }
  });

  it('triggers "not-signed-in" only when claude is active and unauthenticated', () => {
    expect(authBannerReason('claude', probe(true, 'unauthenticated'))).toBe('not-signed-in');
  });

  it('never triggers for codex/gemini unauthenticated — their probe can never report that', () => {
    expect(authBannerReason('codex', probe(true, 'unauthenticated'))).toBeNull();
    expect(authBannerReason('gemini', probe(true, 'unauthenticated'))).toBeNull();
  });

  it("'unknown' with a found binary never triggers — codex/gemini can't determine auth", () => {
    expect(authBannerReason('claude', probe(true, 'unknown'))).toBeNull();
    expect(authBannerReason('codex', probe(true, 'unknown'))).toBeNull();
    expect(authBannerReason('gemini', probe(true, 'unknown'))).toBeNull();
  });

  it('is quiet once claude reports authenticated', () => {
    expect(authBannerReason('claude', probe(true, 'authenticated'))).toBeNull();
  });
});

describe('authBannerCopy', () => {
  it('gives claude no-binary an exact, verified install + sign-in command', () => {
    const copy = authBannerCopy('claude', 'no-binary');
    expect(copy.command).toBe('npm i -g @anthropic-ai/claude-code');
    expect(copy.title).toContain('Claude Code');
  });

  it('gives claude not-signed-in the exact sign-in command', () => {
    const copy = authBannerCopy('claude', 'not-signed-in');
    expect(copy.command).toBe('claude');
    expect(copy.title).toContain('Not signed in');
  });

  it('never invents an install command for codex/gemini — no verified CLI surface for it', () => {
    expect(authBannerCopy('codex', 'no-binary').command).toBeNull();
    expect(authBannerCopy('gemini', 'no-binary').command).toBeNull();
  });
});
