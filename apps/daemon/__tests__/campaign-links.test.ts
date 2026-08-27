/**
 * The campaign runner's link logic (build brief §7, C1).
 *
 * These are the rules a chain manifest's credibility rests on, so they are
 * tested against real files and real Ed25519 signatures rather than mocks:
 *   - a verdict whose signature does not verify FAILS its link, and is
 *     quarantined rather than imported;
 *   - a verdict signed by a key that is not the booted instance's fails too;
 *   - a monitor that runs out of time is `error`, never `failed`;
 *   - an evidence copy is byte-identical to its source.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AuditScriptLink,
  EvidenceExportLink,
  InterludeMonitorLink,
} from '../../../scripts/acceptance/chains';
import {
  type ChainManifest,
  copyVerbatim,
  matchesAnyOf,
  positionalArgs,
  runAuditLink,
  runEvidenceExportLink,
  runInterludeLink,
  verifySignedFile,
} from '../../../scripts/acceptance/run-campaign';
import { getOrCreateSigningKey, sign } from '../src/harness/signing';

let tmp: string;
let publicKey: string;

const interlude: InterludeMonitorLink = {
  kind: 'interlude-monitor',
  id: 'test-build',
  description: 'a build reaches awaiting-verification',
  path: '/api/tasks',
  collection: 'tasks',
  anyOf: [{ kanban: 'awaiting-verification' }, { kanban: 'done' }],
  timeoutMs: 1_000,
  pollMs: 100,
};

const exportLink = (over: Partial<EvidenceExportLink> = {}): EvidenceExportLink => ({
  kind: 'evidence-export',
  id: 'test-export',
  description: "export the booted instance's runs",
  source: 'booted-runs',
  minArtifacts: 1,
  ...over,
});

/** A run dir in a fake booted data dir, with a verdict signed by `signer`. */
function plantRun(
  dataDir: string,
  runId: string,
  opts: { signed: boolean; tamper?: boolean },
): void {
  const runDir = path.join(dataDir, 'verification-runs', runId);
  mkdirSync(path.join(runDir, 'personas', 'spec-auditor'), { recursive: true });
  writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({ id: runId, status: 'complete' }),
    'utf-8',
  );
  writeFileSync(
    path.join(runDir, 'personas', 'spec-auditor', 'report.json'),
    JSON.stringify({ charter: 'spec-auditor' }),
    'utf-8',
  );
  if (!opts.signed) return;
  const payload = { runId, outcome: 'passed', criterionVerdicts: [] };
  const verdict = { ...payload, signature: sign(payload) };
  if (opts.tamper) verdict.outcome = 'failed'; // signed as passed, stored as failed
  writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf-8');
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ligma-campaign-test-'));
  publicKey = getOrCreateSigningKey().publicKey;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('interlude conditions', () => {
  it('matches when one item carries every field of one accepted shape', () => {
    const tasks = [{ kanban: 'queued' }, { kanban: 'awaiting-verification', id: 't2' }];
    expect(matchesAnyOf(tasks, interlude.anyOf)).toBe(true);
    expect(matchesAnyOf([{ kanban: 'queued' }], interlude.anyOf)).toBe(false);
    // A partial match is not a match: every field of one shape must hold.
    expect(
      matchesAnyOf(
        [{ kanban: 'done', deletedAt: 'x' }],
        [{ kanban: 'done', deletedAt: null as unknown as string }],
      ),
    ).toBe(false);
  });

  it('goes green as soon as the condition holds', async () => {
    let polls = 0;
    const outcome = await runInterludeLink(interlude, {
      fetchCollection: async () => {
        polls += 1;
        return polls < 3 ? [{ kanban: 'in-progress' }] : [{ kanban: 'awaiting-verification' }];
      },
      sleep: async () => undefined,
    });
    expect(outcome.status).toBe('green');
    expect(outcome.detail).toContain('3 poll(s)');
  });

  it('calls a timeout an ERROR, never a failure', async () => {
    let clock = 0;
    const outcome = await runInterludeLink(interlude, {
      fetchCollection: async () => [{ kanban: 'in-progress' }],
      sleep: async () => {
        clock += interlude.pollMs;
      },
      now: () => clock,
    });
    // "We did not see it happen" is not "the product is broken" (principle 12).
    expect(outcome.status).toBe('error');
    expect(outcome.detail).toContain('timed out');
  });

  it('reports the last fetch error when the API never answered', async () => {
    let clock = 0;
    const outcome = await runInterludeLink(interlude, {
      fetchCollection: async () => {
        throw new Error('ECONNREFUSED');
      },
      sleep: async () => {
        clock += interlude.pollMs;
      },
      now: () => clock,
    });
    expect(outcome.status).toBe('error');
    expect(outcome.detail).toContain('ECONNREFUSED');
  });
});

describe('signature verification on import', () => {
  it("accepts a verdict signed by the booted instance's key", () => {
    const dataDir = path.join(tmp, 'good');
    plantRun(dataDir, 'vrun_good', { signed: true });
    const check = verifySignedFile(
      path.join(dataDir, 'verification-runs', 'vrun_good', 'verdict.json'),
      publicKey,
    );
    expect(check.ok).toBe(true);
  });

  it('rejects a verdict whose content changed after signing', () => {
    const dataDir = path.join(tmp, 'tampered');
    plantRun(dataDir, 'vrun_tampered', { signed: true, tamper: true });
    const check = verifySignedFile(
      path.join(dataDir, 'verification-runs', 'vrun_tampered', 'verdict.json'),
      publicKey,
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Ed25519');
  });

  it("rejects a verdict signed by some other machine's key", () => {
    const dataDir = path.join(tmp, 'foreign');
    plantRun(dataDir, 'vrun_foreign', { signed: true });
    const check = verifySignedFile(
      path.join(dataDir, 'verification-runs', 'vrun_foreign', 'verdict.json'),
      'not-the-booted-instances-key',
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('different key');
  });

  it('rejects an unsigned verdict', () => {
    const file = path.join(tmp, 'unsigned.json');
    writeFileSync(file, JSON.stringify({ runId: 'x', signature: null }), 'utf-8');
    expect(verifySignedFile(file, publicKey).ok).toBe(false);
  });
});

describe('evidence export', () => {
  const deps = (name: string, dataDir: string, key: string | null) => ({
    bootedDataDir: dataDir,
    publicKey: key,
    chainOutDir: path.join(tmp, name, 'out'),
    lockerDir: path.join(tmp, name, 'locker'),
    outDir: path.join(tmp, name, 'campaign'),
  });

  it('copies run dirs verbatim into both the chain dir and the locker, and counts the signatures', () => {
    const dataDir = path.join(tmp, 'export-good', 'data');
    plantRun(dataDir, 'vrun_1', { signed: true });
    const d = deps('export-good', dataDir, publicKey);
    const outcome = runEvidenceExportLink(exportLink(), d);

    expect(outcome.status).toBe('green');
    expect(outcome.signaturesVerified).toBe(1);
    const source = path.join(dataDir, 'verification-runs', 'vrun_1', 'verdict.json');
    const copied = path.join(d.chainOutDir, 'runs', 'vrun_1', 'verdict.json');
    expect(readFileSync(copied)).toEqual(readFileSync(source));
    expect(existsSync(path.join(d.lockerDir, 'runs', 'vrun_1', 'run.json'))).toBe(true);
    // The persona report travelled with the run — the evidence, not just the verdict.
    expect(
      existsSync(
        path.join(d.chainOutDir, 'runs', 'vrun_1', 'personas', 'spec-auditor', 'report.json'),
      ),
    ).toBe(true);
  });

  it('fails the link on a bad signature and quarantines the file instead of importing it', () => {
    const dataDir = path.join(tmp, 'export-bad', 'data');
    plantRun(dataDir, 'vrun_bad', { signed: true, tamper: true });
    const d = deps('export-bad', dataDir, publicKey);
    const outcome = runEvidenceExportLink(exportLink(), d);

    expect(outcome.status).toBe('failed');
    expect(outcome.signaturesVerified).toBe(0);
    expect(existsSync(path.join(d.chainOutDir, 'rejected', 'vrun_bad', 'verdict.json'))).toBe(true);
    // Nothing about the rejected run entered the locker.
    expect(existsSync(path.join(d.lockerDir, 'runs', 'vrun_bad'))).toBe(false);
  });

  it('fails a run record that has no verdict at all', () => {
    const dataDir = path.join(tmp, 'export-none', 'data');
    plantRun(dataDir, 'vrun_noverdict', { signed: false });
    const outcome = runEvidenceExportLink(exportLink(), deps('export-none', dataDir, publicKey));
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('nothing is proved');
  });

  it('calls an empty export an error rather than a pass', () => {
    const outcome = runEvidenceExportLink(
      exportLink(),
      deps('export-empty', path.join(tmp, 'empty'), publicKey),
    );
    expect(outcome.status).toBe('error');
    expect(outcome.detail).toContain('nothing to export');
  });

  it('refuses to hand a matrix chain a manifest that is not green', () => {
    const base = path.join(tmp, 'manifests');
    const campaign = path.join(base, 'campaign');
    for (const [chainId, result] of [
      ['d1', 'green'],
      ['d2', 'red'],
    ] as const) {
      const dir = path.join(campaign, chainId);
      mkdirSync(dir, { recursive: true });
      const manifest: Partial<ChainManifest> = { chainId, result, links: [] };
      writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    }

    const outcome = runEvidenceExportLink(
      exportLink({
        source: 'campaign-manifests',
        requireChains: ['d1', 'd2', 'd3'],
        minArtifacts: 3,
      }),
      {
        bootedDataDir: '',
        publicKey: null,
        chainOutDir: path.join(base, 'out'),
        lockerDir: path.join(base, 'locker'),
        outDir: campaign,
      },
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('d2: manifest result is "red"');
    expect(outcome.detail).toContain('d3: no manifest');
    // The green one was still imported, so the report shows what DID exist.
    expect(existsSync(path.join(base, 'out', 'inputs', 'd1.json'))).toBe(true);
  });
});

describe('verbatim copying', () => {
  it('reproduces the bytes exactly, including binary evidence', () => {
    const from = path.join(tmp, 'shot.png');
    const to = path.join(tmp, 'copied', 'shot.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    writeFileSync(from, bytes);
    copyVerbatim(from, to);
    expect(readFileSync(to)).toEqual(bytes);
  });
});

describe('audit links', () => {
  const link: AuditScriptLink = {
    kind: 'audit-script',
    id: 'test-audit',
    description: 'an audit',
    script: 'scripts/audit/seam-audit.ts',
    args: [],
    timeoutMs: 1000,
  };

  it('is green on exit 0 and keeps the report', async () => {
    const chainOutDir = path.join(tmp, 'audit-green');
    const outcome = await runAuditLink(link, {
      chainOutDir,
      run: async () => ({ exitCode: 0, stdout: '{"result":"PASS"}', stderr: '' }),
    });
    expect(outcome.status).toBe('green');
    expect(readFileSync(path.join(chainOutDir, 'audits', 'test-audit.json'), 'utf-8')).toContain(
      'PASS',
    );
    // The raw stream is kept whatever happens — the report is derived from it.
    expect(
      readFileSync(path.join(chainOutDir, 'audits', 'test-audit.stdout.txt'), 'utf-8'),
    ).toContain('PASS');
  });

  it('finds the report even when a child process printed its banner first', async () => {
    const chainOutDir = path.join(tmp, 'audit-noisy');
    const outcome = await runAuditLink(link, {
      chainOutDir,
      run: async () => ({
        exitCode: 0,
        stdout: '> @ligma/daemon serve\nlistening on 4477\n{"result":"PASS","orphans":[]}\n',
        stderr: '',
      }),
    });
    expect(outcome.status).toBe('green');
    expect(
      JSON.parse(readFileSync(path.join(chainOutDir, 'audits', 'test-audit.json'), 'utf-8')),
    ).toEqual({
      result: 'PASS',
      orphans: [],
    });
  });

  it('says so when there is no JSON report at all', async () => {
    const outcome = await runAuditLink(link, {
      chainOutDir: path.join(tmp, 'audit-noreport'),
      run: async () => ({ exitCode: 0, stdout: 'crawling…\n', stderr: '' }),
    });
    expect(outcome.detail).toContain('no JSON report');
  });

  it('fails on a non-zero exit', async () => {
    const outcome = await runAuditLink(link, {
      chainOutDir: path.join(tmp, 'audit-red'),
      run: async () => ({ exitCode: 1, stdout: '{"result":"FAIL"}', stderr: 'orphans' }),
    });
    expect(outcome.status).toBe('failed');
  });

  it('calls a script that could not run an error, not a failure', async () => {
    const outcome = await runAuditLink(link, {
      chainOutDir: path.join(tmp, 'audit-error'),
      run: async () => {
        throw new Error('tsx not found');
      },
    });
    expect(outcome.status).toBe('error');
    expect(outcome.detail).toContain('tsx not found');
  });
});

describe('CLI argument parsing', () => {
  it("does not mistake a flag's value for the chain id", () => {
    expect(positionalArgs(['--out', '/tmp/x', 'd3', '--stub'])).toEqual(['d3']);
    expect(positionalArgs(['--stub'])).toEqual([]);
    expect(positionalArgs(['all', '--interlude-timeout-ms', '5000'])).toEqual(['all']);
  });
});
