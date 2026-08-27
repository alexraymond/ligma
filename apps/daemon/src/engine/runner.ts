import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { denyRulesForRole, loadConfig } from './config';
import { logger } from './logger';
import { buildSafeEnv, scrubCredentials, validateBinary } from './security';
import type { SpawnOptions, SpawnResult } from './types';

// tree-kill for killing process trees on Windows
import treeKill from 'tree-kill';

import { WORKSPACE_ROOT } from '../paths';
const MAX_STDOUT_SIZE = 10_000_000; // 10MB max captured output
/** How long a timed-out child gets to honour SIGTERM before SIGKILL (E14). */
const SIGKILL_GRACE_MS = 10_000;

// ─── CLI Binary Detection ────────────────────────────────────────────────────

/**
 * Resolved CLI binary info.
 * On Windows, npm global installs create .cmd shim files that can't be
 * spawned directly with shell: false. Instead we resolve the underlying
 * JS entry point and spawn it via node.exe.
 */
interface ResolvedBinary {
  /** The binary to spawn (claude/codex, .exe, or node.exe for .cmd shims) */
  bin: string;
  /** Extra args to prepend (the JS entry point path when using node.exe) */
  prefixArgs: string[];
  /** Original path for logging */
  originalPath: string;
}

type Backend = 'claude' | 'codex' | 'gemini';

const BACKEND_LABEL: Record<Backend, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

// Cache resolved binaries per backend to avoid repeated lookups.
const cachedBinaries: Partial<Record<Backend, ResolvedBinary>> = {};

/**
 * Resolve the JS entry point from an npm .cmd shim file.
 * npm .cmd files contain: "%_prog%" "%dp0%\node_modules\...\cli.js" %*
 * We extract the relative path and resolve it.
 */
function resolveJsFromCmd(cmdPath: string): string | null {
  try {
    const content = readFileSync(cmdPath, 'utf-8');
    // Match the pattern: "%dp0%\node_modules\...\cli.js" or similar
    const match = content.match(/%dp0%\\([^"]+\.js)/i) || content.match(/%dp0%\\([^\s"]+\.js)/i);
    if (match) {
      const dir = path.dirname(cmdPath);
      const jsPath = path.join(dir, match[1]);
      if (existsSync(jsPath)) {
        return jsPath;
      }
    }
  } catch {
    /* couldn't read .cmd file */
  }

  // Fallback: check standard npm global structure for known CLIs
  const dir = path.dirname(cmdPath);
  const standardCandidates = [
    path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    path.join(dir, 'node_modules', '@openai', 'codex', 'dist', 'cli.js'),
  ];
  for (const candidate of standardCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Forget every resolved binary, so the next lookup re-reads config and PATH.
 *
 * Changing `claudeBinaryPath` in Settings took effect only on a full daemon
 * restart: the rescan route cleared the PROBE cache and this one was cleared
 * only by an ENOENT at spawn time, so Settings said saved, rescan said
 * available, and every spawn still used the old binary (P10). Called by the
 * config hot-reload when a `*BinaryPath` field moves, and by the rescan route.
 */
export function clearBinaryCache(): void {
  for (const backend of Object.keys(cachedBinaries) as Backend[]) {
    delete cachedBinaries[backend];
  }
}

function missingBinaryFallback(backend: Backend): ResolvedBinary {
  // Return the backend name and let spawn fail with a descriptive error.
  const configPathField =
    backend === 'claude'
      ? 'claudeBinaryPath'
      : backend === 'codex'
        ? 'codexBinaryPath'
        : 'geminiBinaryPath';
  logger.warn(
    'runner',
    `Could not auto-detect ${backend} binary. Set '${configPathField}' in daemon-config.json or install ${BACKEND_LABEL[backend]} globally.`,
  );
  return { bin: backend, prefixArgs: [], originalPath: backend };
}

/** One detection attempt, no waiting. Used by the probe, which is re-runnable. */
function findCliBinary(backend: Backend): ResolvedBinary {
  return cachedBinaries[backend] ?? detectCliBinary(backend) ?? missingBinaryFallback(backend);
}

/**
 * Detection for the spawn path, which can afford to wait — and must not block
 * while it does.
 *
 * A CLI that self-updates swaps its own binary; a spawn that lands inside that
 * window sees ENOENT on a machine where the binary genuinely exists (live d2
 * attempt-5: the judge — first spawn in its process — hit the swap and a
 * 28-minute run's evidence was discarded). Detection gets three tries. The wait
 * between them used to be `Atomics.wait`, which froze the whole daemon for up to
 * 4s (E24); awaiting a timer costs the same wall clock and blocks nothing.
 */
async function findCliBinaryAsync(backend: Backend): Promise<ResolvedBinary> {
  const cached = cachedBinaries[backend];
  if (cached) return cached;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const found = detectCliBinary(backend);
    if (found) return found;
    if (attempt === 3) break;
    logger.warn(
      'runner',
      `${backend} binary not found (attempt ${attempt}/3) — retrying in 2s in case a self-update is swapping it`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  }

  return missingBinaryFallback(backend);
}

function detectCliBinary(backend: Backend): ResolvedBinary | null {
  const binaryName = backend;
  const configuredPath =
    backend === 'claude'
      ? loadConfig().execution.claudeBinaryPath
      : backend === 'codex'
        ? loadConfig().execution.codexBinaryPath
        : loadConfig().execution.geminiBinaryPath;

  // 1. Check config override
  try {
    if (configuredPath) {
      logger.info('runner', `Using configured ${binaryName} path: ${configuredPath}`);
      const resolved = {
        bin: configuredPath,
        prefixArgs: [],
        originalPath: configuredPath,
      };
      cachedBinaries[backend] = resolved;
      return resolved;
    }
  } catch {
    /* config load failed, continue with auto-detect */
  }

  // 2. Check common install locations (Windows + Unix)
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? '';
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const userProfile = process.env.USERPROFILE ?? '';

    candidates.push(
      // npm global
      path.join(appData, 'npm', `${binaryName}.cmd`),
      path.join(appData, 'npm', binaryName),
      // pnpm global
      path.join(localAppData, 'pnpm', `${binaryName}.cmd`),
      path.join(localAppData, 'pnpm', binaryName),
      // User .local/bin (common on WSL-adjacent setups)
      path.join(userProfile, '.local', 'bin', binaryName),
      path.join(userProfile, '.local', 'bin', `${binaryName}.exe`),
    );
  } else {
    const home = process.env.HOME ?? '';
    candidates.push(
      path.join(home, '.local', 'bin', binaryName),
      path.join(home, '.npm-global', 'bin', binaryName),
      `/opt/homebrew/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/usr/bin/${binaryName}`,
    );
    if (backend === 'codex') {
      candidates.push('/Applications/Codex.app/Contents/Resources/codex');
    }
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      logger.info('runner', `Found ${binaryName} at: ${candidate}`);

      // On Windows, .cmd shims can't be spawned directly — resolve the JS entry point
      if (candidate.endsWith('.cmd')) {
        const jsEntry = resolveJsFromCmd(candidate);
        if (jsEntry) {
          logger.info('runner', `Resolved .cmd shim → ${jsEntry} (via node.exe)`);
          const resolved = {
            bin: process.execPath, // node.exe
            prefixArgs: [jsEntry],
            originalPath: candidate,
          };
          cachedBinaries[backend] = resolved;
          return resolved;
        }
      }

      const resolved = { bin: candidate, prefixArgs: [], originalPath: candidate };
      cachedBinaries[backend] = resolved;
      return resolved;
    }
  }

  // 3. Try which/where via execSync (catches PATH entries we missed)
  try {
    const cmd = process.platform === 'win32' ? `where ${binaryName}` : `which ${binaryName}`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0].trim();
    if (result) {
      logger.info('runner', `Found ${binaryName} via PATH: ${result}`);

      if (result.endsWith('.cmd')) {
        const jsEntry = resolveJsFromCmd(result);
        if (jsEntry) {
          logger.info('runner', `Resolved .cmd shim → ${jsEntry} (via node.exe)`);
          const resolved = {
            bin: process.execPath,
            prefixArgs: [jsEntry],
            originalPath: result,
          };
          cachedBinaries[backend] = resolved;
          return resolved;
        }
      }

      const resolved = { bin: result, prefixArgs: [], originalPath: result };
      cachedBinaries[backend] = resolved;
      return resolved;
    }
  } catch {
    /* not found in PATH */
  }

  // 4. Not found this attempt — the caller decides whether to retry.
  return null;
}

// ─── Argv construction ───────────────────────────────────────────────────────

/** Tools that can change a file. */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Tools that can run a command (and therefore write by other means). */
const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell']);

/** "Bash(git *)" → "Bash". Permission specifiers don't matter for the mapping. */
function baseTool(spec: string): string {
  const paren = spec.indexOf('(');
  return (paren === -1 ? spec : spec.slice(0, paren)).trim();
}

/** Just enough of a spawn to decide whether a backend can honour it. */
export interface RestrictionRequest {
  allowedTools?: string[];
  skipPermissions?: boolean;
  model?: string | null;
}

/**
 * How this backend will express the request, or why it cannot.
 *
 * ONE decision function, consulted by both `buildArgs` (which throws on
 * `reject`) and `canBackendHonorRestrictions` (which reports it). They cannot
 * drift, which matters: the predicate is what lets the fallback chain skip a
 * backend, so a predicate that disagreed with the argv builder would either skip
 * a usable backend or hand one an unenforceable restriction.
 */
type BackendMode = 'claude' | 'read-only' | 'workspace-write' | 'plan' | 'yolo';

function decideBackend(
  backend: Backend,
  opts: RestrictionRequest,
): { mode: BackendMode; reject: string | null } {
  const ok = (mode: BackendMode) => ({ mode, reject: null });
  const no = (reject: string) => ({ mode: 'claude' as BackendMode, reject });

  if (backend === 'claude') return ok('claude');

  if (opts.model) {
    // The pinned model is a claude alias ("opus"). Honouring it elsewhere is
    // impossible, and signing a verdict that claims it would be a lie (I11).
    return no(`the caller pinned model "${opts.model}", which only the claude CLI can honour`);
  }

  const tools = (opts.allowedTools ?? []).map(baseTool);
  const writes = tools.some((t) => WRITE_TOOLS.has(t));
  const shell = tools.some((t) => SHELL_TOOLS.has(t));

  if (backend === 'codex') {
    if (opts.skipPermissions) return ok('workspace-write');
    // Read-only is stricter than the requested set (it blocks writes via the
    // shell too), so it can never over-grant.
    if (!writes) return ok('read-only');
    // Writes + shell inside the workspace is the same grant claude gets.
    if (shell) return ok('workspace-write');
    return no('codex has no sandbox that allows file writes while denying command execution');
  }

  if (opts.skipPermissions) return ok('yolo');
  // "plan" is the gemini CLI's own read-only mode — the only restriction it has.
  if (!writes && !shell) return ok('plan');
  return no(
    'the gemini CLI has only yolo (approve everything) and plan (read-only); it cannot express a partial grant',
  );
}

/**
 * True when this backend can run this spawn with the restriction intact.
 *
 * False exactly where `buildArgs` would throw, so a fallback chain can SKIP an
 * unsupported backend (with a logged reason) instead of dying on it: a Claude
 * rate limit should rotate work to another CLI, not stop it. A direct spawn on
 * an unsupported backend still throws — never silently unrestricted.
 */
export function canBackendHonorRestrictions(backend: Backend, opts: RestrictionRequest): boolean {
  return decideBackend(backend, opts).reject === null;
}

/**
 * The order backends are tried in, and the order the sticky rotation walks.
 * Claude first because it is the primary; the other two are the escape hatch.
 */
export const BACKEND_ROTATION: ReadonlyArray<Backend> = ['claude', 'gemini', 'codex'];

/**
 * The backends one task may be attempted on, in order — the ONE builder for both
 * dispatch paths (E11).
 *
 * There were two, and they disagreed: the daemon's ignored
 * `claudeAutoFailoverBackend` entirely and always rotated, `run-task.ts` honoured
 * the preference but still pushed codex even with
 * `claudeAutoFailoverEnabled: false`. So a user who turned failover OFF to stop
 * spending their other subscriptions still got codex and gemini spawns, and
 * which ones depended on who dispatched the task.
 *
 * Failover off means off: one backend, no rotation. Failover on: the configured
 * preference first, then the rest in rotation order, each appearing once.
 */
export function buildBackendChain(
  initial: Backend,
  failover: { enabled: boolean; preferred: 'codex' | 'gemini' | null },
): Backend[] {
  if (!failover.enabled) return [initial];

  const chain: Backend[] = [initial];
  const push = (b: Backend): void => {
    if (!chain.includes(b)) chain.push(b);
  };
  if (failover.preferred) push(failover.preferred);
  for (const b of BACKEND_ROTATION) push(b);
  return chain;
}

/**
 * Gate a configured model (personaModel/workerModel) to the backend that can
 * actually honour it. `decideBackend` fails closed on ANY non-claude backend
 * asked to pin a model — codex/gemini have no equivalent to `--model opus`. A
 * caller that spawns across a fallback chain (dispatcher.ts, run-task.ts) and
 * forgets this gate turns a graceful codex/gemini failover into an uncaught throw.
 */
export function modelForBackend(
  backend: Backend | undefined,
  model: string | null,
): string | null | undefined {
  return (backend ?? 'claude') === 'claude' ? model : undefined;
}

/**
 * A backend that cannot express the restriction must not spawn at all (D8).
 * Silently dropping it is how a judge ends up able to rewrite the evidence it
 * is grading — which voids every verdict it signs.
 */
function failClosed(backend: Backend, opts: SpawnOptions, why: string): never {
  const asked = opts.allowedTools?.join(', ') || '(permission-gated default set)';
  throw new Error(
    `Refusing to spawn ${BACKEND_LABEL[backend]} for a restricted session: ${why}. Requested tools: ${asked}. Route this role to claude (execution.governor.roleRouting), or set execution.skipPermissions if an unrestricted session is genuinely intended.`,
  );
}

/**
 * Deny rules only exist on the claude CLI. Elsewhere they are a leak we name out
 * loud rather than an enforcement we pretend to have (D7).
 */
function warnUnexpressibleDeny(backend: Backend, deny: string[]): void {
  if (deny.length === 0) return;
  logger.security(
    'runner',
    `${BACKEND_LABEL[backend]} cannot express file deny rules — ${deny.length} rule(s) NOT enforced for this spawn ` +
      `(residual: the compiled contract and task store stay readable). Rules: ${deny.join(' ')}`,
  );
}

export function buildArgs(opts: SpawnOptions, backend: Backend): string[] {
  const deny = opts.disallowedTools ?? denyRulesForRole(opts.role);
  const { mode, reject } = decideBackend(backend, opts);
  if (reject) failClosed(backend, opts, reject);

  if (backend === 'codex') {
    warnUnexpressibleDeny(backend, deny);
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', mode];

    if (opts.skipPermissions) {
      args.push('-c', 'approval_policy="never"');
      logger.security('runner', 'Spawning codex unrestricted (workspace-write, approvals off)');
    } else {
      logger.info('runner', `codex sandbox: ${mode} (restricted, no approval bypass)`);
    }

    if (opts.codexModel) args.push('-m', opts.codexModel);
    args.push('-C', opts.cwd || WORKSPACE_ROOT, opts.prompt);
    return args;
  }

  if (backend === 'gemini') {
    warnUnexpressibleDeny(backend, deny);
    const args = ['-p', opts.prompt, '--output-format', 'json', '--approval-mode', mode];

    if (mode === 'yolo')
      logger.security('runner', 'Spawning gemini unrestricted (--approval-mode yolo)');
    else logger.info('runner', `gemini approval mode: ${mode} (read-only)`);

    if (opts.geminiModel) args.push('-m', opts.geminiModel);
    return args;
  }

  const args: string[] = [
    '-p',
    opts.prompt,
    '--output-format',
    'json',
    '--max-turns',
    String(opts.maxTurns),
  ];
  // claude-only: the harness pins the judge to a different model than the builder.
  if (opts.model) {
    args.push('--model', opts.model);
  }
  if (opts.skipPermissions) {
    args.push('--dangerously-skip-permissions');
    logger.security('runner', 'Spawning with --dangerously-skip-permissions');
  } else if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowedTools', ...opts.allowedTools);
    logger.info('runner', `Allowed tools: ${opts.allowedTools.join(', ')}`);
  }
  if (deny.length > 0) {
    args.push('--disallowedTools', ...deny);
    logger.info('runner', `Denied: ${deny.join(' ')}`);
    if (opts.skipPermissions) {
      // Bypass mode skips permission checks, deny rules included. Say so rather
      // than let the flag imply an enforcement that is not there.
      logger.security('runner', 'Deny rules are NOT enforced under --dangerously-skip-permissions');
    }
  }
  return args;
}

function missingBinaryMessage(backend: Backend): string {
  if (backend === 'codex') {
    return 'Codex CLI binary not found. Install Codex CLI or set "codexBinaryPath" in daemon-config.json.';
  }
  if (backend === 'gemini') {
    return 'Gemini CLI binary not found. Install Gemini CLI or set "geminiBinaryPath" in daemon-config.json.';
  }
  return 'Claude binary not found. Install Claude Code (npm i -g @anthropic-ai/claude-code) or set "claudeBinaryPath" in daemon-config.json.';
}

export interface BackendProbeResult {
  backend: Backend;
  available: boolean;
  path: string;
  message?: string;
}

// ─── Envelope usage ──────────────────────────────────────────────────────────

/** Tokens a backend reported, or nulls. Never inferred from text length. */
export interface EnvelopeUsage {
  tokensIn: number | null;
  tokensOut: number | null;
}

const NO_USAGE: EnvelopeUsage = { tokensIn: null, tokensOut: null };

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Every JSON value in `stdout`, whether it is one object, an array, or JSONL. */
function jsonValues(stdout: string): unknown[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Not one JSON value — JSONL, one event per line.
  }
  const out: unknown[] = [];
  for (const line of trimmed.split('\n')) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // Not every line is JSON; skip it.
    }
  }
  return out;
}

/**
 * Token usage out of a backend's own reply envelope. Verified against the
 * installed CLIs rather than assumed — each shape below is one a real binary
 * emits, and anything else yields nulls:
 *
 *   claude 2.1.x  `-p --output-format json` → the `type:"result"` object carries
 *                 `usage: {input_tokens, output_tokens, cache_creation_input_tokens,
 *                 cache_read_input_tokens}` alongside `total_cost_usd`/`duration_ms`.
 *                 Input counts the cache fields too: they are tokens that were
 *                 read, and dropping them under-reports a cached run badly.
 *   codex         `exec --json` → a `token_count` event whose
 *                 `info.total_token_usage` is `{input_tokens, cached_input_tokens,
 *                 output_tokens, reasoning_output_tokens, total_tokens}`. Cumulative,
 *                 so the LAST one is the session total. `input_tokens` already
 *                 includes the cached ones here (total_tokens = in + out).
 *   gemini 0.30   `--output-format json` → `{session_id, response, stats}`, stats being
 *                 uiTelemetry metrics: `stats.models[<model>].tokens.{prompt,candidates}`.
 *                 Summed across models, because a run may switch model mid-flight.
 *
 * A backend that reported nothing gets nulls, and the ledger records the gap
 * honestly. Exported for the test that pins each shape.
 */
export function parseEnvelopeUsage(backend: Backend, stdout: string): EnvelopeUsage {
  const values = jsonValues(stdout);
  if (values.length === 0) return NO_USAGE;

  if (backend === 'claude') {
    for (let i = values.length - 1; i >= 0; i--) {
      const event = values[i] as { type?: string; usage?: Record<string, unknown> };
      if (event?.type !== 'result' || !event.usage) continue;
      const u = event.usage;
      const input = num(u.input_tokens);
      const output = num(u.output_tokens);
      if (input === null && output === null) continue;
      const cached =
        (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
      return { tokensIn: input === null ? null : input + cached, tokensOut: output };
    }
    return NO_USAGE;
  }

  if (backend === 'codex') {
    // The event is nested under `msg` in `exec --json` and sits at the top level
    // in a rollout record; look for the payload rather than the wrapper, so a
    // CLI that moves it again still reports.
    for (let i = values.length - 1; i >= 0; i--) {
      const record = values[i] as Record<string, unknown>;
      if (!record || typeof record !== 'object') continue;
      for (const candidate of [record, record.msg, record.payload]) {
        const info = (candidate as { info?: { total_token_usage?: Record<string, unknown> } })
          ?.info;
        const total = info?.total_token_usage;
        if (!total) continue;
        const input = num(total.input_tokens);
        const output = num(total.output_tokens);
        if (input === null && output === null) continue;
        return { tokensIn: input, tokensOut: output };
      }
    }
    return NO_USAGE;
  }

  // gemini: one object, stats keyed by model.
  const stats = (values[values.length - 1] as { stats?: { models?: Record<string, unknown> } })
    ?.stats;
  const models = stats?.models;
  if (!models || typeof models !== 'object') return NO_USAGE;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  for (const entry of Object.values(models)) {
    const tokens = (entry as { tokens?: Record<string, unknown> })?.tokens;
    if (!tokens) continue;
    const prompt = num(tokens.prompt);
    const candidates = num(tokens.candidates);
    if (prompt !== null) tokensIn = (tokensIn ?? 0) + prompt;
    if (candidates !== null) tokensOut = (tokensOut ?? 0) + candidates;
  }
  return { tokensIn, tokensOut };
}

// ─── Agent Runner ────────────────────────────────────────────────────────────

export class AgentRunner {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? WORKSPACE_ROOT;
  }

  /** Probe backend binary availability without spawning a task run. */
  static probeBackend(backend: 'claude' | 'codex' | 'gemini'): BackendProbeResult {
    const resolved = findCliBinary(backend);

    if (!validateBinary(resolved.originalPath)) {
      return {
        backend,
        available: false,
        path: resolved.originalPath,
        message: `Security: binary "${resolved.originalPath}" is not in the allowed list`,
      };
    }

    // If auto-detection failed, findCliBinary returns the backend name.
    if (resolved.originalPath === backend) {
      return {
        backend,
        available: false,
        path: resolved.originalPath,
        message: missingBinaryMessage(backend),
      };
    }

    return {
      backend,
      available: true,
      path: resolved.originalPath,
    };
  }

  /** Spawn a CLI agent session and wait for exit or timeout. */
  async spawnAgent(opts: SpawnOptions): Promise<SpawnResult & { pid: number }> {
    const backend: Backend = opts.backend ?? 'claude';
    const resolved = await findCliBinaryAsync(backend);

    if (!validateBinary(resolved.originalPath)) {
      throw new Error(`Security: binary "${resolved.originalPath}" is not in the allowed list`);
    }

    // Build args array (NOT string interpolation — prevents shell injection)
    // prefixArgs contains the JS entry point when spawning via node.exe
    const args: string[] = [...resolved.prefixArgs, ...buildArgs(opts, backend)];

    const safeEnv = buildSafeEnv({ agentTeams: opts.agentTeams, role: opts.role });

    logger.info('runner', `Backend: ${backend}`);
    logger.debug('runner', `Spawning: ${resolved.bin} ${args.slice(0, 8).join(' ')} ...`);
    logger.debug('runner', `CWD: ${opts.cwd || this.cwd}`);

    // Wall clock, not the envelope's own `duration_ms`: it is the only figure
    // every backend has, and it is what the quota window actually spends.
    const startedAt = Date.now();

    return new Promise<SpawnResult & { pid: number }>((resolve) => {
      const child: ChildProcess = spawn(resolved.bin, args, {
        cwd: opts.cwd || this.cwd,
        env: safeEnv as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'] as const,
        windowsHide: true,
      });

      const pid = child.pid ?? 0;
      if (pid > 0 && opts.onSpawnPid) {
        try {
          opts.onSpawnPid(pid);
        } catch (err) {
          logger.warn(
            'runner',
            `onSpawnPid callback failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      // Capture stdout with size limit
      child.stdout?.on('data', (chunk: Buffer) => {
        const decoded = chunk.toString();
        if (stdout.length < MAX_STDOUT_SIZE) {
          stdout += decoded;
        }
        if (opts.onStdoutChunk) {
          try {
            opts.onStdoutChunk(decoded);
          } catch {
            /* ignore callback errors */
          }
        }
      });

      // Capture stderr with size limit
      child.stderr?.on('data', (chunk: Buffer) => {
        const decoded = chunk.toString();
        if (stderr.length < MAX_STDOUT_SIZE) {
          stderr += decoded;
        }
        if (opts.onStderrChunk) {
          try {
            opts.onStderrChunk(decoded);
          } catch {
            /* ignore callback errors */
          }
        }
      });

      // Timeout enforcement
      const timeoutMs = opts.timeoutMinutes * 60 * 1000;
      /** SIGTERM is a request. This is what makes it an order (E14). */
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        logger.warn(
          'runner',
          `Process ${pid} timed out after ${opts.timeoutMinutes} minutes — killing`,
        );

        // Kill the entire process tree (important on Windows)
        treeKill(pid, 'SIGTERM', (err?: Error) => {
          if (err) {
            logger.error('runner', `Failed to kill process tree ${pid}: ${err.message}`);
            try {
              child.kill('SIGKILL');
            } catch {
              /* best effort */
            }
          }
        });

        // A CLI that ignores SIGTERM held its concurrency slot forever: the
        // promise never resolved, so the session never ended and the governor
        // never got the slot back. Escalate once, then let `close` settle it.
        killTimer = setTimeout(() => {
          if (settled) return;
          logger.error(
            'runner',
            `Process ${pid} ignored SIGTERM after ${SIGKILL_GRACE_MS / 1000}s — SIGKILL`,
          );
          treeKill(pid, 'SIGKILL', () => {
            /* nothing left to try */
          });
        }, SIGKILL_GRACE_MS);
      }, timeoutMs);

      const clearTimers = (): void => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
      };

      // Process exit
      child.on('close', (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimers();

        // Diagnostic logging on failure — helps debug silent exit code 1 issues
        if (exitCode !== null && exitCode !== 0 && !timedOut) {
          if (stderr.trim()) {
            logger.error(
              'runner',
              `Process ${pid} stderr: ${scrubCredentials(stderr.slice(0, 500))}`,
            );
          }
          if (stdout.trim()) {
            logger.error(
              'runner',
              `Process ${pid} stdout (first 500 chars): ${scrubCredentials(stdout.slice(0, 500))}`,
            );
          }
          if (!stderr.trim() && !stdout.trim()) {
            logger.warn(
              'runner',
              `Process ${pid} exited with code ${exitCode} but produced no output`,
            );
          }
        }

        resolve({
          pid,
          exitCode,
          stdout: scrubCredentials(stdout),
          stderr: scrubCredentials(stderr),
          timedOut,
          durationMs: Date.now() - startedAt,
          // Parsed from the RAW stdout: scrubbing rewrites credential-shaped
          // substrings, and a redaction landing inside the envelope would make
          // the numbers unparseable for reasons that have nothing to do with them.
          ...parseEnvelopeUsage(backend, stdout),
        });
      });

      // Spawn error (binary not found, etc.)
      child.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimers();

        const binPath = resolved.originalPath;
        if (err.message.includes('ENOENT')) {
          logger.error('runner', `${BACKEND_LABEL[backend]} binary not found (${binPath})`);
          // Clear cached path so next attempt retries detection
          delete cachedBinaries[backend];
        } else {
          logger.error('runner', `Spawn error: ${err.message}`);
        }
        resolve({
          pid,
          exitCode: 1,
          stdout: '',
          stderr: err.message.includes('ENOENT')
            ? missingBinaryMessage(backend)
            : scrubCredentials(err.message),
          timedOut: false,
          durationMs: Date.now() - startedAt,
          // Nothing ran, so there is nothing to report — not zero tokens.
          ...NO_USAGE,
        });
      });
    });
  }

  /**
   * Kill a running agent session by PID.
   */
  killSession(pid: number): Promise<void> {
    return new Promise((resolve) => {
      treeKill(pid, 'SIGTERM', (err?: Error) => {
        if (err) {
          logger.error('runner', `Failed to kill session ${pid}: ${err.message}`);
        } else {
          logger.info('runner', `Killed session ${pid}`);
        }
        resolve();
      });
    });
  }
}
