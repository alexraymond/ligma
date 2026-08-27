/**
 * types.ts — Ephemeral environment contracts.
 *
 * An "env" is a disposable copy of a product under test: its own git worktree,
 * its own node_modules, its own seeded data, its own port. Phase 2's tester
 * agents get nothing but the resolved URL.
 */

export type EnvStatus =
  | 'creating'
  | 'installing'
  | 'seeding'
  | 'booting'
  | 'ready'
  | 'failed'
  | 'torn-down';

/** Wall-clock duration of each lifecycle phase, in ms. null = phase not run. */
export interface PhaseTimings {
  worktreeMs: number | null;
  installMs: number | null;
  seedMs: number | null;
  bootMs: number | null;
  healthMs: number | null;
  totalMs: number | null;
}

/** Per-file record counts written by seed(). */
export interface SeedSummary {
  seed: number;
  counts: Record<string, number>;
}

export interface EnvManifest {
  /** "env_" + timestamp + random suffix. */
  id: string;
  taskId: string | null;
  productId: string | null;
  worktreePath: string;
  branch: string;
  baseCommit: string;
  port: number | null;
  url: string | null;
  /** Process-group leader of the booted product. Kill with -pid. */
  pid: number | null;
  status: EnvStatus;
  timings: PhaseTimings;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  seedSummary: SeedSummary | null;
}

/**
 * A product under test. Only "web" exists today; "cli" (pty) and "api" (http
 * client) are the intended future kinds — no stubs until something needs them.
 */
export interface TargetAdapter {
  kind: 'web';
  install(env: EnvManifest): Promise<void>;
  seed(env: EnvManifest): Promise<SeedSummary>;
  boot(env: EnvManifest): Promise<{ pid: number; url: string }>;
  health(env: EnvManifest): Promise<boolean>;
  teardown(env: EnvManifest): Promise<void>;
}
