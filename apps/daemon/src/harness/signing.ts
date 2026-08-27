/**
 * signing.ts — Ed25519 signing for harness evidence (contracts, verdicts).
 *
 * The signature is what makes a contract *frozen*: the judge verifies before
 * judging, so a criterion edited on disk fails verification instead of quietly
 * moving the goalposts.
 *
 * Design notes:
 * - Signing failure NEVER crashes a caller (logs + returns null). A missing
 *   signature surfaces later as `verifyContract() === false`.
 * - Verification failure IS loud (logs the reason) and returns false.
 * - node:crypto only, no dependencies.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  generateKeyPairSync,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessSignature } from './types';

import { DATA_DIR } from '../paths';
const KEY_PATH = path.join(DATA_DIR, 'harness-signing-key.json');

interface StoredKey {
  /** PKCS#8 PEM. */
  privateKey: string;
  /** SPKI DER, base64 — matches HarnessSignature.publicKey. */
  publicKey: string;
  createdAt: string;
}

let cached: StoredKey | null = null;

/**
 * Load the harness signing keypair, generating and persisting it on first use.
 * The private key never leaves this machine (the file is gitignored).
 */
export function getOrCreateSigningKey(): StoredKey {
  if (cached) return cached;

  if (existsSync(KEY_PATH)) {
    const parsed = JSON.parse(readFileSync(KEY_PATH, 'utf-8')) as StoredKey;
    if (!parsed.privateKey || !parsed.publicKey) {
      throw new Error(`Malformed harness signing key at ${KEY_PATH}`);
    }
    cached = parsed;
    return cached;
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const stored: StoredKey = {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    createdAt: new Date().toISOString(),
  };

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(KEY_PATH, JSON.stringify(stored, null, 2), { mode: 0o600 });
  cached = stored;
  return cached;
}

/**
 * Deterministic JSON: object keys sorted recursively, arrays left in order.
 * Two structurally equal payloads always produce the same string, so the hash
 * does not depend on property insertion order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    out[key] = sortKeys(source[key]);
  }
  return out;
}

/** sha256 hex of the canonicalized payload. */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload), 'utf-8').digest('hex');
}

/**
 * Sign a payload. Returns null (never throws) if signing is impossible — the
 * caller stores `signature: null`, which fails verification later.
 */
export function sign(payload: unknown): HarnessSignature | null {
  try {
    const key = getOrCreateSigningKey();
    const hash = payloadHash(payload);
    const signature = cryptoSign(null, Buffer.from(hash, 'hex'), createPrivateKey(key.privateKey));
    return { payloadHash: hash, signature: signature.toString('hex'), publicKey: key.publicKey };
  } catch (err) {
    console.error(
      `[harness/signing] signing failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Verify a payload against a signature. False on ANY failure, and every
 * failure is logged — a silent false here would let a tampered contract pass
 * as merely "unsigned".
 *
 * ponytail: trusts the public key embedded in the signature, so it detects
 * mutation but not a wholesale re-sign with an attacker's key.
 *
 * The rationale this note used to give — "contracts are git-tracked and travel
 * between machines" — was retired on 2026-08-13 (see contract-store.ts's
 * header: contracts are store data under DATA_DIR and are never git-tracked),
 * so it no longer justifies anything (codebase audit E18). What holds today is
 * narrower and worth stating plainly: everything this verifies was signed by
 * THIS machine's key, and an attacker who can re-sign a contract already has
 * write access to DATA_DIR — where the private key also lives. Pinning to the
 * local key would therefore raise the bar very little while breaking any store
 * whose key file was regenerated, or restored from another machine.
 *
 * Upgrade path (a maintainer call, not a code call): pin to
 * `getOrCreateSigningKey().publicKey`, with a migration for existing stores, or
 * an allowlist of trusted public keys if evidence is ever meant to travel.
 */
export function verify(payload: unknown, sig: HarnessSignature): boolean {
  try {
    const hash = payloadHash(payload);
    if (hash !== sig.payloadHash) {
      console.error(
        `[harness/signing] payload hash mismatch: expected ${sig.payloadHash}, got ${hash} — content was modified after signing`,
      );
      return false;
    }
    const publicKey = createPublicKey({
      key: Buffer.from(sig.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const ok = cryptoVerify(
      null,
      Buffer.from(hash, 'hex'),
      publicKey,
      Buffer.from(sig.signature, 'hex'),
    );
    if (!ok) console.error('[harness/signing] Ed25519 signature does not match payload hash');
    return ok;
  } catch (err) {
    console.error(
      `[harness/signing] verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
