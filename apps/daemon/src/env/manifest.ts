/**
 * manifest.ts — The env registry: data/ephemeral-envs.json.
 *
 * Every read-modify-write goes through withFileLock (the daemon's cross-process
 * mkdir mutex) because the daemon, the acceptance script and any number of
 * parallel createEnv() calls all touch this file.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withFileLock } from '../engine/file-lock';
import { DATA_DIR, ENVS_DIR, REPO_ROOT } from '../paths';
import type { EnvManifest, PhaseTimings } from './types';

/** Timings merge field-by-field; everything else replaces. */
export type EnvPatch = Partial<Omit<EnvManifest, 'timings'>> & { timings?: Partial<PhaseTimings> };

/**
 * The env registry's roots come from ../paths. Worktrees are cut from
 * REPO_ROOT but land in ENVS_DIR (`~/.ligma/envs`), which is deliberately not
 * inside any checkout. Override with LIGMA_REPO_ROOT / LIGMA_DATA_DIR /
 * LIGMA_ENVS_DIR (the throwaway-repo escape hatch the lifecycle tests use).
 */
export { ENVS_DIR, REPO_ROOT };
const MANIFEST_PATH = path.join(DATA_DIR, 'ephemeral-envs.json');
const LOCK_NAME = 'ephemeral-envs';

interface ManifestFile {
  envs: EnvManifest[];
}

function readUnlocked(): ManifestFile {
  if (!existsSync(MANIFEST_PATH)) return { envs: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as ManifestFile;
  } catch {
    // Corrupt manifest is worse than no manifest, but never silently: callers
    // see an empty list and reconcileOrphans() will report the stray worktrees.
    return { envs: [] };
  }
}

function writeUnlocked(data: ManifestFile): void {
  mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function listEnvs(): EnvManifest[] {
  return withFileLock(LOCK_NAME, () => readUnlocked().envs);
}

export function getEnv(id: string): EnvManifest | undefined {
  return listEnvs().find((e) => e.id === id);
}

/** Insert or replace an entry wholesale. */
export function putEnv(env: EnvManifest): void {
  withFileLock(LOCK_NAME, () => {
    const data = readUnlocked();
    const i = data.envs.findIndex((e) => e.id === env.id);
    if (i === -1) data.envs.push(env);
    else data.envs[i] = env;
    writeUnlocked(data);
  });
}

/**
 * Merge a partial update, stamping updatedAt. This is what makes a crashed
 * createEnv() diagnosable: the last status/timing written survives the crash.
 */
export function patchEnv(id: string, patch: EnvPatch): EnvManifest {
  return withFileLock(LOCK_NAME, () => {
    const data = readUnlocked();
    const i = data.envs.findIndex((e) => e.id === id);
    if (i === -1) throw new Error(`No such env: ${id}`);
    const merged: EnvManifest = {
      ...data.envs[i],
      ...patch,
      timings: { ...data.envs[i].timings, ...(patch.timings ?? {}) },
      updatedAt: new Date().toISOString(),
    };
    data.envs[i] = merged;
    writeUnlocked(data);
    return merged;
  });
}

/** Signal 0 probes liveness without delivering anything. ESRCH = gone. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ReconcileReport {
  /** Envs claiming to be up whose process is gone. */
  markedFailed: string[];
  /** Directories in .envs/ with no manifest entry. Reported, never deleted. */
  orphanWorktrees: string[];
}

/**
 * Pure half of reconcileOrphans: which envs are lying about being up.
 * An env with status ready/booting and a dead (or absent) pid is failed.
 */
export function findDeadEnvs(envs: EnvManifest[], isAlive: (pid: number) => boolean): string[] {
  return envs
    .filter(
      (e) =>
        (e.status === 'ready' || e.status === 'booting') && (e.pid === null || !isAlive(e.pid)),
    )
    .map((e) => e.id);
}

export function reconcileOrphans(isAlive: (pid: number) => boolean = isPidAlive): ReconcileReport {
  const markedFailed = findDeadEnvs(listEnvs(), isAlive);
  for (const id of markedFailed) {
    patchEnv(id, { status: 'failed', error: 'Process not running (reconciled)' });
  }

  // Drop worktree registrations whose directories are already gone.
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {
    // Not fatal — prune is housekeeping.
  }

  const known = new Set(listEnvs().map((e) => e.id));
  const orphanWorktrees = existsSync(ENVS_DIR)
    ? readdirSync(ENVS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !known.has(d.name))
        .map((d) => path.join(ENVS_DIR, d.name))
    : [];

  return { markedFailed, orphanWorktrees };
}
