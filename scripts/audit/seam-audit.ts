#!/usr/bin/env -S npx tsx
/**
 * Seam audit (build brief D5, second half): a STATIC component audit of
 * `apps/web/src`. No browser, no daemon, no LLM — it reads source, so it is
 * cheap enough to run on every change and impossible to argue with.
 *
 * The four rules, all from the brief and the UX spec's seam principles:
 *
 *   1. ONE status-pill vocabulary. Verification and execution states are drawn
 *      by `components/status-pill.tsx` and nowhere else. A component that maps
 *      two or more of those state names onto its own colours is a second
 *      vocabulary, and two vocabularies drift.
 *   2. ONE shimmer primitive. A loading shimmer defined in more than one place
 *      is a shimmer that looks different in different rooms.
 *   3. NO green check without a verdict link. The pill must still carry its
 *      downgrade (a `passed` with nothing to link to is drawn honestly, not as
 *      proof), and no other component may draw a green check straight from
 *      verification data.
 *   4. `error` is styled DISTINCTLY from `failed`. A harness malfunction is not
 *      a product defect, and the pixels must not say it is.
 *
 * Output: a JSON report on stdout, a human summary on stderr, exit 1 on any
 * violation. Findings are reported, never fixed: this script does not edit the
 * app it audits.
 *
 * Run: `npx tsx scripts/audit/seam-audit.ts [--root <dir>]`
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ─── What counts as the vocabulary ───────────────────────────────────────────

/**
 * The state names the pill owns. Two or more of these, quoted, in a file that
 * also paints a pill, is a second implementation of the vocabulary.
 */
const VOCABULARY = [
  "unverified",
  "in-review",
  "passed",
  "failed",
  "waived",
  "not-met",
  "not-tested",
  "queued",
  "running",
  "deferred",
  "awaiting-verification",
];

/** Class fragments that mean "this file is painting a pill/badge/chip". */
const PILL_PAINT = [
  "rounded-full",
  "border-green-",
  "border-red-",
  "border-amber-",
  "border-blue-",
  "border-destructive",
  "text-destructive",
  "text-green-",
  "text-emerald-",
  "bg-green-",
  "bg-amber-",
];

/** Imports/props that mean "this file is holding verification data". */
const VERIFICATION_DATA = [
  "VerificationStatus",
  "VerificationVerdict",
  "VerificationRun",
  "CriterionVerdict",
  "verificationStatus",
  "criterionResults",
  "verdict.outcome",
  "VerdictOutcome",
];

/** A green check, however it is drawn. */
const GREEN_CHECK = ["text-green-", "text-emerald-"];
const CHECK_ICONS = ["CheckCircle2", "CheckCircle", "Check2", "<Check "];

/**
 * Argued exemptions. Each one is a claim this audit is making, so each one
 * carries its reason in the report rather than living in a silent ignore list.
 */
const EXEMPT: Record<string, string> = {
  "components/status-pill.tsx": "the canonical implementation — this IS the vocabulary",
  "components/run-status-badge.tsx": "a wrapper: maps run status onto ExecutionPill and paints nothing itself",
  "components/run-row.tsx":
    "status words are comparison logic (elapsed display, stoppable, sort) and status paint goes through RunStatusBadge; the one styled line is the destructive Interrupt action button, not a pill",
  "lib/kanban.ts": "the single source of kanban labels/dots, deliberately data-only",
  "components/failure/classify.ts": "failure-class vocabulary (UX spec §7), not a pill",
  "components/failure/failure-card.tsx": "failure-class vocabulary (UX spec §7), one error model",
};

// ─── Source scanning ─────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "playwright-report", "coverage", "dist"]);

interface SourceFile {
  /** Path relative to the scanned root, posix-style. */
  rel: string;
  abs: string;
  lines: string[];
  text: string;
}

export function collectSources(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.(tsx?|css)$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const text = readFileSync(abs, "utf-8");
      out.push({
        abs,
        rel: path.relative(root, abs).split(path.sep).join("/"),
        text,
        lines: text.split("\n"),
      });
    }
  };
  walk(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Lines carrying any of these fragments — one hit per line, not per needle. */
function hits(file: SourceFile, needles: string[]): { line: number; text: string; needle: string }[] {
  const out: { line: number; text: string; needle: string }[] = [];
  file.lines.forEach((text, i) => {
    const needle = needles.find((n) => text.includes(n));
    if (needle) out.push({ line: i + 1, text: text.trim().slice(0, 160), needle });
  });
  return out;
}

/**
 * The state names a file speaks: as a quoted literal (`case "passed"`), or as a
 * key in a state table (`passed: { … }`) — the shape a rogue pill almost always
 * takes, and the one a quoted-literal-only scan walks straight past.
 */
function vocabularyOf(file: SourceFile): string[] {
  return VOCABULARY.filter(
    (state) =>
      file.text.includes(`"${state}"`) ||
      file.text.includes(`'${state}'`) ||
      new RegExp(`(^|[{,(\\s])"?${state}"?\\s*:`, "m").test(file.text),
  );
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export interface Violation {
  file: string;
  line: number | null;
  detail: string;
}

export interface RuleReport {
  id: string;
  description: string;
  status: "pass" | "fail";
  violations: Violation[];
  /** Anything the rule wants on the record even when it passes. */
  notes: string[];
}

/** Rule 1 — exactly one status-pill vocabulary implementation. */
export function ruleOnePillVocabulary(files: SourceFile[]): RuleReport {
  const violations: Violation[] = [];
  const notes: string[] = [];
  const canonical = files.find((f) => f.rel === "components/status-pill.tsx");
  if (!canonical) {
    violations.push({ file: "components/status-pill.tsx", line: null, detail: "the canonical status pill does not exist" });
  }

  for (const file of files) {
    if (EXEMPT[file.rel]) continue;
    if (file.rel.endsWith(".css")) continue;
    const vocabulary = vocabularyOf(file);
    if (vocabulary.length < 2) continue;
    const paint = hits(file, PILL_PAINT);
    if (paint.length === 0) continue;
    violations.push({
      file: file.rel,
      line: paint[0]!.line,
      detail:
        `speaks the pill vocabulary (${vocabulary.join(", ")}) and paints it itself ` +
        `(${paint.length} styling line(s), first: ${paint[0]!.needle}) — status-pill.tsx is the only place that may`,
    });
  }

  for (const [rel, reason] of Object.entries(EXEMPT)) notes.push(`exempt: ${rel} — ${reason}`);
  return {
    id: "one-status-pill-vocabulary",
    description: "Verification/execution states are drawn by components/status-pill.tsx and nowhere else",
    status: violations.length === 0 ? "pass" : "fail",
    violations,
    notes,
  };
}

/** Rule 2 — exactly one shimmer primitive definition site. */
export function ruleOneShimmerPrimitive(files: SourceFile[]): RuleReport {
  // One site per file per kind: a `@keyframes shimmer` and the `.animate-shimmer`
  // class that drives it are one primitive written in two lines, not two.
  const seen = new Set<string>();
  const definitions: Violation[] = [];
  for (const file of files) {
    file.lines.forEach((text, i) => {
      const isCssDefinition = /@keyframes\s+shimmer\b/.test(text) || /^\s*\.animate-shimmer\s*\{/.test(text);
      const isComponentDefinition =
        /\b(function|const)\s+(Shimmer|Skeleton)\b/.test(text) && !/import\s/.test(text);
      if (!isCssDefinition && !isComponentDefinition) return;
      const key = `${file.rel}#${isCssDefinition ? "css" : "component"}`;
      if (seen.has(key)) return;
      seen.add(key);
      definitions.push({ file: file.rel, line: i + 1, detail: text.trim().slice(0, 160) });
    });
  }
  return {
    id: "one-shimmer-primitive",
    description: "The loading shimmer is defined exactly once",
    status: definitions.length === 1 ? "pass" : "fail",
    violations:
      definitions.length === 1
        ? []
        : definitions.map((d) => ({ ...d, detail: `shimmer/skeleton definition site ${definitions.length} found: ${d.detail}` })),
    notes: [`${definitions.length} definition site(s) found`],
  };
}

/** Rule 3 — no green check without a verdict link. */
export function ruleGreenCheckNeedsVerdict(files: SourceFile[]): RuleReport {
  const violations: Violation[] = [];
  const notes: string[] = [];

  // 3a. The downgrade must still exist where the vocabulary lives.
  const pill = files.find((f) => f.rel === "components/status-pill.tsx");
  if (!pill) {
    violations.push({ file: "components/status-pill.tsx", line: null, detail: "missing — the rule has nowhere to live" });
  } else {
    const downgrades = /status\s*===\s*"passed"\s*&&\s*!verdictHref/.test(pill.text);
    const gatesTheLink = /if\s*\(!verdictHref/.test(pill.text);
    if (!downgrades) {
      violations.push({
        file: pill.rel,
        line: null,
        detail: "VerificationPill no longer downgrades a `passed` with no verdictHref — a green check can render unbacked",
      });
    }
    if (!gatesTheLink) {
      violations.push({
        file: pill.rel,
        line: null,
        detail: "VerificationPill no longer gates its link on verdictHref",
      });
    }
    if (downgrades && gatesTheLink) notes.push("VerificationPill downgrades an unbacked `passed` and gates its link");
  }

  // 3b. Nobody else may draw a green check out of verification data.
  for (const file of files) {
    if (file.rel === "components/status-pill.tsx" || file.rel.endsWith(".css")) continue;
    if (!VERIFICATION_DATA.some((needle) => file.text.includes(needle))) continue;
    for (const hit of hits(file, CHECK_ICONS)) {
      if (!GREEN_CHECK.some((green) => hit.text.includes(green))) continue;
      violations.push({
        file: file.rel,
        line: hit.line,
        detail: `renders a green check from verification data outside the pill: ${hit.text}`,
      });
    }
  }

  return {
    id: "green-check-needs-verdict-link",
    description: "A green check never renders without a verdict to link to (UX spec §8.8)",
    status: violations.length === 0 ? "pass" : "fail",
    violations,
    notes,
  };
}

/** The `className` string of one entry in the pill's state table. */
export function stateClassName(source: string, state: string): string | null {
  // `error: { label: …, className: "…" }` — the first className after the key.
  const key = new RegExp(`(^|\\s)"?${state}"?\\s*:\\s*\\{`, "m");
  const start = source.search(key);
  if (start < 0) return null;
  const after = source.slice(start, start + 600);
  const match = after.match(/className:\s*"([^"]+)"/);
  return match ? match[1]! : null;
}

/** Rule 4 — `error` is styled distinctly from `failed`. */
export function ruleErrorDistinctFromFailed(files: SourceFile[]): RuleReport {
  const pill = files.find((f) => f.rel === "components/status-pill.tsx");
  if (!pill) {
    return {
      id: "error-distinct-from-failed",
      description: "`error` (harness malfunction) is not styled like `failed` (product defect)",
      status: "fail",
      violations: [{ file: "components/status-pill.tsx", line: null, detail: "missing" }],
      notes: [],
    };
  }
  const failed = stateClassName(pill.text, "failed");
  const error = stateClassName(pill.text, "error");
  const violations: Violation[] = [];
  if (!failed) violations.push({ file: pill.rel, line: null, detail: "no `failed` entry with a className" });
  if (!error) violations.push({ file: pill.rel, line: null, detail: "no `error` entry with a className" });
  if (failed && error && failed === error) {
    violations.push({ file: pill.rel, line: null, detail: `\`error\` and \`failed\` share one style: "${failed}"` });
  }
  return {
    id: "error-distinct-from-failed",
    description: "`error` (harness malfunction) is not styled like `failed` (product defect)",
    status: violations.length === 0 ? "pass" : "fail",
    violations,
    notes: failed && error ? [`failed: "${failed}"`, `error: "${error}"`] : [],
  };
}

export function auditSeams(root: string): { root: string; rules: RuleReport[]; result: "PASS" | "FAIL"; filesScanned: number } {
  const files = collectSources(root);
  const rules = [
    ruleOnePillVocabulary(files),
    ruleOneShimmerPrimitive(files),
    ruleGreenCheckNeedsVerdict(files),
    ruleErrorDistinctFromFailed(files),
  ];
  return {
    root,
    filesScanned: files.length,
    rules,
    result: rules.every((r) => r.status === "pass") ? "PASS" : "FAIL",
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const root = path.resolve(rootFlag >= 0 ? argv[rootFlag + 1]! : path.join(repoRoot, "apps", "web", "src"));

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`[seam-audit] not a directory: ${root}`);
    process.exit(1);
  }

  const report = auditSeams(root);
  console.log(JSON.stringify(report, null, 2));

  console.error(`\n[seam-audit] ${report.filesScanned} files under ${report.root}`);
  for (const rule of report.rules) {
    console.error(`  ${rule.status === "pass" ? "PASS" : "FAIL"}  ${rule.id} — ${rule.description}`);
    for (const violation of rule.violations) {
      console.error(`        ${violation.file}${violation.line ? `:${violation.line}` : ""} — ${violation.detail}`);
    }
  }
  console.error(`[seam-audit] ${report.result}\n`);
  process.exit(report.result === "PASS" ? 0 : 1);
}
