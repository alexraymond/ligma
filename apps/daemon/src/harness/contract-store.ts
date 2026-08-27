/**
 * contract-store.ts — append-only storage for acceptance contracts.
 *
 * One JSONL file per scope (`<DATA_DIR>/contracts/<taskId|productId>.jsonl`),
 * one signed AcceptanceContract per line, newest version last. Nothing is ever
 * rewritten: editing a criterion means appending version N+1, so the history
 * of what "done" meant stays auditable.
 *
 * Contracts are STORE DATA, not repo content: they live under DATA_DIR
 * (`~/.ligma/data` by default) and are never git-tracked. The original pin
 * said the opposite — see the 2026-08-13 amendment in docs/history/CONTRACTS.md for
 * why it was retired. Audit trail is the append-only file plus the Ed25519
 * signature, not `git log`; the committed samples are regression fixtures
 * under `apps/daemon/__tests__/fixtures/contracts/`, not the live store.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { withFileLock } from '../engine/file-lock';
import { generateId } from '../store/ids';
import { sign, verify } from './signing';
import type { AcceptanceContract, Criterion } from './types';

import { DATA_DIR } from '../paths';
const CONTRACTS_DIR = path.join(DATA_DIR, 'contracts');

export type NewContract = Omit<AcceptanceContract, 'id' | 'version' | 'signature' | 'createdAt'>;

/** basename() keeps a hostile scope ("../../etc/x") inside the contracts dir. */
function scopeFile(scope: string): string {
  return path.join(CONTRACTS_DIR, `${path.basename(scope)}.jsonl`);
}

function readAll(scope: string): AcceptanceContract[] {
  const file = scopeFile(scope);
  if (!existsSync(file)) return [];

  const out: AcceptanceContract[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AcceptanceContract);
    } catch {
      // Loud: a corrupt line means part of the oracle is unreadable.
      console.error(`[harness/contract-store] skipping unparseable line in ${file}`);
    }
  }
  return out;
}

/** The signed payload: everything except the signature itself. */
function unsignedPayload(contract: AcceptanceContract): Omit<AcceptanceContract, 'signature'> {
  const { signature: _signature, ...rest } = contract;
  return rest;
}

/**
 * Append a new contract version for its scope, signed.
 * Assigns id, next version, createdAt.
 */
export function saveContract(input: NewContract): AcceptanceContract {
  const scope = input.taskId ?? input.productId;
  if (!scope) throw new Error('Contract needs a taskId or productId to define its scope');

  mkdirSync(CONTRACTS_DIR, { recursive: true });

  return withFileLock(`contracts-${path.basename(scope)}`, () => {
    const existing = readAll(scope);
    const unsigned: AcceptanceContract = {
      ...input,
      // generateId, not Date.now(): commitPromote saves one contract per task
      // in a tight loop, and same-millisecond ids gave five tasks one id.
      id: generateId('ctr'),
      version: existing.reduce((max, c) => Math.max(max, c.version), 0) + 1,
      createdAt: new Date().toISOString(),
      signature: null,
    };
    const contract: AcceptanceContract = {
      ...unsigned,
      signature: sign(unsignedPayload(unsigned)),
    };
    appendFileSync(scopeFile(scope), `${JSON.stringify(contract)}\n`, 'utf-8');
    return contract;
  });
}

/** Highest version for the scope, or null if the scope has no contracts. */
export function getLatestContract(scope: string): AcceptanceContract | null {
  return readAll(scope).reduce<AcceptanceContract | null>(
    (latest, c) => (latest === null || c.version > latest.version ? c : latest),
    null,
  );
}

export function getContract(scope: string, version: number): AcceptanceContract | null {
  return readAll(scope).find((c) => c.version === version) ?? null;
}

/** Versions present for the scope, ascending. */
export function listVersions(scope: string): number[] {
  return readAll(scope)
    .map((c) => c.version)
    .sort((a, b) => a - b);
}

/** False if unsigned or if any byte of the contract changed after signing. */
export function verifyContract(contract: AcceptanceContract): boolean {
  if (!contract.signature) {
    console.error(`[harness/contract-store] contract ${contract.id} has no signature`);
    return false;
  }
  return verify(unsignedPayload(contract), contract.signature);
}

/** The slice a builder is allowed to see. The panel tests 100%. */
export function visibleCriteria(contract: AcceptanceContract): Criterion[] {
  return contract.criteria.filter((c) => !c.holdout);
}
