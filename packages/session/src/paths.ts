import { homedir } from 'node:os';
import { join } from 'node:path';

// Session storage layout:
//   ~/.config/ligma/sessions/<sessionId>/transcript.jsonl
//   ~/.config/ligma/sessions/<sessionId>/files/<fingerprint>
//
// W3 renames the `@open-codesign/*` → `@ligma/*` tree-wide and bumps the
// config-dir constant; this package is ahead of the rename and hardcodes
// `~/.config/ligma/` so the two efforts line up at merge time.

export interface SessionPaths {
  rootDir: string;
  sessionsDir: string;
  transcriptPath: (sessionId: string) => string;
  filesDir: (sessionId: string) => string;
  blobPath: (sessionId: string, fingerprint: string) => string;
  sessionDir: (sessionId: string) => string;
}

/** Override the base `~/.config/ligma` path. Used by tests to point at a
 *  tmpdir so real user state is never touched. */
export interface PathsOverride {
  rootDir?: string;
}

export function resolveSessionPaths(override: PathsOverride = {}): SessionPaths {
  const rootDir = override.rootDir ?? defaultRootDir();
  const sessionsDir = join(rootDir, 'sessions');
  const sessionDir = (sessionId: string): string => join(sessionsDir, sanitizeSessionId(sessionId));
  return {
    rootDir,
    sessionsDir,
    sessionDir,
    transcriptPath: (sessionId) => join(sessionDir(sessionId), 'transcript.jsonl'),
    filesDir: (sessionId) => join(sessionDir(sessionId), 'files'),
    blobPath: (sessionId, fingerprint) =>
      join(sessionDir(sessionId), 'files', sanitizeFingerprint(fingerprint)),
  };
}

function defaultRootDir(): string {
  return join(homedir(), '.config', 'ligma');
}

// Defense against a caller passing a sessionId containing path traversal
// (`..`) or separators. Session ids are normally UUIDs so this is belt-
// and-braces, but the value flows in from IPC and we would rather reject
// loudly than write outside the sessions directory.
function sanitizeSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error(
      `Invalid sessionId "${sessionId}" — must match /^[A-Za-z0-9_-]+$/ (UUIDs qualify).`,
    );
  }
  return sessionId;
}

function sanitizeFingerprint(fingerprint: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(fingerprint)) {
    throw new Error(`Invalid fingerprint "${fingerprint}" — must match /^[A-Za-z0-9_-]+$/.`);
  }
  return fingerprint;
}
