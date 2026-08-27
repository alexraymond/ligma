/**
 * booted-ligma.ts — an ephemeral, isolated ligma, booted from its own recipe.
 *
 * The acceptance campaign (build brief §7) runs the panel from the DEV checkout
 * against a BUILT ligma in an ephemeral env. This module is that env:
 *
 *   - a `git worktree` of this repo, cut from a snapshot of the working tree
 *     (so the campaign tests what is on disk now, not what was last committed);
 *   - booted through the repo's own dogfood `.ligma/boot.json` — the same
 *     recipe an adopted product gets, no special-casing for ourselves;
 *   - with a THROWAWAY `LIGMA_DATA_DIR`, so the booted instance's projects,
 *     runs, verdicts, baselines and signing key are entirely its own and the
 *     dev locker cannot be confused with the instance under test;
 *   - with its own daemon on its own port, so the booted instance spawns its
 *     own builders through ITS governor (double-gated, contract §1);
 *   - health-checked on BOTH faces before it is handed back, and torn down
 *     (processes, worktree, data dir) whatever happens.
 *
 * The worktree/install/manifest/teardown machinery is `env/lifecycle.ts` —
 * reused, not re-implemented. What this file adds is the one thing the boot
 * adapter cannot do: a second process (the daemon) that the web face talks to,
 * and an environment those two processes share.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { applyPortStrategy, resolveAppDir } from "../../apps/daemon/src/env/boot-adapter";
import { createEnv, teardownEnv } from "../../apps/daemon/src/env/lifecycle";
import { buildSafeEnv } from "../../apps/daemon/src/engine/security";
import { getFreePort } from "../../apps/daemon/src/env/mission-control-adapter";
import type { EnvManifest, SeedSummary, TargetAdapter } from "../../apps/daemon/src/env/types";
import { REPO_ROOT } from "../../apps/daemon/src/paths";
import { readBoot } from "../../apps/daemon/src/store/ligma-dir";

const execFileAsync = promisify(execFile);

const INSTALL_TIMEOUT_MS = 20 * 60_000;
const BUILD_TIMEOUT_MS = 15 * 60_000;
const SEED_TIMEOUT_MS = 5 * 60_000;
const HEALTH_TIMEOUT_MS = 240_000;
const HEALTH_INTERVAL_MS = 750;

/**
 * The booted web face is a PRODUCTION build, not `next dev`.
 *
 * `next dev` compiles each route the first time it is asked for. Under a panel
 * of personas hitting different routes at once those cold compiles pile up, and
 * the d4 run lost three of five personas to `net::ERR_CONNECTION_REFUSED` with a
 * fourth losing the server mid-session. A build costs ~13s once (measured, cold,
 * on this repo) and then every route is served precompiled. Build brief §7 asks
 * for the panel to run "against a BUILT ligma" — this is that, literally.
 *
 * The build has to happen per-instance rather than once for all of them: the
 * daemon URL is baked into `next.config.ts`'s `/api/*` rewrite at build time,
 * and every booted instance gets its own daemon port.
 */
const BUILD_ARGV = ["pnpm", "exec", "next", "build"];
const START_ARGV = ["pnpm", "exec", "next", "start"];

/**
 * The global rail (`apps/web/src/lib/nav.ts`), which is what every persona
 * navigates by. Health is not "the home page answered" — it is "every door in
 * the rail opens", checked before any persona is let in.
 */
// /deck and /inbox live on as redirect pages into /needs-you (phase 1) — still
// health-checked so a broken redirect page fails the boot, plus the tray itself.
const RAIL_ROUTES = ["/", "/needs-you", "/deck", "/inbox", "/projects", "/library", "/crew", "/settings"];

export interface BootLigmaOptions {
  /**
   * `demo` runs the recipe's seed command against the throwaway data dir (the
   * chains that need a populated Deck); `none` boots an empty instance — no
   * projects at all, which is what a greenfield chain must start from.
   */
  seed: "none" | "demo";
  /**
   * Rehearsal mode. Stubs every model wire the BOOTED instance owns:
   * `LIGMA_DISCOVERY_STUB`, `LIGMA_STUB_STUDIO`, and a fake `claude` binary
   * pinned through the instance's own daemon-config, so its governor and
   * dispatcher run their real code paths and no session is ever spent.
   */
  stub: boolean;
  /** Keep the throwaway data dir after teardown (diagnosing a red link). */
  keepData?: boolean;
  /** Where daemon/web logs are written. Defaults to <dataDir>/logs. */
  logDir?: string;
  /**
   * Raw daemon-config.json overrides, deep-merged (one level, `execution` and
   * `polling`) over whatever `stub` already writes. Additive: omitted ⇒ the
   * config `stub` writes today is unchanged. This is drill mode's hook (see
   * scripts/acceptance/drill.ts) — it pins `execution.claudeBinaryPath` at
   * fake-claude.mjs directly, independent of the `stub` bundle, and can drop
   * `polling.intervalMinutes` to its 1-minute floor so a dispatcher tick
   * doesn't take the 5-minute production default.
   */
  configOverrides?: { execution?: Record<string, unknown>; polling?: Record<string, unknown> };
  /**
   * Extra env vars for both child processes, applied after (so they can
   * override) the `stub` bundle's own. Drill mode's hook for opting into
   * `LIGMA_STUB_STUDIO` (the one model wire no fake CLI binary can stand in
   * for — see `studio/provider.ts`) without also pulling in
   * `LIGMA_DISCOVERY_STUB`, which would skip the discovery spawn entirely
   * instead of exercising it against fake-claude.
   */
  extraEnv?: Record<string, string>;
}

export interface BootedLigma {
  envId: string;
  worktreePath: string;
  /** The throwaway LIGMA_DATA_DIR — the instance's whole store. */
  dataDir: string;
  /** The web face (what personas drive). */
  url: string;
  /** The API face (what interlude monitors poll). */
  daemonUrl: string;
  logDir: string;
  /**
   * Non-null once one of the two child processes has exited unexpectedly, with
   * the label, how it died, and the tail of its log.
   *
   * A persona pointed at a dead port does not fail fast — it retries
   * `ERR_CONNECTION_REFUSED` for its whole turn budget and then reports the
   * silence as a product defect. That is the most expensive possible way to
   * learn the server fell over, and it is what the d3 retry and the d4 run both
   * spent most of their quota on. The campaign checks this between links and
   * before every persona spawn.
   */
  died(): string | null;
  stop(): Promise<void>;
}

/** Where the fake `claude` used in rehearsal lives. */
export const STUB_BIN_DIR = path.join(REPO_ROOT, "scripts", "acceptance", "stub-bin");

/**
 * The stores an empty instance still needs on disk. The daemon's readers throw
 * on a missing file rather than inventing one — correct, and it means a
 * greenfield env has to be given empty ones or every route 500s.
 */
export const EMPTY_STORES: Record<string, unknown> = {
  "tasks.json": { tasks: [] },
  "goals.json": { goals: [] },
  "projects.json": { projects: [] },
  "brain-dump.json": { entries: [] },
  "activity-log.json": { events: [] },
  "inbox.json": { messages: [] },
  "decisions.json": { decisions: [] },
  "agents.json": { agents: [] },
  "skills-library.json": { skills: [] },
};

/**
 * The booted instance's Ed25519 public key, or null if it never signed
 * anything. Evidence imported from that instance is verified against THIS key,
 * so a verdict signed by some other machine cannot be imported as its own.
 */
export function bootedPublicKey(dataDir: string): string | null {
  const file = path.join(dataDir, "harness-signing-key.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as { publicKey?: string };
    return typeof parsed.publicKey === "string" ? parsed.publicKey : null;
  } catch {
    return null;
  }
}

/** The last few lines of a process log — enough to name the cause, not a dump. */
export function tailLog(file: string, lines = 20): string {
  try {
    return readFileSync(file, "utf-8").trimEnd().split("\n").slice(-lines).join("\n") || "(log is empty)";
  } catch {
    return "(log unreadable)";
  }
}

async function waitFor(check: () => Promise<boolean>, deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
  }
  return false;
}

async function urlAnswers(url: string, marker?: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status !== 200) return false;
    if (!marker) return true;
    return (await res.text()).includes(marker);
  } catch {
    return false;
  }
}

/** SIGTERM the process group, then SIGKILL what is left. */
async function killTree(pid: number | null): Promise<void> {
  if (pid === null) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  const graceUntil = Date.now() + 5_000;
  while (Date.now() < graceUntil) {
    try {
      process.kill(-pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/**
 * Boot an isolated ligma and hand back both of its faces.
 *
 * Throws with the log paths attached if either face never comes up — a booted
 * instance that is not provably alive is not an env, and no link may run
 * against one.
 */
export async function bootLigma(opts: BootLigmaOptions): Promise<BootedLigma> {
  const boot = readBoot(REPO_ROOT);
  if (boot.status !== "ready") {
    throw new Error(boot.error ?? `${REPO_ROOT}/.ligma/boot.json is missing — the dogfood recipe is the env`);
  }
  const recipe = boot.boot;
  // An artifact recipe (dev: null) has nothing to serve; ligma's own env is a
  // served app, so that recipe could only mean the dogfood boot.json is wrong.
  if (recipe.dev === null) {
    throw new Error(`${REPO_ROOT}/.ligma/boot.json is an artifact recipe (dev: null) — ligma's own env is a served app`);
  }

  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ligma-campaign-data-"));
  const logDir = opts.logDir ?? path.join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const daemonPort = await getFreePort();
  const daemonUrl = `http://127.0.0.1:${daemonPort}`;

  // Rehearsal pins a fake `claude` through the instance's OWN config, so every
  // spawn still goes through findCliBinary → validateBinary → the governor.
  // Nothing about the spawn path is bypassed; only the model is not real.
  // `configOverrides` (drill mode) is merged on top, one level deep, so a
  // drill can override `claudeBinaryPath` without inheriting `stub`'s other
  // choices, or vice versa.
  const configToWrite: { execution?: Record<string, unknown>; polling?: Record<string, unknown> } = {};
  if (opts.stub || opts.configOverrides?.execution) {
    configToWrite.execution = {
      claudeBinaryPath: path.join(STUB_BIN_DIR, "claude"),
      ...opts.configOverrides?.execution,
    };
  }
  if (opts.configOverrides?.polling) {
    configToWrite.polling = { ...opts.configOverrides.polling };
  }
  if (Object.keys(configToWrite).length > 0) {
    writeFileSync(
      path.join(dataDir, "daemon-config.json"),
      `${JSON.stringify(configToWrite, null, 2)}\n`,
      "utf-8",
    );
  }

  // buildSafeEnv, not process.env: the booted instance inherits everything it
  // needs (including the CLI's own auth) with the same credential vars stripped
  // that every other spawned child has stripped.
  const childEnv: NodeJS.ProcessEnv = {
    ...(buildSafeEnv() as NodeJS.ProcessEnv),
    LIGMA_DATA_DIR: dataDir,
    // Product repos the booted instance provisions are campaign artifacts —
    // they live (and die) with the instance's data dir, never in the real
    // ~/ligma-products.
    LIGMA_PRODUCTS_DIR: path.join(dataDir, "products"),
    LIGMA_DAEMON_PORT: String(daemonPort),
    NEXT_PUBLIC_LIGMA_DAEMON_URL: daemonUrl,
    ...(opts.stub ? { LIGMA_DISCOVERY_STUB: "1", LIGMA_STUB_STUDIO: "1" } : {}),
    ...opts.extraEnv,
  };

  let daemonPid: number | null = null;
  let webPid: number | null = null;
  // Set by teardown, so a killed child is not reported as a death.
  let stopping = false;
  let death: { label: string; how: string } | null = null;

  const spawnLogged = (
    label: string,
    argv: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): ChildProcess => {
    const log = openSync(path.join(logDir, `${label}.log`), "a");
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      cwd,
      detached: true, // own process group — teardown kills the whole tree
      stdio: ["ignore", log, log] as const,
      env,
      shell: false,
    });
    // Before unref: the handle still reports the child's exit, it just stops
    // holding the event loop open. First death wins — the second is a
    // consequence of the first (the web face without its daemon, and so on).
    child.on("exit", (code, signal) => {
      if (stopping || death) return;
      death = { label, how: signal ? `signal ${signal}` : `exit code ${code}` };
    });
    child.unref();
    if (child.pid === undefined) throw new Error(`Failed to spawn ${label}: ${argv.join(" ")}`);
    return child;
  };

  const appDirOf = (env: EnvManifest): string => resolveAppDir(env.worktreePath, recipe.appDir);

  const adapter: TargetAdapter = {
    kind: "web",

    async install(env) {
      const run = async (argv: string[], timeout: number): Promise<void> => {
        const [cmd, ...args] = argv;
        await execFileAsync(cmd, args, {
          cwd: appDirOf(env),
          env: childEnv,
          maxBuffer: 64 * 1024 * 1024,
          timeout,
        });
      };
      if (recipe.install) await run(recipe.install, INSTALL_TIMEOUT_MS);
      // childEnv carries NEXT_PUBLIC_LIGMA_DAEMON_URL, so this instance's daemon
      // port lands in the built rewrite — see BUILD_ARGV.
      await run(BUILD_ARGV, BUILD_TIMEOUT_MS);
    },

    async seed(env): Promise<SeedSummary> {
      // An empty instance is a deliberate starting state, not a missing step:
      // D1 and D2 are greenfield, and a seeded project would be a lie about
      // where the user started. It still needs its stores to EXIST — the
      // daemon's readers throw on a missing file, and "no tasks" is a fact the
      // store has to be able to state.
      if (opts.seed === "none" || !recipe.seed) {
        for (const [file, empty] of Object.entries(EMPTY_STORES)) {
          writeFileSync(path.join(dataDir, file), `${JSON.stringify(empty, null, 2)}\n`, "utf-8");
        }
        return { seed: 0, counts: { "empty stores": Object.keys(EMPTY_STORES).length } };
      }
      const [cmd, ...args] = recipe.seed;
      await execFileAsync(cmd, args, {
        cwd: appDirOf(env),
        env: childEnv,
        maxBuffer: 64 * 1024 * 1024,
        timeout: SEED_TIMEOUT_MS,
      });
      return { seed: 0, counts: { [recipe.seed.join(" ")]: 1 } };
    },

    async boot(env) {
      if (env.port === null) throw new Error("boot() requires a port");

      // The daemon first: it owns the stores, the governor and the dispatcher,
      // and the web face is only a view of it.
      const daemon = spawnLogged(
        "daemon",
        ["pnpm", "exec", "tsx", "src/engine/index.ts", "start"],
        path.join(env.worktreePath, "apps", "daemon"),
        childEnv,
      );
      daemonPid = daemon.pid ?? null;

      // The recipe's port strategy, applied to `next start` — same flag, same
      // env, a served build instead of a compiler.
      const { argv, env: portEnv } = applyPortStrategy({ ...recipe, dev: START_ARGV }, env.port);
      const web = spawnLogged("web", argv, appDirOf(env), { ...portEnv, ...childEnv });
      webPid = web.pid ?? null;

      return { pid: web.pid!, url: `http://localhost:${env.port}` };
    },

    async health(env) {
      if (env.url === null) return false;
      const daemonUp = await waitFor(() => urlAnswers(`${daemonUrl}/api/daemon`), HEALTH_TIMEOUT_MS);
      if (!daemonUp) return false;
      const target = new URL(recipe.healthPath, env.url).toString();
      if (!(await waitFor(() => urlAnswers(target, recipe.healthMarker), HEALTH_TIMEOUT_MS))) return false;
      // Every rail route, once the server is up. Sequential and un-retried: a
      // built server that needs a second attempt on /library is not healthy,
      // and finding that out here is the whole point.
      for (const route of RAIL_ROUTES) {
        const url = new URL(route, env.url).toString();
        if (!(await urlAnswers(url, recipe.healthMarker))) {
          console.error(`[booted-ligma] rail route ${route} did not answer 200 with "${recipe.healthMarker}"`);
          return false;
        }
      }
      return true;
    },

    async teardown() {
      stopping = true;
      await killTree(webPid);
      await killTree(daemonPid);
    },
  };

  let env: EnvManifest;
  try {
    env = await createEnv({ repoPath: REPO_ROOT, bootRecipe: recipe, adapter, boot: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`booted ligma never came up: ${message} (logs: ${logDir})`);
  }

  return {
    envId: env.id,
    worktreePath: env.worktreePath,
    dataDir,
    url: env.url!,
    daemonUrl,
    logDir,
    died() {
      if (death === null) return null;
      const { label, how } = death;
      const file = path.join(logDir, `${label}.log`);
      return `the booted instance's ${label} process died (${how}). Last lines of ${file}:\n${tailLog(file)}`;
    },
    async stop() {
      try {
        await teardownEnv(env.id, adapter, REPO_ROOT);
      } finally {
        if (!opts.keepData) rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
// `tsx scripts/acceptance/booted-ligma.ts [--demo] [--stub]` boots one and holds
// it until Ctrl-C — how you look at a campaign env by hand.

if (require.main === module) {
  const argv = process.argv.slice(2);
  bootLigma({ seed: argv.includes("--demo") ? "demo" : "none", stub: argv.includes("--stub"), keepData: true })
    .then((instance) => {
      console.log(`[booted-ligma] web    ${instance.url}`);
      console.log(`[booted-ligma] daemon ${instance.daemonUrl}`);
      console.log(`[booted-ligma] data   ${instance.dataDir}`);
      console.log(`[booted-ligma] logs   ${instance.logDir}`);
      console.log("[booted-ligma] Ctrl-C to tear down.");
      // Nothing else holds this process open, and exiting here would orphan the
      // two detached children it is responsible for.
      process.stdin.resume();
      const stop = (): void => void instance.stop().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exit(1);
    });
}
