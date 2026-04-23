import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSessionPaths } from './paths.js';

describe('resolveSessionPaths', () => {
  it('defaults to ~/.config/ligma when no override is passed', () => {
    const paths = resolveSessionPaths();
    expect(paths.rootDir).toMatch(/[\\/]\.config[\\/]ligma$/);
    expect(paths.sessionsDir).toMatch(/[\\/]sessions$/);
  });

  it('honors override.rootDir for tests', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'session-paths-'));
    const paths = resolveSessionPaths({ rootDir: tmp });
    expect(paths.rootDir).toBe(tmp);
    expect(paths.transcriptPath('abc-123')).toBe(
      join(tmp, 'sessions', 'abc-123', 'transcript.jsonl'),
    );
    expect(paths.blobPath('abc-123', 'fp')).toBe(join(tmp, 'sessions', 'abc-123', 'files', 'fp'));
  });

  it('rejects sessionIds containing path traversal', () => {
    const paths = resolveSessionPaths({ rootDir: '/tmp/fake' });
    expect(() => paths.transcriptPath('../evil')).toThrow();
    expect(() => paths.transcriptPath('a/b')).toThrow();
  });

  it('rejects malformed fingerprints', () => {
    const paths = resolveSessionPaths({ rootDir: '/tmp/fake' });
    expect(() => paths.blobPath('sess', '../evil')).toThrow();
  });
});
