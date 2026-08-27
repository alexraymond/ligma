/**
 * completeWithRetry — exponential backoff wrapper around `complete()`.
 *
 * PRINCIPLES §10 (errors loud): every retry attempt is surfaced via the
 * `onRetry` callback so the UI can show a status line. Silent retries are
 * forbidden — the user must see why the call took longer than expected.
 *
 * Retry policy (Tier 1, intentionally conservative):
 *   - max 3 attempts by default (1 initial + 2 retries; the `maxRetries`
 *     option is the total attempt count despite its name)
 *   - exponential delay: baseDelayMs * 2^(attempt-1) with ±20% jitter
 *   - retry only on transient classes: 5xx, network/abort-unrelated, 429
 *   - 429 honours Retry-After header (seconds or HTTP-date) when present
 *   - any AbortSignal abort short-circuits immediately, no retry
 */

import { type ChatMessage, ERROR_CODES, LigmaError, type ModelRef } from '@ligma/shared';
import { normalizeProviderError } from './errors';
import { type GenerateOptions, type GenerateResult, complete } from './index';

export interface RetryReason {
  attempt: number;
  totalAttempts: number;
  delayMs: number;
  reason: string;
  retryAfterMs?: number;
}

export interface CompleteWithRetryOptions {
  /**
   * Total attempts INCLUDING the first — despite the name. `maxRetries: 3`
   * means one initial call plus at most two retries, not four calls. The name
   * is kept for back-compat with existing callers; `DEFAULT_MAX_ATTEMPTS`
   * below is what it really is (P26).
   */
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (info: RetryReason) => void;
  logger?: { warn: (event: string, data?: Record<string, unknown>) => void };
  provider?: string;
}

/** Total attempts, not extra retries — see CompleteWithRetryOptions.maxRetries. */
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

interface RetryDecision {
  retry: boolean;
  reason: string;
  retryAfterMs?: number;
}

const RETRYABLE_NET_CODES = new Set([
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
]);

function classifyByStatus(status: number, err: unknown): RetryDecision | undefined {
  if (status === 429) {
    const retryAfterMs = extractRetryAfterMs(err);
    const decision: RetryDecision = { retry: true, reason: 'rate-limited (429)' };
    if (retryAfterMs !== undefined) decision.retryAfterMs = retryAfterMs;
    return decision;
  }
  if (status >= 500 && status <= 599) {
    return { retry: true, reason: `server error (${status})` };
  }
  if (status >= 400 && status <= 499) {
    return { retry: false, reason: `client error (${status})` };
  }
  return undefined;
}

function classifyByNetwork(err: unknown): RetryDecision | undefined {
  if (err instanceof TypeError) return { retry: true, reason: 'network error' };
  if (!(err instanceof Error)) return undefined;
  const code = (err as Error & { code?: unknown }).code;
  if (typeof code === 'string' && RETRYABLE_NET_CODES.has(code)) {
    return { retry: true, reason: `network error (${code})` };
  }
  return undefined;
}

export function classifyError(err: unknown): RetryDecision {
  if (err instanceof Error && (err.name === 'AbortError' || err.message === 'aborted')) {
    return { retry: false, reason: 'aborted' };
  }
  const status = extractStatus(err);
  if (status !== undefined) {
    const byStatus = classifyByStatus(status, err);
    if (byStatus) return byStatus;
  }
  const byNet = classifyByNetwork(err);
  if (byNet) return byNet;
  return { retry: false, reason: errorMessage(err) };
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { response?: { status?: unknown } }).response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  // Deliberately no prose scraping here. Boundaries that know a status attach
  // it structurally (`LigmaError` carries `status`, SDK errors carry
  // `.status` / `.response.status`); scraping "the first 3-digit number in the
  // message" classified `exceeded 512 tokens` as a retryable 5xx.
  return undefined;
}

function extractRetryAfterMs(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const headers =
    (err as { headers?: Record<string, string | string[] | undefined> }).headers ??
    (err as { response?: { headers?: Record<string, string | string[] | undefined> } }).response
      ?.headers;
  const direct = (err as { retryAfter?: unknown }).retryAfter;
  const raw =
    pickHeader(headers, 'retry-after') ??
    (typeof direct === 'string' || typeof direct === 'number' ? String(direct) : undefined);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // Empty / whitespace-only headers must not coerce to 0 via Number(''),
  // which would otherwise emit a zero-delay retry hint and defeat backoff.
  if (trimmed.length === 0) return undefined;
  // Numeric path first — explicit shape so '7' / '1.5' parse but a
  // Date-formatted header ('Wed, 21 Oct 2015 …') falls through to Date.parse.
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) return clampRetryAfter(seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return clampRetryAfter(dateMs - Date.now());
  return undefined;
}

/**
 * A `Retry-After: 3600` used to stall generation for a full hour with no UI
 * affordance to escape. The hint is advisory: honour it up to the cap, then
 * fall back to ordinary exponential backoff and let the attempt fail loudly.
 */
const MAX_RETRY_AFTER_MS = 60_000;

function clampRetryAfter(ms: number): number {
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

function pickHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) {
      if (Array.isArray(v)) return v[0];
      if (typeof v === 'string') return v;
    }
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function computeDelay(attempt: number, baseDelayMs: number): number {
  const exponent = Math.max(0, attempt - 1);
  const base = baseDelayMs * 2 ** exponent;
  const jitter = base * (Math.random() * 0.4 - 0.2);
  return Math.max(0, Math.round(base + jitter));
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type CompleteFn = (
  model: ModelRef,
  messages: ChatMessage[],
  opts: GenerateOptions,
) => Promise<GenerateResult>;

function buildRetryInfo(
  attempt: number,
  totalAttempts: number,
  decision: RetryDecision,
  baseDelayMs: number,
): RetryReason {
  const backoff = computeDelay(attempt, baseDelayMs);
  const delayMs =
    decision.retryAfterMs !== undefined ? Math.max(decision.retryAfterMs, backoff) : backoff;
  const info: RetryReason = { attempt, totalAttempts, delayMs, reason: decision.reason };
  if (decision.retryAfterMs !== undefined) info.retryAfterMs = decision.retryAfterMs;
  return info;
}

function shouldStop(decision: RetryDecision, attempt: number, maxAttempts: number): boolean {
  return !decision.retry || attempt >= maxAttempts;
}

export async function completeWithRetry(
  model: ModelRef,
  messages: ChatMessage[],
  opts: GenerateOptions,
  retryOpts: CompleteWithRetryOptions = {},
  // Injected for tests; defaults to the real `complete`.
  _impl: CompleteFn = complete,
): Promise<GenerateResult> {
  const maxAttempts = retryOpts.maxRetries ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = retryOpts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const onRetry = retryOpts.onRetry;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new LigmaError('Generation aborted by user', ERROR_CODES.PROVIDER_ABORTED);
    }
    try {
      return await _impl(model, messages, opts);
    } catch (err) {
      lastError = err;
      const decision = classifyError(err);
      const retryCount = attempt - 1;
      const normalized = normalizeProviderError(err, retryOpts.provider ?? 'unknown', retryCount);
      if (shouldStop(decision, attempt, maxAttempts)) {
        retryOpts.logger?.warn(
          'provider.error.final',
          normalized as unknown as Record<string, unknown>,
        );
        if (decision.reason === 'aborted') {
          throw new LigmaError('Generation aborted by user', ERROR_CODES.PROVIDER_ABORTED, {
            cause: err,
          });
        }
        throw err;
      }
      const info = buildRetryInfo(attempt, maxAttempts, decision, baseDelayMs);
      onRetry?.(info);
      retryOpts.logger?.warn('provider.error', normalized as unknown as Record<string, unknown>);
      await sleepWithAbort(info.delayMs, opts.signal);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new LigmaError('completeWithRetry exhausted', ERROR_CODES.PROVIDER_RETRY_EXHAUSTED);
}
