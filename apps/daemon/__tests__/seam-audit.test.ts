/**
 * The seam audit's rules (build brief D5), against fixtures.
 *
 * Each rule is tested twice — on a tree that obeys it and on one that breaks it
 * — because an audit that cannot fail is not an audit. The fixtures mirror the
 * real layout (`components/status-pill.tsx`, `app/globals.css`) since the rules
 * are anchored on those paths.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditSeams,
  collectSources,
  ruleErrorDistinctFromFailed,
  ruleGreenCheckNeedsVerdict,
  ruleOnePillVocabulary,
  ruleOneShimmerPrimitive,
  stateClassName,
} from '../../../scripts/audit/seam-audit';

/** The canonical pill, obeying every rule. */
const GOOD_PILL = `"use client";
import { CheckCircle2, XCircle, OctagonAlert, ShieldQuestion } from "lucide-react";
import type { VerificationStatus } from "@ligma/api";

const VERIFICATION = {
  unverified: { label: "Unverified", className: "border-muted-foreground/40 text-muted-foreground", icon: ShieldQuestion },
  passed: { label: "Passed", className: "border-green-600/50 text-green-600", icon: CheckCircle2 },
  failed: { label: "Failed", className: "border-destructive/60 text-destructive", icon: XCircle },
};

const EXECUTION = {
  running: { label: "Running", className: "border-blue-500/50 text-blue-600" },
  done: { label: "Done", className: "border-green-600/50 text-green-600" },
  error: { label: "Error", className: "border-amber-600/60 text-amber-700", icon: OctagonAlert },
};

export function VerificationPill({ status, verdictHref }: { status: VerificationStatus; verdictHref: string | null }) {
  const unbacked = status === "passed" && !verdictHref;
  const style = unbacked ? { label: "passed (no verdict)", className: "border-amber-500/50 text-amber-600" } : VERIFICATION[status];
  const pill = <Badge className={style.className}>{style.label}</Badge>;
  if (!verdictHref || unbacked) return pill;
  return <Link href={verdictHref}>{pill}</Link>;
}
`;

let root: string;

function write(rel: string, content: string): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf-8');
}

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-fixture-'));
  write('components/status-pill.tsx', GOOD_PILL);
  write(
    'components/ui/skeleton.tsx',
    'function Skeleton({ className }) { return <div className="animate-pulse" />; }\nexport { Skeleton };\n',
  );
  write(
    'app/page.tsx',
    'export default function Page() { return <div className="rounded-full">hello</div>; }\n',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a tree that obeys the seams', () => {
  it('passes every rule', () => {
    const report = auditSeams(root);
    expect(report.result).toBe('PASS');
    expect(report.rules.map((r) => r.id).sort()).toEqual([
      'error-distinct-from-failed',
      'green-check-needs-verdict-link',
      'one-shimmer-primitive',
      'one-status-pill-vocabulary',
    ]);
  });

  it('ignores tests, type declarations and build output', () => {
    write(
      'components/rogue.test.tsx',
      'const S = { passed: "x", failed: "y" }; // rounded-full border-green-500\n',
    );
    write(
      '.next/static/chunk.tsx',
      'const S = { passed: "x", failed: "y" }; // border-green-500 rounded-full\n',
    );
    const files = collectSources(root).map((f) => f.rel);
    expect(files).not.toContain('components/rogue.test.tsx');
    expect(files.some((f) => f.startsWith('.next/'))).toBe(false);
    expect(auditSeams(root).result).toBe('PASS');
  });
});

describe('rule: one status-pill vocabulary', () => {
  it('catches a component that maps the state names onto its own colours', () => {
    const rogue = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-rogue-'));
    mkdirSync(path.join(rogue, 'components'), { recursive: true });
    writeFileSync(path.join(rogue, 'components', 'status-pill.tsx'), GOOD_PILL, 'utf-8');
    writeFileSync(
      path.join(rogue, 'components', 'my-badge.tsx'),
      `const STYLES = {
  passed: "border-green-500/50 text-green-500",
  failed: "border-red-500/50 text-red-500",
};
export function MyBadge({ status }) { return <span className={STYLES[status]} />; }
`,
      'utf-8',
    );
    const report = ruleOnePillVocabulary(collectSources(rogue));
    expect(report.status).toBe('fail');
    expect(report.violations[0]!.file).toBe('components/my-badge.tsx');
    expect(report.violations[0]!.detail).toContain('passed, failed');
    rmSync(rogue, { recursive: true, force: true });
  });

  it('does not flag a file that names states but paints nothing', () => {
    const plain = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-plain-'));
    mkdirSync(path.join(plain, 'components'), { recursive: true });
    writeFileSync(path.join(plain, 'components', 'status-pill.tsx'), GOOD_PILL, 'utf-8');
    writeFileSync(
      path.join(plain, 'lib.ts'),
      'export const ORDER = ["queued", "running", "passed", "failed"];\n',
      'utf-8',
    );
    expect(ruleOnePillVocabulary(collectSources(plain)).status).toBe('pass');
    rmSync(plain, { recursive: true, force: true });
  });
});

describe('rule: one shimmer primitive', () => {
  it('fails when the shimmer is defined in more than one place', () => {
    const many = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-shimmer-'));
    mkdirSync(path.join(many, 'app'), { recursive: true });
    mkdirSync(path.join(many, 'components'), { recursive: true });
    writeFileSync(
      path.join(many, 'app', 'globals.css'),
      '@keyframes shimmer {\n  0% { background-position: -200% 0; }\n}\n.animate-shimmer {\n  animation: shimmer 2s;\n}\n',
      'utf-8',
    );
    writeFileSync(
      path.join(many, 'components', 'skeletons.tsx'),
      'function Shimmer({ className }) { return <div className="animate-pulse" />; }\n',
      'utf-8',
    );
    const report = ruleOneShimmerPrimitive(collectSources(many));
    expect(report.status).toBe('fail');
    // The keyframes and the class that drives them are ONE site, not two.
    expect(report.violations).toHaveLength(2);
    rmSync(many, { recursive: true, force: true });
  });
});

describe('rule: a green check needs a verdict link', () => {
  it('fails when the pill loses its downgrade', () => {
    const broken = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-nodowngrade-'));
    mkdirSync(path.join(broken, 'components'), { recursive: true });
    writeFileSync(
      path.join(broken, 'components', 'status-pill.tsx'),
      GOOD_PILL.replace(
        'const unbacked = status === "passed" && !verdictHref;',
        'const unbacked = false;',
      ),
      'utf-8',
    );
    const report = ruleGreenCheckNeedsVerdict(collectSources(broken));
    expect(report.status).toBe('fail');
    expect(report.violations[0]!.detail).toContain('downgrade');
    rmSync(broken, { recursive: true, force: true });
  });

  it('catches a green check drawn from verification data elsewhere', () => {
    const rogue = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-check-'));
    mkdirSync(path.join(rogue, 'components'), { recursive: true });
    writeFileSync(path.join(rogue, 'components', 'status-pill.tsx'), GOOD_PILL, 'utf-8');
    writeFileSync(
      path.join(rogue, 'components', 'report.tsx'),
      `import { CheckCircle2 } from "lucide-react";
import type { VerificationVerdict } from "@ligma/api";
export function Report({ verdict }: { verdict: VerificationVerdict }) {
  return <CheckCircle2 className="h-4 w-4 text-green-500" />;
}
`,
      'utf-8',
    );
    const report = ruleGreenCheckNeedsVerdict(collectSources(rogue));
    expect(report.status).toBe('fail');
    expect(report.violations[0]!.file).toBe('components/report.tsx');
    expect(report.violations[0]!.line).toBe(4);
    rmSync(rogue, { recursive: true, force: true });
  });

  it('does not flag a green check in a file that holds no verification data', () => {
    const fine = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-decor-'));
    mkdirSync(path.join(fine, 'components'), { recursive: true });
    writeFileSync(path.join(fine, 'components', 'status-pill.tsx'), GOOD_PILL, 'utf-8');
    writeFileSync(
      path.join(fine, 'components', 'empty-state.tsx'),
      'import { CheckCircle2 } from "lucide-react";\nexport const Empty = () => <CheckCircle2 className="text-green-500" />;\n',
      'utf-8',
    );
    expect(ruleGreenCheckNeedsVerdict(collectSources(fine)).status).toBe('pass');
    rmSync(fine, { recursive: true, force: true });
  });
});

describe('rule: error is not styled like failed', () => {
  it("reads each state's className out of the pill", () => {
    expect(stateClassName(GOOD_PILL, 'failed')).toBe('border-destructive/60 text-destructive');
    expect(stateClassName(GOOD_PILL, 'error')).toBe('border-amber-600/60 text-amber-700');
    expect(stateClassName(GOOD_PILL, 'nonexistent')).toBeNull();
  });

  it('fails when a harness error is dressed as a product defect', () => {
    const same = mkdtempSync(path.join(os.tmpdir(), 'ligma-seam-samestyle-'));
    mkdirSync(path.join(same, 'components'), { recursive: true });
    writeFileSync(
      path.join(same, 'components', 'status-pill.tsx'),
      GOOD_PILL.replace(
        'error: { label: "Error", className: "border-amber-600/60 text-amber-700", icon: OctagonAlert }',
        'error: { label: "Error", className: "border-destructive/60 text-destructive", icon: XCircle }',
      ),
      'utf-8',
    );
    const report = ruleErrorDistinctFromFailed(collectSources(same));
    expect(report.status).toBe('fail');
    expect(report.violations[0]!.detail).toContain('share one style');
    rmSync(same, { recursive: true, force: true });
  });
});
