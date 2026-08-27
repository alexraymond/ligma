/**
 * product-repo.ts — where a greenfield product's code actually lives.
 *
 * Before this, a project promoted from a brief had `repoPath: null`, so its
 * builders ran in the ligma checkout and wrote the product into the factory
 * (build brief §7 D1). A promote on such a project now provisions a real git
 * repo under `LIGMA_PRODUCTS_DIR` (default `~/ligma-products/<slug>`) and
 * records it on the project — after which every downstream path (builder cwd,
 * `.ligma/` knowledge, journeys, the verification worktree) already knows what
 * to do with a repoPath, because adoption taught them.
 *
 * Idempotent by the only definition that matters here: a project that already
 * has a repoPath is left alone. A directory that already holds commits is an
 * ERROR, never an overwrite — a slug collision with someone's real work must
 * not be resolved by writing into it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachedConfig } from '../engine/config-cache';
import { getProjects, mutateProjects } from './data';
import { bootPath } from './ligma-dir';

export type ProductsRootSource = 'env' | 'configured' | 'default';

/**
 * The parent directory every built product gets a checkout under, and which
 * of the three tiers decided it (OD-097): `LIGMA_PRODUCTS_DIR` beats a root
 * configured in daemon config (Settings → Project locations), which beats the
 * `~/ligma-products` default.
 */
export function productsRootInfo(): { path: string; source: ProductsRootSource } {
  if (process.env.LIGMA_PRODUCTS_DIR) {
    return { path: path.resolve(process.env.LIGMA_PRODUCTS_DIR), source: 'env' };
  }
  const configured = cachedConfig().storage.productsDir;
  if (configured?.trim()) {
    return { path: path.resolve(configured), source: 'configured' };
  }
  return { path: path.join(os.homedir(), 'ligma-products'), source: 'default' };
}

/** The parent directory every built product gets a checkout under. */
export function productsRoot(): string {
  return productsRootInfo().path;
}

/** How long a product directory name may be, before the whole-word trim. */
const SLUG_MAX = 48;

/**
 * A project name as a directory name. Falls back to the id, which is safe by
 * construction.
 *
 * Truncation stops at a word boundary: a hard `.slice(48)` cut mid-word and
 * left the user living in a directory called `…-with-rate-li` (process audit
 * P23). A single word longer than the limit still gets cut — there is no
 * boundary to find — and the trailing hyphen is stripped either way.
 */
export function productSlug(name: string, projectId: string): string {
  const full = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= SLUG_MAX) return full || projectId;

  const cut = full.slice(0, SLUG_MAX);
  const lastBoundary = cut.lastIndexOf('-');
  const slug = (lastBoundary > 0 ? cut.slice(0, lastBoundary) : cut).replace(/-+$/, '');
  return slug || projectId;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** True when this directory is a git repo with at least one commit. */
function hasCommits(dir: string): boolean {
  try {
    git(['rev-parse', '--verify', 'HEAD'], dir);
    return true;
  } catch {
    return false;
  }
}

const README = (name: string, description: string): string =>
  [
    `# ${name}`,
    '',
    description.trim() || '_No description yet._',
    '',
    '## Quickstart',
    '',
    '_The build has not written this yet. A consumer persona will follow whatever',
    'ends up here, so it has to be true._',
    '',
  ].join('\n');

/**
 * The boot recipe every greenfield repo is provisioned with (process audit P12).
 *
 * Two properties, and it needs both. It is a **valid** recipe — the artifact
 * shape, the smallest one the schema accepts — so a fresh product repo is never
 * in the "no recipe at all" state whose only surface was a re-dispatch loop.
 * And it is **marked** `stub: true`, because a valid placeholder that nobody
 * can tell apart from a real recipe is worse than the loop: it would pass the
 * boot gate and verify every greenfield product by reading its README forever.
 * Seeding without the marker, and without the gate that reads it, trades a loud
 * failure for a silent one.
 *
 * `stub` is not part of `bootRecipeSchema`, so zod strips it on read and the
 * moment a builder rewrites the file through `writeBoot` the mark is gone.
 * That is the whole lifecycle: seeded marked, replaced unmarked.
 */
export const STUB_BOOT = {
  stub: true,
  appDir: '.',
  install: null,
  dev: null,
  artifacts: ['README.md'],
  check: null,
};

/**
 * True when this repo's `.ligma/boot.json` is still the placeholder
 * provisioning wrote. Reads the file rather than `readBoot`, which parses the
 * marker away.
 */
export function isStubBoot(repoPath: string): boolean {
  try {
    const raw: unknown = JSON.parse(readFileSync(bootPath(repoPath), 'utf-8'));
    return typeof raw === 'object' && raw !== null && (raw as { stub?: unknown }).stub === true;
  } catch {
    return false;
  }
}

/**
 * Create the repo at `dir`: init, seed a README, first commit. Returns `dir`.
 *
 * Throws if `dir` already holds commits. An existing EMPTY directory is fine —
 * that is a half-finished previous attempt, not someone's work.
 *
 * The seed commit is the factory's, not the user's: it is authored with ligma's
 * own identity so a machine in a fresh container without a git identity can
 * still make it.
 */
export function provisionRepo(dir: string, name: string, description = ''): string {
  if (existsSync(dir)) {
    if (hasCommits(dir)) {
      throw new Error(
        `Refusing to provision ${dir}: it already exists and has commits. Point the project at it explicitly (PATCH /api/projects/:id {repoPath}) if it is the product's repo.`,
      );
    }
    if (readdirSync(dir).some((entry) => entry !== '.git')) {
      throw new Error(`Refusing to provision ${dir}: it already exists and is not empty.`);
    }
  }

  mkdirSync(dir, { recursive: true });
  if (!existsSync(path.join(dir, '.git'))) git(['init', '-q', '-b', 'main'], dir);
  writeFileSync(path.join(dir, 'README.md'), README(name, description), 'utf-8');
  mkdirSync(path.dirname(bootPath(dir)), { recursive: true });
  writeFileSync(bootPath(dir), `${JSON.stringify(STUB_BOOT, null, 2)}\n`, 'utf-8');
  git(['add', '-A'], dir);
  git(
    [
      '-c',
      'user.name=ligma',
      '-c',
      'user.email=ligma@localhost',
      'commit',
      '-qm',
      'chore: seed product repo',
    ],
    dir,
  );
  return dir;
}

/**
 * The repo for this project, provisioning one if it has none.
 *
 * A project that already carries a repoPath — an adopted repo, or ligma itself
 * — is returned unchanged and nothing is created. That is also the whole of the
 * "never provision over ligma" rule: ligma's own project row has a repoPath.
 */
export async function ensureProductRepo(projectId: string): Promise<string> {
  const { projects } = await getProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (project.repoPath) return project.repoPath;

  const dir = path.join(productsRoot(), productSlug(project.name, project.id));
  provisionRepo(dir, project.name, project.description);

  await mutateProjects(async (data) => {
    const row = data.projects.find((p) => p.id === projectId);
    if (row) row.repoPath = dir;
  });
  return dir;
}
