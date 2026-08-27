import { execFileSync } from 'node:child_process';
/**
 * `GET /api/about` — the Settings → About panel (OD-098): version, commit,
 * nothing else. Both reads are best-effort: a missing/unparsable
 * package.json or a checkout with no git history (e.g. a tarball install)
 * degrades to a placeholder rather than a 500.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from '../../http';
import { REPO_ROOT } from '../../paths';

export interface AboutInfo {
  version: string;
  /** Short commit hash, or null when git metadata isn't available. */
  commit: string | null;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readCommit(): string | null {
  try {
    return (
      execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const info: AboutInfo = { version: readVersion(), commit: readCommit() };
  return NextResponse.json(info);
}
