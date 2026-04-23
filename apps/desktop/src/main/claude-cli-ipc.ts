/**
 * Claude Max subscription provider (via local Claude Code CLI).
 *
 * Unlike Codex OAuth, we don't run the login flow here — the user logs in
 * once via `claude /login` in their terminal, and the Claude Agent SDK
 * picks up the credentials from the OS keychain. This IPC surface is
 * purely: probe the CLI, write the provider entry, activate it.
 */

import { spawn } from 'node:child_process';
import {
  CLAUDE_CLI_PROVIDER_ID,
  CodesignError,
  type Config,
  ERROR_CODES,
  type ProviderEntry,
  hydrateConfig,
} from '@open-codesign/shared';
import { writeConfig } from './config';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import { getCachedConfig, setCachedConfig } from './onboarding-ipc';

const logger = getLogger('claude-cli-ipc');

export interface ClaudeCliStatus {
  /** `claude --version` succeeded. */
  installed: boolean;
  /** Version string reported by the CLI, when available. */
  version: string | null;
  /** Provider entry already exists in config. */
  configured: boolean;
  /** Provider entry is the currently-active one. */
  active: boolean;
  /** Hint surfaced to the user when something is off. */
  message: string | null;
}

const CLAUDE_CLI_PROVIDER: ProviderEntry = {
  id: CLAUDE_CLI_PROVIDER_ID,
  name: 'Claude Max Subscription',
  builtin: false,
  wire: 'claude-cli',
  // Placeholder base URL — the claude-cli wire bypasses HTTP entirely (the
  // Agent SDK manages its own transport), but ProviderEntrySchema requires
  // a URL-shaped field. Using a loopback sentinel makes mis-routings
  // obvious in logs if anything ever reaches this value.
  baseUrl: 'http://127.0.0.1/claude-cli',
  defaultModel: 'claude-opus-4-7',
  modelsHint: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  requiresApiKey: false,
  // No reasoning default — the SDK picks thinking levels per model.
};

function resolveClaudeBinary(): Promise<{ installed: boolean; version: string | null }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', () => resolve({ installed: false, version: null }));
    child.on('close', (code) => {
      if (code !== 0) {
        logger.info('claude.version.nonzero_exit', { code, stderr: stderr.slice(0, 200) });
        resolve({ installed: false, version: null });
        return;
      }
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      resolve({ installed: true, version: match ? (match[1] ?? null) : null });
    });
  });
}

async function runStatus(): Promise<ClaudeCliStatus> {
  const { installed, version } = await resolveClaudeBinary();
  const cfg = getCachedConfig();
  const entry = cfg?.providers[CLAUDE_CLI_PROVIDER_ID];
  const configured = entry !== undefined;
  const active = configured && cfg?.activeProvider === CLAUDE_CLI_PROVIDER_ID;
  let message: string | null = null;
  if (!installed) {
    message =
      'Claude Code CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code`, then run `claude` once to sign in.';
  }
  return { installed, version, configured, active, message };
}

async function persistProviderMutation(
  mutate: (providers: Record<string, ProviderEntry>) => Record<string, ProviderEntry>,
  activeOverride?: { activeProvider: string; activeModel: string },
): Promise<void> {
  const cfg = getCachedConfig();
  const prevProviders: Record<string, ProviderEntry> = cfg?.providers ?? {};
  const nextProviders = mutate({ ...prevProviders });
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: activeOverride?.activeProvider ?? cfg?.activeProvider ?? '',
    activeModel: activeOverride?.activeModel ?? cfg?.activeModel ?? '',
    secrets: cfg?.secrets ?? {},
    providers: nextProviders,
    ...(cfg?.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
}

async function runAdd(): Promise<ClaudeCliStatus> {
  const { installed, version } = await resolveClaudeBinary();
  if (!installed) {
    throw new CodesignError(
      'Claude Code CLI not found on PATH. Install it first, then run `claude` to sign in.',
      ERROR_CODES.PROVIDER_AUTH_MISSING,
    );
  }
  const cfgBefore = getCachedConfig();
  const hasActive =
    cfgBefore !== null &&
    cfgBefore.activeProvider !== '' &&
    cfgBefore.providers[cfgBefore.activeProvider] !== undefined;
  const activateNow = !hasActive;

  await persistProviderMutation(
    (providers) => {
      providers[CLAUDE_CLI_PROVIDER_ID] = { ...CLAUDE_CLI_PROVIDER };
      return providers;
    },
    activateNow
      ? {
          activeProvider: CLAUDE_CLI_PROVIDER_ID,
          activeModel: CLAUDE_CLI_PROVIDER.defaultModel,
        }
      : undefined,
  );
  logger.info('claude-cli.add.ok', { activated: activateNow, version });
  return runStatus();
}

async function runRemove(): Promise<ClaudeCliStatus> {
  const cfg = getCachedConfig();
  if (cfg === null || cfg.providers[CLAUDE_CLI_PROVIDER_ID] === undefined) {
    return runStatus();
  }
  const wasActive = cfg.activeProvider === CLAUDE_CLI_PROVIDER_ID;
  await persistProviderMutation(
    (providers) => {
      delete providers[CLAUDE_CLI_PROVIDER_ID];
      return providers;
    },
    wasActive ? { activeProvider: '', activeModel: '' } : undefined,
  );
  logger.info('claude-cli.remove.ok');
  return runStatus();
}

export function registerClaudeCliIpc(): void {
  ipcMain.handle('claude-cli:v1:status', async (): Promise<ClaudeCliStatus> => runStatus());
  ipcMain.handle('claude-cli:v1:add', async (): Promise<ClaudeCliStatus> => runAdd());
  ipcMain.handle('claude-cli:v1:remove', async (): Promise<ClaudeCliStatus> => runRemove());
}
