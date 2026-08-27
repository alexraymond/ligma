/**
 * boot-adapter.ts — any repo with a valid `.ligma/boot.json` gets an ephemeral env.
 *
 * This is `mission-control-adapter.ts` with the mission-control taken out: the
 * five things that adapter hardcoded (install command, dev command, how the port
 * is passed, what proves the app is alive, how to seed) are now the five fields
 * of a BootRecipe, and the recipe is data in the target repo (twin-primitives §2).
 *
 * Commands are argv arrays, so nothing is ever word-split, quoted, or handed to
 * a shell — `spawn(cmd, args, { shell: false })` throughout.
 */

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { type BootRecipe, type ServerBootRecipe, isArtifactBoot } from '@ligma/api';
import { buildSafeEnv } from '../engine/security';
import { bootLogPath, isPortFree } from './mission-control-adapter';
import type { EnvManifest, SeedSummary, TargetAdapter } from './types';

const execFileAsync = promisify(execFile);

const HEALTH_INTERVAL_MS = 500;
const SEED_TIMEOUT_MS = 5 * 60_000;

/**
 * Each phase gets its own budget, read at call time so a slow machine (or a
 * test that cannot wait two minutes) can raise or lower it without a rebuild.
 * Install is minutes because a cold dependency install downloads the world;
 * boot-to-healthy is seconds-to-a-minute because the server is already running.
 */
function budgetMs(varName: string, fallback: number): number {
  const n = Number(process.env[varName]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const healthTimeoutMs = (): number => budgetMs('LIGMA_ENV_HEALTH_TIMEOUT_MS', 120_000);
const installTimeoutMs = (): number => budgetMs('LIGMA_ENV_INSTALL_TIMEOUT_MS', 15 * 60_000);

/** The last few lines of a command's output — where package managers put the reason. */
function tail(text: string, lines = 12): string {
  const trimmed = text.trimEnd();
  return trimmed ? trimmed.split('\n').slice(-lines).join('\n') : '(it printed nothing)';
}

/** The last lines the dev server printed — the difference between a diagnosis and a guess. */
export function bootLogTail(envId: string, lines = 15): string {
  try {
    const text = readFileSync(bootLogPath(envId), 'utf-8').trimEnd();
    return text ? text.split('\n').slice(-lines).join('\n') : '(the dev server printed nothing)';
  } catch {
    return '(no dev server log)';
  }
}

/**
 * A fixed-port recipe is only viable if the port is actually free.
 *
 * Dev servers do not fail on a busy port — vite, vitepress and next print
 * "Port N is in use, trying another one..." and move to N+1, so health polling
 * N waits out the whole timeout against a server that is alive one port over.
 * Two concurrent envs of the same fixed recipe collide exactly this way, so the
 * second one is failed here, before it costs anyone two minutes.
 */
export async function assertFixedPortFree(port: number): Promise<void> {
  if (await isPortFree(port)) return;
  throw new Error(
    `Port ${port} is already in use and this repo's boot recipe pins it (portStrategy {"kind":"fixed","port":${port}}). A dev server given a busy port moves to the next free one instead of failing, so the env would never be reachable. Free the port (lsof -nP -iTCP:${port} -sTCP:LISTEN) or give the recipe a settable strategy — {"kind":"flag","flag":"--port"} or {"kind":"env","var":"PORT"} — so every env gets its own port.`,
  );
}

/** Where the recipe's commands run: the app dir, resolved inside the worktree. */
export function resolveAppDir(worktreePath: string, appDir: string): string {
  const resolved = path.resolve(worktreePath, appDir);
  const root = path.resolve(worktreePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`boot.json appDir escapes the worktree: ${appDir}`);
  }
  return resolved;
}

/** Apply the port strategy to the dev spawn. Returns the argv and the child env. */
export function applyPortStrategy(
  boot: ServerBootRecipe,
  port: number,
): { argv: string[]; env: NodeJS.ProcessEnv } {
  const env = buildSafeEnv() as NodeJS.ProcessEnv;
  switch (boot.portStrategy.kind) {
    case 'flag':
      return { argv: [...boot.dev, boot.portStrategy.flag, String(port)], env };
    case 'env':
      return { argv: [...boot.dev], env: { ...env, [boot.portStrategy.var]: String(port) } };
    case 'fixed':
      return { argv: [...boot.dev], env };
  }
}

/**
 * A "fixed" recipe cannot take the OS-assigned port, so the env must use the
 * port the product insists on. Returned to the lifecycle before boot.
 */
export function fixedPort(boot: BootRecipe): number | null {
  if (isArtifactBoot(boot)) return null; // nothing is served, so no port is pinned
  return boot.portStrategy.kind === 'fixed' ? boot.portStrategy.port : null;
}

export function createBootAdapter(boot: BootRecipe): TargetAdapter {
  const dirOf = (env: EnvManifest): string => resolveAppDir(env.worktreePath, boot.appDir);
  /**
   * null for an artifact recipe: it has nothing to seed, boot or poll, and
   * createEnv stops after install for exactly that reason. The three phases
   * below still refuse loudly rather than assuming they are unreachable.
   */
  const server: ServerBootRecipe | null = isArtifactBoot(boot) ? null : boot;
  const noServer = (phase: string): Error =>
    new Error(
      `${phase}() was called for an artifact recipe (dev: null) — there is no server to ${phase}`,
    );

  return {
    kind: 'web',

    async install(env) {
      if (!boot.install) return;
      const [cmd, ...args] = boot.install;
      try {
        await execFileAsync(cmd, args, {
          cwd: dirOf(env),
          env: buildSafeEnv() as NodeJS.ProcessEnv,
          maxBuffer: 32 * 1024 * 1024,
          timeout: installTimeoutMs(),
        });
      } catch (err) {
        // execFile's own message is "Command failed: pnpm install" and nothing
        // else — the package manager's diagnosis sits on `stderr`, which was
        // thrown away. That one line is the whole difference between a recipe
        // the human can correct and a dead end (D3 attempt 3, crit_goal).
        throw new Error(
          `${boot.install.join(' ')} failed in ${boot.appDir}: ${tail(
            (err as { stderr?: string }).stderr ||
              (err as { stdout?: string }).stdout ||
              String(err),
          )}`,
        );
      }
    },

    async seed(env): Promise<SeedSummary> {
      // No seed command is a legitimate recipe: an adopted repo may have its own
      // fixtures, or none. Recording zero counts is honest; inventing data is not.
      if (!server?.seed) return { seed: 0, counts: {} };
      const [cmd, ...args] = server.seed;
      await execFileAsync(cmd, args, {
        cwd: dirOf(env),
        env: buildSafeEnv() as NodeJS.ProcessEnv,
        maxBuffer: 32 * 1024 * 1024,
        timeout: SEED_TIMEOUT_MS,
      });
      return { seed: 0, counts: { [server.seed.join(' ')]: 1 } };
    },

    async boot(env) {
      if (!server) throw noServer('boot');
      if (env.port === null) throw new Error('boot() requires a port');
      const logPath = bootLogPath(env.id);
      mkdirSync(path.dirname(logPath), { recursive: true });
      const log = openSync(logPath, 'a');

      const { argv, env: childEnv } = applyPortStrategy(server, env.port);
      const [cmd, ...args] = argv;
      const child: ChildProcess = spawn(cmd, args, {
        cwd: dirOf(env),
        detached: true, // own process group, so teardown kills the whole tree
        stdio: ['ignore', log, log] as const,
        env: childEnv,
        shell: false,
      });
      child.unref();
      if (child.pid === undefined) throw new Error(`Failed to spawn dev server: ${argv.join(' ')}`);

      return { pid: child.pid, url: `http://localhost:${env.port}` };
    },

    async health(env) {
      if (!server) throw noServer('health');
      if (env.url === null) return false;
      const target = new URL(server.healthPath, env.url).toString();
      const budget = healthTimeoutMs();
      const deadline = Date.now() + budget;
      // What the LAST probe saw. A bare "never became healthy" cannot tell a
      // dead server from a live one whose page simply lacks the marker — the
      // second is what actually bit adoption, and it looked identical.
      let lastProbe = 'nothing answered on that port';
      while (Date.now() < deadline) {
        try {
          const res = await fetch(target, { signal: AbortSignal.timeout(10_000) });
          const body = await res.text();
          if (res.status === 200 && body.includes(server.healthMarker)) return true;
          lastProbe =
            res.status === 200
              ? `HTTP 200, but healthMarker ${JSON.stringify(server.healthMarker)} is not in the ${body.length}-byte body (a dev server for a client-rendered app serves an empty shell — the marker must be in the raw HTML)`
              : `HTTP ${res.status}`;
        } catch (err) {
          lastProbe = err instanceof Error ? err.message : String(err);
        }
        await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
      }
      throw new Error(
        `Env ${env.id} never became healthy at ${target}: install and boot both succeeded, then ${Math.round(budget / 1000)}s ` +
          `of health polling never passed. Last probe: ${lastProbe}.\nDev server log tail:\n${bootLogTail(env.id)}`,
      );
    },

    async teardown(env) {
      if (env.pid !== null) {
        try {
          process.kill(-env.pid, 'SIGTERM');
        } catch {
          // Already gone.
        }
        const graceUntil = Date.now() + 5_000;
        while (Date.now() < graceUntil) {
          try {
            process.kill(-env.pid, 0);
          } catch {
            break; // group is gone
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        try {
          process.kill(-env.pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }

      // Evidence, not hope: the port must actually be rebindable.
      if (env.port !== null) {
        for (let i = 0; i < 25; i++) {
          if (await isPortFree(env.port)) return;
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`Port ${env.port} still bound after teardown of ${env.id}`);
      }
    },
  };
}
