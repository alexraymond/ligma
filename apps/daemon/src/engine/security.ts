import path from 'node:path';

// ─── Credential Scrubbing ────────────────────────────────────────────────────

const CREDENTIAL_PATTERNS = [
  // API keys: sk-..., key-..., ak-...
  /\b(sk|key|ak|api[_-]?key)[_-][\w-]{20,}\b/gi,
  // Bearer tokens
  /Bearer\s+[\w\-.~+/]+=*/gi,
  // AWS-style keys
  /\bAKIA[A-Z0-9]{16}\b/g,
  // Generic password patterns
  /password\s*[:=]\s*\S+/gi,
  // Email:password combos
  /[\w.+-]+@[\w-]+\.[\w.]+:[\S]+/g,
  // GitHub tokens
  /\bgh[ps]_[A-Za-z0-9_]{36,}\b/g,
  // npm tokens
  /\bnpm_[A-Za-z0-9]{36,}\b/g,
  // Slack tokens (bot, user, app, session)
  /\bxox[bpas]-[\w-]{10,}\b/g,
  // Stripe keys (secret + restricted, live + test)
  /\b[sr]k_(live|test)_[A-Za-z0-9]{20,}\b/g,
  // Anthropic API keys
  /\bsk-ant-[\w-]{20,}\b/g,
  // SSH private key markers
  /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  // Database connection strings (postgres, mysql, mongodb, redis)
  /\b(postgres|mysql|mongodb(\+srv)?|redis):\/\/[^\s]+/gi,
  // Generic token= patterns
  /\btoken\s*[:=]\s*[\w\-.~+/]{20,}/gi,
];

/**
 * Base64 blobs (40+ chars, likely secrets). Runs last and on its own, because
 * `/` is a base64 character: an absolute filesystem path is otherwise a
 * 40-plus-character run of the same alphabet, and `/Users/alex/…` came out of
 * run logs and inferred boot recipes as `/[REDACTED]` (D3 attempt 3, crit_2).
 */
const BASE64_BLOB = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;

/** How long a path segment may be before it is a secret sitting in a path. */
const MAX_PATH_SEGMENT = 40;

/**
 * A blob that is really a path, and only that.
 *
 * The word boundary means the match starts after the leading slash, so being
 * rooted is read off the character before it (`/…` or `~/…`). Then every
 * segment must look like a path component: non-empty, shorter than a base64
 * blob in its own right, and free of `+` and `=`, which no ordinary filename
 * carries but padded base64 does. Anything else keeps redacting — a secret
 * that happens to sit inside a path still has a segment that reads as one.
 */
function isFilesystemPath(match: string, precededBy: string): boolean {
  if (precededBy !== '/') return false;
  const segments = match.split('/');
  if (segments.length < 2) return false;
  return segments.every((s) => s.length > 0 && s.length < MAX_PATH_SEGMENT && !/[+=]/.test(s));
}

/**
 * Scrub credentials from text before logging or storing.
 * Replaces matches with [REDACTED].
 */
export function scrubCredentials(text: string): string {
  let result = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result.replace(BASE64_BLOB, (match: string, offset: number, whole: string) =>
    isFilesystemPath(match, whole[offset - 1] ?? '') ? match : '[REDACTED]',
  );
}

// ─── Path Validation ─────────────────────────────────────────────────────────

/**
 * Validate that a file path resolves within the workspace root.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
export function validatePathWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(workspaceRoot, filePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  return resolved.startsWith(normalizedRoot + path.sep) || resolved === normalizedRoot;
}

// ─── Prompt Sanitization ─────────────────────────────────────────────────────

const MAX_PROMPT_LENGTH = 100_000; // 100KB max prompt

/**
 * Escape content that could break out of the task-context fence.
 * Replaces closing fence tags within the content to prevent injection.
 */
export function escapeFenceContent(content: string): string {
  return content.replace(/<\/task-context>/gi, '<\\/task-context>');
}

/**
 * Wrap task data in delimiters to structurally separate it from agent instructions.
 * This prevents task descriptions from being interpreted as agent commands.
 * Content is escaped to prevent fence breakout via injected closing tags.
 */
export function fenceTaskData(taskData: string): string {
  const escaped = escapeFenceContent(taskData);
  return `<task-context>\n${escaped}\n</task-context>`;
}

/**
 * Enforce maximum prompt length to prevent context stuffing.
 */
export function enforcePromptLimit(prompt: string): string {
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return `${prompt.slice(0, MAX_PROMPT_LENGTH)}\n\n[PROMPT TRUNCATED — exceeded 100KB limit]`;
  }
  return prompt;
}

// ─── Spawn Safety ────────────────────────────────────────────────────────────

const ALLOWED_BINARIES = [
  'claude',
  'claude.cmd',
  'claude.exe',
  'codex',
  'codex.cmd',
  'codex.exe',
  'gemini',
  'gemini.cmd',
  'gemini.exe',
];

/**
 * Validate that only the Claude binary is being spawned.
 * Prevents arbitrary command execution.
 */
export function validateBinary(binary: string): boolean {
  const baseName = path.basename(binary).toLowerCase();
  return ALLOWED_BINARIES.includes(baseName);
}

/**
 * Build a safe environment for child processes.
 * Passes PATH, HOME/USERPROFILE, APPDATA, TEMP, and on Windows,
 * SystemRoot/WINDIR/COMSPEC/PATHEXT (required for node.exe).
 * Strips all other env vars to prevent credential leakage.
 */
export function buildSafeEnv(opts?: { agentTeams?: boolean; role?: string }): Record<
  string,
  string
> {
  // Start with a copy of the current environment, then strip known sensitive vars.
  // A denylist approach is safer than an allowlist because Claude Code needs
  // many OS-level env vars for authentication (Keychain access on macOS),
  // TLS/HTTP, and locale — stripping them causes silent auth failures.
  const safeEnv: Record<string, string> = {};

  // Copy all env vars
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      safeEnv[key] = value;
    }
  }

  // Strip vars that could leak secrets to child processes
  const SENSITIVE_PATTERNS = [
    /^ANTHROPIC_API_KEY$/i,
    /^OPENAI_API_KEY$/i,
    /^AWS_SECRET_ACCESS_KEY$/i,
    /^AWS_SESSION_TOKEN$/i,
    /^GITHUB_TOKEN$/i,
    /^GH_TOKEN$/i,
    /^NPM_TOKEN$/i,
    /^STRIPE_SECRET/i,
    /^DATABASE_URL$/i,
    /^DB_PASSWORD$/i,
    /^REDIS_URL$/i,
    /^MONGO.*URI$/i,
  ];

  for (const key of Object.keys(safeEnv)) {
    if (SENSITIVE_PATTERNS.some((p) => p.test(key))) {
      delete safeEnv[key];
    }
  }

  // Strip the CLAUDECODE var to prevent "nested session" detection
  delete safeEnv.CLAUDECODE;
  delete safeEnv.CLAUDE_CODE_ENTRYPOINT;

  // Agent Teams: experimental multi-agent coordination
  if (opts?.agentTeams) {
    safeEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
  }

  // Which governor role spawned this child — lets a stand-in CLI (drill mode's
  // fake-claude) reply in the shape that role's parser expects, typed at the
  // source (SpawnOptions.role) rather than sniffed from the prompt.
  if (opts?.role) {
    safeEnv.LIGMA_SPAWN_ROLE = opts.role;
  }

  return safeEnv;
}
