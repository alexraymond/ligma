/**
 * Home composer auth banner — pure logic (trigger + copy), DOM-free by the
 * same convention as `composer.ts` / `failure/classify.ts`: vitest covers
 * this without mounting `<AuthBanner>`.
 *
 * There is no in-app auth: Ligma runs every backend through its CLI, which
 * inherits whatever session that CLI already has on the machine. A fresh
 * clone has no signal telling a new user that — the composer just accepts a
 * prompt that's doomed to fail once dispatched. This is the missing signal,
 * built on the same probe `AgentsCard` already renders (`GET /api/backends`).
 */

export type Backend = 'claude' | 'codex' | 'gemini';
export type BackendMode = 'claude' | 'mixed' | 'codex' | 'gemini';
export type AuthStatus = 'authenticated' | 'unauthenticated' | 'unknown';

export interface BackendProbeLike {
  available: boolean;
  authStatus: AuthStatus;
}

export type AuthBannerReason = 'no-binary' | 'not-signed-in';

const BACKEND_LABEL: Record<Backend, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

/** `mixed` still routes builder work through claude — see `dispatcher.ts`. */
export function activeBackend(mode: BackendMode): Backend {
  return mode === 'mixed' ? 'claude' : mode;
}

/**
 * `null` means "don't show the banner". Only two ways in:
 *  - no binary found, for whichever backend is active (any of the three)
 *  - `unauthenticated`, but ONLY when claude is the active backend — codex
 *    and gemini's probe can never confirm auth (`backend-probe.ts`'s
 *    `authStatusOf` hardcodes `'unknown'` for them), so `'unknown'` must
 *    never trigger this for any backend, claude included.
 *
 * `probe` is `undefined` while `/api/backends` hasn't answered yet — that's
 * "don't know", not "broken", so it stays quiet rather than flashing on load.
 */
export function authBannerReason(
  active: Backend,
  probe: BackendProbeLike | undefined,
): AuthBannerReason | null {
  if (!probe) return null;
  if (!probe.available) return 'no-binary';
  if (active === 'claude' && probe.authStatus === 'unauthenticated') return 'not-signed-in';
  return null;
}

export interface AuthBannerCopy {
  title: string;
  body: string;
  /** Present only when there's one exact command worth a copy button — never invented for a CLI we haven't verified. */
  command: string | null;
}

/**
 * Claude is the one CLI this daemon has verified auth commands against
 * (`backend-probe.ts`'s module doc) — codex/gemini get the daemon's own
 * `resolved.message` (already surfaced via `probe`'s caller) instead of a
 * guessed install command.
 */
export function authBannerCopy(active: Backend, reason: AuthBannerReason): AuthBannerCopy {
  const label = BACKEND_LABEL[active];

  if (reason === 'not-signed-in') {
    return {
      title: `Not signed in to ${label}`,
      body: "Ligma has no login of its own — it runs through this CLI's session. Run the command below in any terminal and complete the sign-in.",
      command: 'claude',
    };
  }

  // reason === 'no-binary'
  if (active === 'claude') {
    return {
      title: `${label} not found`,
      body: 'Ligma runs every prompt through this CLI. Install it, then run `claude` in any terminal and complete the sign-in.',
      command: 'npm i -g @anthropic-ai/claude-code',
    };
  }
  return {
    title: `${label} not found`,
    body: `Ligma's active backend is set to ${label}, but no binary was found on this machine. Install it, or switch backends in Settings → Agents.`,
    command: null,
  };
}
