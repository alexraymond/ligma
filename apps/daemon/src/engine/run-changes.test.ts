import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * The commit a run started from, and the diff it left behind.
 *
 * Everything here is best-effort by design, so most of these tests are about the
 * NON-happy paths: a repo-less cwd, a directory that does not exist, a diff too
 * big to keep. None of them may throw — a run must never die because its
 * bookkeeping did.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const outputsDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-run-changes-out-'));
process.env.MC_RUN_OUTPUTS_DIR = outputsDir;

import {
  type RunChanges,
  captureChanges,
  headSha,
  runArtifactPath,
  writePromptFile,
} from './run-changes';

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'ligma-run-changes-'));
const repo = path.join(tmpRoot, 'repo');
const notARepo = path.join(tmpRoot, 'plain');
let firstSha = '';

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  mkdirSync(notARepo, { recursive: true });
  writeFileSync(path.join(notARepo, 'file.txt'), 'just a directory\n', 'utf-8');

  git(['init', '-q', '-b', 'main']);
  writeFileSync(path.join(repo, 'kept.txt'), 'original\n', 'utf-8');
  git(['add', '.']);
  git(['commit', '-qm', 'first']);
  firstSha = git(['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(outputsDir, { recursive: true, force: true });
});

describe('headSha', () => {
  it('reads HEAD in a real repo', () => {
    expect(headSha(repo)).toBe(firstSha);
    expect(firstSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns null for a directory that is not a repo', () => {
    expect(headSha(notARepo)).toBeNull();
  });

  it('returns null for a path that does not exist', () => {
    expect(headSha(path.join(tmpRoot, 'nope'))).toBeNull();
  });

  it.each([null, undefined, ''])('returns null for %j rather than shelling out', (cwd) => {
    expect(headSha(cwd)).toBeNull();
  });

  it('returns null for a repo with no commits yet', () => {
    // `git init` with nothing committed: a repo, but no HEAD to point at. Still
    // "there is no commit", which is the only thing the caller needs.
    const empty = path.join(tmpRoot, 'empty-repo');
    mkdirSync(empty, { recursive: true });
    git(['init', '-q'], empty);
    expect(headSha(empty)).toBeNull();
  });
});

describe('captureChanges', () => {
  const read = (file: string): RunChanges => JSON.parse(readFileSync(file, 'utf-8')) as RunChanges;

  it('captures a tracked edit, an untracked file and the base commit', () => {
    writeFileSync(path.join(repo, 'kept.txt'), 'original\nedited by the builder\n', 'utf-8');
    writeFileSync(path.join(repo, 'brand-new.txt'), 'created by the builder\n', 'utf-8');

    const file = captureChanges('run_capture', repo, firstSha);
    expect(file).not.toBeNull();
    const changes = read(file!);

    expect(changes.commitSha).toBe(firstSha);
    expect(changes.stat).toContain('kept.txt');
    expect(changes.diff).toContain('edited by the builder');
    // The untracked file is the whole reason `status` is captured: a builder
    // that never commits leaves ALL its work outside the diff, and reporting
    // that as an empty run would be exactly backwards.
    expect(changes.status).toContain('brand-new.txt');
    expect(changes.truncated).toBe(false);
    expect(Date.parse(changes.capturedAt)).not.toBeNaN();
  });

  it('records a clean repo as empty strings, not as a failure', () => {
    const clean = path.join(tmpRoot, 'clean-repo');
    mkdirSync(clean, { recursive: true });
    git(['init', '-q', '-b', 'main'], clean);
    writeFileSync(path.join(clean, 'a.txt'), 'a\n', 'utf-8');
    git(['add', '.'], clean);
    git(['commit', '-qm', 'only'], clean);

    const file = captureChanges('run_clean', clean, git(['rev-parse', 'HEAD'], clean));
    const changes = read(file!);
    // "" means the run changed nothing. The route turns a MISSING capture into
    // null instead, so the two stay tellable apart.
    expect(changes.diff).toBe('');
    expect(changes.status).toBe('');
  });

  it('caps a huge diff and says so', () => {
    const big = path.join(tmpRoot, 'big-repo');
    mkdirSync(big, { recursive: true });
    git(['init', '-q', '-b', 'main'], big);
    writeFileSync(path.join(big, 'seed.txt'), 'seed\n', 'utf-8');
    git(['add', '.'], big);
    git(['commit', '-qm', 'seed'], big);
    const base = git(['rev-parse', 'HEAD'], big);

    // ~1.5MB of added lines, comfortably past the 512KB cap.
    writeFileSync(path.join(big, 'seed.txt'), `${'x'.repeat(60)}\n`.repeat(25_000), 'utf-8');

    const changes = read(captureChanges('run_big', big, base)!);
    expect(changes.truncated).toBe(true);
    expect(Buffer.byteLength(changes.diff, 'utf-8')).toBeLessThanOrEqual(512 * 1024);
    // Truncation is never silent: a capped diff that claimed to be whole would
    // let a reviewer conclude a change was absent when it was merely cut off.
    expect(changes.stat).toContain('seed.txt');
  });

  it('returns null instead of throwing when the cwd is not a repo', () => {
    expect(captureChanges('run_norepo', notARepo, firstSha)).toBeNull();
  });

  it('returns null instead of throwing when the base commit is unknown', () => {
    expect(captureChanges('run_badsha', repo, '0'.repeat(40))).toBeNull();
  });

  it('sanitizes the run id so it cannot write outside the outputs dir', () => {
    const file = captureChanges('../../escape', repo, firstSha);
    expect(path.dirname(file!)).toBe(outputsDir);
    expect(path.basename(file!)).toBe('______escape.changes.json');
  });
});

describe('writePromptFile', () => {
  it('round-trips the prompt verbatim', () => {
    const prompt = 'You are the builder.\n\n## Task\nWire the button.\n';
    const file = writePromptFile('run_prompt', prompt);
    expect(file).toBe(runArtifactPath('run_prompt', '.prompt.txt'));
    expect(readFileSync(file!, 'utf-8')).toBe(prompt);
  });

  it('scrubs a credential the prompt happened to carry', () => {
    const file = writePromptFile(
      'run_secret',
      'export ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA\n',
    );
    expect(readFileSync(file!, 'utf-8')).not.toContain('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA');
  });
});
