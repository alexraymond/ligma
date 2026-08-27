import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { buildTaskPrompt } from '../src/engine/prompt-builder';
import { assignHoldouts, buildDeterministicCriteria } from '../src/harness/compile-contract';
import {
  type NewContract,
  getContract,
  getLatestContract,
  listVersions,
  saveContract,
  verifyContract,
  visibleCriteria,
} from '../src/harness/contract-store';
import { canonicalize, sign, verify } from '../src/harness/signing';
import type { AcceptanceContract, Criterion } from '../src/harness/types';

import { DATA_DIR } from '../src/paths';
const CONTRACTS_DIR = path.join(DATA_DIR, 'contracts');

/** Unique scope per test so runs never collide with real contracts. */
const scopes: string[] = [];
function testScope(label: string): string {
  const scope = `test_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  scopes.push(scope);
  return scope;
}

afterAll(() => {
  for (const scope of scopes) {
    const file = path.join(CONTRACTS_DIR, `${scope}.jsonl`);
    if (existsSync(file)) rmSync(file);
  }
});

function criterion(id: string, text: string, holdout = false): Criterion {
  return { id, kind: 'criterion', text, holdout, provenance: { source: 'test', quote: text } };
}

function newContract(scope: string, criteria: Criterion[]): NewContract {
  return {
    taskId: scope,
    productId: null,
    title: `Contract for ${scope}`,
    baselineRunId: null,
    criteria,
  };
}

// ─── Signing ────────────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('is insensitive to key insertion order', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('preserves array order', () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });
});

describe('sign / verify', () => {
  it('round-trips a payload', () => {
    const payload = { criteria: [criterion('crit_1', 'user can log in')] };
    const sig = sign(payload);
    expect(sig).not.toBeNull();
    expect(verify(payload, sig!)).toBe(true);
  });

  it('verifies a payload rebuilt with different key order', () => {
    const sig = sign({ a: 1, b: 2 });
    expect(verify({ b: 2, a: 1 }, sig!)).toBe(true);
  });

  it('rejects a mutated payload loudly', () => {
    const payload = { criteria: [criterion('crit_1', 'user can log in')] };
    const sig = sign(payload)!;
    payload.criteria[0].text = 'user can log in with any password';

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(verify(payload, sig)).toBe(false);
    expect(spy).toHaveBeenCalled(); // verification failure is never silent
    spy.mockRestore();
  });

  it('rejects a tampered signature', () => {
    const sig = sign({ x: 1 })!;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(verify({ x: 1 }, { ...sig, signature: `00${sig.signature.slice(2)}` })).toBe(false);
    spy.mockRestore();
  });
});

// ─── Store ──────────────────────────────────────────────────────────────────

describe('contract store', () => {
  it('signs what it saves', () => {
    const scope = testScope('signed');
    const contract = saveContract(newContract(scope, [criterion('crit_1', 'loads in under 2s')]));
    expect(contract.signature).not.toBeNull();
    expect(verifyContract(contract)).toBe(true);
    expect(contract.version).toBe(1);
    expect(contract.id).toMatch(/^ctr_[A-Za-z0-9_-]+$/);
  });

  it('detects a criterion edited after signing', () => {
    const scope = testScope('tamper');
    const contract = saveContract(
      newContract(scope, [criterion('crit_1', 'shows an error on bad input')]),
    );
    const tampered: AcceptanceContract = {
      ...contract,
      criteria: [{ ...contract.criteria[0], text: 'shows anything at all' }],
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(verifyContract(tampered)).toBe(false);
    spy.mockRestore();
  });

  it('treats an unsigned contract as unverified', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsigned = {
      id: 'ctr_0',
      version: 1,
      taskId: 't',
      productId: null,
      title: 't',
      baselineRunId: null,
      criteria: [],
      createdAt: 'now',
      signature: null,
    };
    expect(verifyContract(unsigned)).toBe(false);
    spy.mockRestore();
  });

  it('appends versions, latest wins, versions ordered', () => {
    const scope = testScope('versions');
    saveContract(newContract(scope, [criterion('crit_1', 'v1 behaviour')]));
    saveContract(newContract(scope, [criterion('crit_1', 'v2 behaviour')]));
    const third = saveContract(newContract(scope, [criterion('crit_1', 'v3 behaviour')]));

    expect(listVersions(scope)).toEqual([1, 2, 3]);
    expect(getLatestContract(scope)!.version).toBe(3);
    expect(getLatestContract(scope)!.criteria[0].text).toBe('v3 behaviour');
    expect(getContract(scope, 1)!.criteria[0].text).toBe('v1 behaviour');
    expect(getContract(scope, 4)).toBeNull();
    // Old versions stay verifiable — the store never rewrites history.
    expect(verifyContract(getContract(scope, 1)!)).toBe(true);
    expect(verifyContract(third)).toBe(true);
  });

  it('returns null / empty for an unknown scope', () => {
    expect(getLatestContract('test_scope_that_does_not_exist')).toBeNull();
    expect(listVersions('test_scope_that_does_not_exist')).toEqual([]);
  });

  it('requires a scope', () => {
    expect(() =>
      saveContract({
        taskId: null,
        productId: null,
        title: 'x',
        baselineRunId: null,
        criteria: [],
      }),
    ).toThrow(/scope/);
  });

  it('visibleCriteria hides holdouts', () => {
    const contract = {
      criteria: [criterion('crit_1', 'a'), criterion('crit_2', 'b', true)],
    } as AcceptanceContract;
    expect(visibleCriteria(contract).map((c) => c.id)).toEqual(['crit_1']);
  });
});

// ─── Holdout split ──────────────────────────────────────────────────────────

describe('holdout assignment', () => {
  const criteriaOf = (n: number) =>
    Array.from({ length: n }, (_, i) => criterion(`crit_${i + 1}`, `criterion ${i + 1}`));

  it('is deterministic across calls', () => {
    for (let n = 1; n <= 10; n++) {
      const a = assignHoldouts(criteriaOf(n)).map((c) => c.holdout);
      const b = assignHoldouts(criteriaOf(n)).map((c) => c.holdout);
      expect(b).toEqual(a);
    }
  });

  it('ignores the incoming holdout flags (recomputes from id)', () => {
    const preset = criteriaOf(5).map((c) => ({ ...c, holdout: true }));
    expect(assignHoldouts(preset).some((c) => !c.holdout)).toBe(true);
  });

  it('always leaves at least one visible criterion', () => {
    for (let n = 1; n <= 10; n++) {
      const out = assignHoldouts(criteriaOf(n));
      expect(out.filter((c) => !c.holdout).length, `n=${n}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('always holds out at least one criterion when there are 2+', () => {
    for (let n = 2; n <= 10; n++) {
      const out = assignHoldouts(criteriaOf(n));
      expect(out.filter((c) => c.holdout).length, `n=${n}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps a single criterion visible', () => {
    expect(assignHoldouts(criteriaOf(1))[0].holdout).toBe(false);
  });

  it('always holds out invariants', () => {
    const out = assignHoldouts([
      criterion('crit_1', 'a'),
      criterion('crit_2', 'b'),
      {
        id: 'inv_1',
        kind: 'invariant',
        text: 'never loses data',
        holdout: false,
        provenance: null,
      },
    ]);
    expect(out.find((c) => c.id === 'inv_1')?.holdout).toBe(true);
    expect(out.filter((c) => c.kind === 'criterion' && !c.holdout).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('builds criteria verbatim with task provenance', () => {
    const texts = [
      'user can export a CSV',
      'export completes in under 5s',
      'empty export shows a notice',
    ];
    const out = buildDeterministicCriteria(texts);
    expect(out.map((c) => c.text)).toEqual(texts);
    expect(out.map((c) => c.id)).toEqual(['crit_1', 'crit_2', 'crit_3']);
    expect(out.every((c) => c.kind === 'criterion')).toBe(true);
    expect(out[0].provenance).toEqual({ source: 'task.acceptanceCriteria', quote: texts[0] });
    expect(out.filter((c) => c.holdout).length).toBeGreaterThanOrEqual(1);
    expect(out.filter((c) => !c.holdout).length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Prompt injection ───────────────────────────────────────────────────────

const WITHHELD_NOTICE = 'Additional acceptance criteria are withheld';

function fakeTask(id: string, acceptanceCriteria: string[]) {
  return {
    id,
    title: 'Harness prompt injection probe',
    description: 'A task used to check contract-aware prompt building.',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'not-started',
    assignedTo: 'developer',
    projectId: null,
    collaborators: [],
    subtasks: [],
    acceptanceCriteria,
    notes: '',
    estimatedMinutes: null,
  };
}

describe('buildTaskPrompt contract injection', () => {
  const texts = [
    'user can export a CSV',
    'export completes in under 5s',
    'empty export shows a notice',
  ];

  it('injects task.acceptanceCriteria verbatim when no contract exists', () => {
    const prompt = buildTaskPrompt('developer', fakeTask(testScope('nocontract'), texts));
    for (const t of texts) expect(prompt).toContain(t);
    expect(prompt).not.toContain(WITHHELD_NOTICE);
  });

  it('injects only the visible slice plus the withheld notice when a contract exists', () => {
    const scope = testScope('withcontract');
    const contract = saveContract(newContract(scope, buildDeterministicCriteria(texts)));
    const holdout = contract.criteria.filter((c) => c.holdout);
    const visible = visibleCriteria(contract);
    expect(holdout.length).toBeGreaterThanOrEqual(1);
    expect(visible.length).toBeGreaterThanOrEqual(1);

    const prompt = buildTaskPrompt('developer', fakeTask(scope, texts));
    for (const c of visible) expect(prompt).toContain(c.text);
    for (const c of holdout) expect(prompt).not.toContain(c.text);
    expect(prompt).toContain(WITHHELD_NOTICE);
  });

  it('uses the latest contract version', () => {
    const scope = testScope('latestversion');
    saveContract(newContract(scope, [criterion('crit_1', 'v1 only criterion')]));
    saveContract(newContract(scope, [criterion('crit_1', 'v2 only criterion')]));

    const prompt = buildTaskPrompt('developer', fakeTask(scope, texts));
    expect(prompt).toContain('v2 only criterion');
    expect(prompt).not.toContain('v1 only criterion');
    // Task criteria are superseded by the contract.
    for (const t of texts) expect(prompt).not.toContain(t);
  });
});
