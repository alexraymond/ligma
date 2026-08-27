import { readFileSync } from 'node:fs';
import path from 'node:path';
/**
 * S1 (D7 re-triage, MC-298): the compiled-contract pipeline exercised on a
 * REAL live run, not a hand-built fixture.
 *
 * The fixture is line 3 (version 3) of `data/contracts/proj_ligma__d1a-compose-promote.jsonl`,
 * copied verbatim (no scrub needed — a compiled contract is criteria text,
 * provenance quotes and a public Ed25519 key/signature; nothing sensitive) —
 * it was produced by a real `d1a-compose-promote` verification run
 * (`vrun_1786588762600`, contract `ctr_1786588762601`), not synthesized for
 * this test.
 *
 * Honest scope note — read before citing this test as MC-298 evidence:
 * this contract's `productId` (no `taskId`) shows it came from
 * `journeyCriteria()` in `src/harness/run-journey.ts`, the DETERMINISTIC
 * journey-contract compiler that grades a journey walkthrough. It did not go
 * through `compileWithLlm` in `src/harness/compile-contract.ts:193` — that
 * function is a private, CLI-only path (`compile-contract.ts --llm`) that no
 * production code calls; the live promote flow builds contracts through
 * `compilePromotedContract` instead (`src/studio/promote.ts:402`), from
 * criteria already phrased upstream by the promote planner. So this fixture
 * proves the shared contract schema + Ed25519 sign/verify pipeline holds on
 * a real run's output — it does NOT specifically exercise `compileWithLlm`,
 * which remains uncalled by any live path and still has no unit test.
 */
import { describe, expect, it } from 'vitest';
import { verifyContract } from '../src/harness/contract-store';
import type { AcceptanceContract } from '../src/harness/types';

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/contracts/proj_ligma__d1a-compose-promote-v3.jsonl',
);

function loadFixtureContract(): AcceptanceContract {
  const line = readFileSync(FIXTURE_PATH, 'utf-8').trim();
  return JSON.parse(line) as AcceptanceContract;
}

describe('compiled-contract fixture (real d1a-compose-promote run, v3)', () => {
  it('parses as a well-formed AcceptanceContract', () => {
    const contract = loadFixtureContract();

    expect(contract.id).toMatch(/^ctr_\d+$/);
    expect(contract.version).toBe(3);
    expect(contract.taskId).toBeNull();
    expect(contract.productId).toBe('proj_ligma__d1a-compose-promote');
    expect(typeof contract.title).toBe('string');
    expect(contract.title.length).toBeGreaterThan(0);
    expect(Array.isArray(contract.criteria)).toBe(true);
  });

  it('carries non-empty, real criteria with provenance', () => {
    const contract = loadFixtureContract();

    expect(contract.criteria.length).toBeGreaterThan(0);
    for (const criterion of contract.criteria) {
      expect(criterion.id).toMatch(/^(crit|inv)_/);
      expect(['criterion', 'invariant']).toContain(criterion.kind);
      expect(criterion.text.length).toBeGreaterThan(0);
      expect(criterion.provenance).not.toBeNull();
      expect(criterion.provenance!.quote.length).toBeGreaterThan(0);
    }
  });

  it('verifies against the real Ed25519 signature it shipped with', () => {
    const contract = loadFixtureContract();

    expect(contract.signature).not.toBeNull();
    expect(verifyContract(contract)).toBe(true);
  });

  it('fails verification if a criterion is tampered with post-signing', () => {
    const contract = loadFixtureContract();
    const tampered: AcceptanceContract = {
      ...contract,
      criteria: [
        { ...contract.criteria[0], text: 'a criterion nobody signed' },
        ...contract.criteria.slice(1),
      ],
    };

    expect(verifyContract(tampered)).toBe(false);
  });
});

/**
 * The two contracts that used to be git-tracked under `data/contracts/`.
 *
 * docs/history/CONTRACTS.md's 2026-08-13 amendment retires the "contracts are tracked
 * in git" pin, and rests the audit trail on the signature instead. That claim
 * is only worth making if the signature actually survives a contract leaving
 * the store, so these two — both produced by real runs — are kept here and
 * verified: an append-only signed line is checkable wherever it ends up.
 */
describe('the ex-tracked dogfood contracts, kept as regression fixtures', () => {
  const FIXTURES = ['task_harness_dogfood.jsonl', 'task_sf001-dogfood.jsonl'] as const;

  function loadAll(file: string): AcceptanceContract[] {
    return readFileSync(path.join(__dirname, 'fixtures/contracts', file), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AcceptanceContract);
  }

  for (const file of FIXTURES) {
    it(`${file}: every line is signed, verifies, and versions monotonically`, () => {
      const contracts = loadAll(file);
      expect(contracts.length).toBeGreaterThan(0);

      contracts.forEach((contract, index) => {
        // Append-only: line N is version N+1 of the same scope.
        expect(contract.version).toBe(index + 1);
        expect(contract.taskId ?? contract.productId).toBe(
          contracts[0].taskId ?? contracts[0].productId,
        );
        expect(contract.signature).not.toBeNull();
        expect(verifyContract(contract)).toBe(true);
      });
    });
  }
});
