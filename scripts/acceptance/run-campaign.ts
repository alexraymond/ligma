/**
 * run-campaign.ts — execute one D-chain (or all seven) and write its manifest.
 *
 *   tsx scripts/acceptance/run-campaign.ts d1 [--stub] [--out DIR] [--project ID]
 *   tsx scripts/acceptance/run-campaign.ts all --stub
 *
 * A chain is a sequence of links (`chains.ts`). This file is the only thing that
 * executes them, and it has exactly one job beyond that: refuse to call a chain
 * green on any link it could not prove.
 *
 * Rules it enforces, in code rather than in prose:
 *   - Evidence is COPIED, never written: nothing here generates, regenerates,
 *     edits or "repairs" a verdict, a run record or a baseline. A copy that is
 *     not byte-identical to its source throws.
 *   - Every verdict imported out of the booted instance is verified — Ed25519
 *     signature AND the signing key must be that instance's own. A file that
 *     fails verification fails the link; it is still copied to a `.rejected`
 *     path so the failure is inspectable, and never counted as evidence.
 *   - A monitor that runs out of time is `error`, not `failed`: "we did not see
 *     it happen" is not "the product is broken" (D3 rule, principle 12).
 *   - The first link that is not green stops the chain. Everything after it is
 *     `skipped`, because a link that never ran is not a link that passed.
 *   - In `--stub` mode a link whose machinery ran but whose outcome came from a
 *     stubbed model is `rehearsed`, never green. A rehearsal proves the wiring;
 *     it is not evidence about the product and is never recorded as if it were.
 */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { AcceptanceContract, HarnessSignature, PersonaReport, VerificationVerdict } from "../../packages/api/src/harness";
import { loadConfig } from "../../apps/daemon/src/engine/config";
import { runJudge } from "../../apps/daemon/src/harness/judge";
import { panelRoster, panelTransports, startPanelBridge } from "../../apps/daemon/src/harness/panel";
import { runPersona } from "../../apps/daemon/src/harness/personas";
import { runJourney } from "../../apps/daemon/src/harness/run-journey";
import { sign, verify } from "../../apps/daemon/src/harness/signing";
import { RUNS_DIR } from "../../apps/daemon/src/harness/verdict";
import { CENTRAL_PROJECTS_DIR, DATA_DIR, REPO_ROOT, dataRootInfo } from "../../apps/daemon/src/paths";
import { getProjects, saveProjects } from "../../apps/daemon/src/store/data";
import { readJourney } from "../../apps/daemon/src/store/ligma-dir";
import { EMPTY_STORES, bootLigma, bootedPublicKey, tailLog, type BootedLigma } from "./booted-ligma";
import {
  CHAINS,
  chainById,
  needsBootedInstance,
  type AuditScriptLink,
  type Chain,
  type EvidenceExportLink,
  type InterludeMonitorLink,
  type JourneyRunLink,
  type Link,
} from "./chains";

// ─── Manifest shapes ─────────────────────────────────────────────────────────

/**
 * `green`     — the link proved what it claims.
 * `rehearsed` — its machinery ran with the model layer stubbed. Not evidence.
 * `failed`    — the product did not do what the link required.
 * `error`     — the harness could not tell (timeout, crash, nothing to export).
 * `skipped`   — an earlier link stopped the chain.
 */
export type LinkStatus = "green" | "rehearsed" | "failed" | "error" | "skipped";

export interface LinkOutcome {
  status: LinkStatus;
  detail: string;
  /** Absolute paths this link produced or imported. */
  evidence: string[];
  /** How many Ed25519 signatures this link verified against the booted key. */
  signaturesVerified: number;
}

export interface LinkResult extends LinkOutcome {
  id: string;
  kind: Link["kind"];
  description: string;
  startedAt: string;
  finishedAt: string;
}

export interface ChainManifest {
  chainId: string;
  title: string;
  brief: string;
  mode: "live" | "stub";
  result: "green" | "rehearsed" | "red";
  bootedInstance: { envId: string; url: string; daemonUrl: string; dataDir: string; publicKey: string | null } | null;
  /**
   * Stub mode only: the links a rehearsal cannot prove, and why. A rehearsal
   * that quietly dropped these would be claiming more than it ran.
   */
  unrehearsable?: { id: string; kind: Link["kind"]; reason: string }[];
  links: LinkResult[];
  startedAt: string;
  finishedAt: string;
}

export interface CampaignOptions {
  mode: "live" | "stub";
  /** Where chain manifests and imported evidence land. */
  outDir: string;
  /** The ligma project (in THIS checkout's data dir) the journeys belong to. */
  projectId: string;
  /** Cap every interlude at this instead of its own timeout (rehearsal). */
  interludeTimeoutMs?: number;
  /** Two persona spawns instead of six. */
  smoke: boolean;
  keepData: boolean;
  /**
   * Rehearsal only: keep going after a link that is not green, so every link
   * kind gets exercised. It changes nothing about how a chain is scored — the
   * chain is still red — it only stops the rehearsal from ending at link one.
   */
  continueAfterRed?: boolean;
}

// ─── Small, testable pieces ──────────────────────────────────────────────────

/** True when ONE item carries every field of ONE of the accepted shapes. */
export function matchesAnyOf(items: unknown[], anyOf: Record<string, string>[]): boolean {
  return items.some((item) => {
    if (item === null || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return anyOf.some((shape) => Object.entries(shape).every(([key, value]) => record[key] === value));
  });
}

export interface SignatureCheck {
  ok: boolean;
  reason: string;
}

/**
 * Verify one signed artifact on import.
 *
 * Two independent checks, both required: the Ed25519 signature must match the
 * payload (nothing was edited after signing), and the signing key must be the
 * booted instance's own (this is that instance's evidence, not some other
 * machine's). Either failing fails the link.
 */
export function verifySignedFile(file: string, expectedPublicKey: string | null): SignatureCheck {
  let parsed: (Record<string, unknown> & { signature?: HarnessSignature | null }) | null;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8")) as typeof parsed;
  } catch (err) {
    return { ok: false, reason: `unreadable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed === null || typeof parsed !== "object") return { ok: false, reason: "not a JSON object" };

  const { signature, ...payload } = parsed;
  if (!signature) return { ok: false, reason: "unsigned — a verdict with no signature is not evidence" };
  if (expectedPublicKey === null) {
    return { ok: false, reason: "the booted instance has no signing key on disk — nothing can be attributed to it" };
  }
  if (signature.publicKey !== expectedPublicKey) {
    return { ok: false, reason: "signed by a different key than the booted instance's" };
  }
  if (!verify(payload, signature)) return { ok: false, reason: "Ed25519 verification failed — content changed after signing" };
  return { ok: true, reason: "signature verified against the booted instance's key" };
}

/**
 * Copy a file and prove the copy is the original. The campaign's whole value is
 * that the bytes Alex reads are the bytes the harness signed.
 */
export function copyVerbatim(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  const before = readFileSync(from);
  const after = readFileSync(to);
  if (!before.equals(after)) throw new Error(`copy is not verbatim: ${from} → ${to}`);
}

/** Every file under a directory, recursively, as absolute paths. */
function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Copy a whole directory verbatim; returns the destination paths. */
export function copyTreeVerbatim(from: string, to: string): string[] {
  return walkFiles(from).map((file) => {
    const dest = path.join(to, path.relative(from, file));
    copyVerbatim(file, dest);
    return dest;
  });
}

// ─── Link: interlude monitor ─────────────────────────────────────────────────

export interface InterludeDeps {
  /** Fetch the collection named by the link. Throwing is a harness error. */
  fetchCollection(link: InterludeMonitorLink): Promise<unknown[]>;
  /** Overrides the link's own timeout (rehearsal caps this). */
  timeoutMs?: number;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

export async function runInterludeLink(link: InterludeMonitorLink, deps: InterludeDeps): Promise<LinkOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? link.timeoutMs;
  const deadline = now() + timeoutMs;
  let polls = 0;
  let lastError: string | null = null;

  while (now() <= deadline) {
    polls += 1;
    try {
      const items = await deps.fetchCollection(link);
      if (matchesAnyOf(items, link.anyOf)) {
        return {
          status: "green",
          detail: `condition met after ${polls} poll(s) of ${link.path}`,
          evidence: [],
          signaturesVerified: 0,
        };
      }
      lastError = null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (now() + link.pollMs > deadline) break;
    await sleep(link.pollMs);
  }

  // Never "failed": not seeing it happen is not the same as it going wrong.
  return {
    status: "error",
    detail:
      `timed out after ${Math.round(timeoutMs / 1000)}s and ${polls} poll(s) of ${link.path} ` +
      `without ${JSON.stringify(link.anyOf)}${lastError ? ` (last fetch error: ${lastError})` : ""}`,
    evidence: [],
    signaturesVerified: 0,
  };
}

// ─── Link: evidence export ───────────────────────────────────────────────────

export interface ExportDeps {
  /** The booted instance's throwaway data dir. */
  bootedDataDir: string;
  /** That instance's Ed25519 public key, or null if it never signed anything. */
  publicKey: string | null;
  /** <outDir>/<chainId> — the human-readable half of the locker. */
  chainOutDir: string;
  /** The dev-side locker root for imported evidence. */
  lockerDir: string;
  /** For `campaign-manifests`: where earlier chain manifests were written. */
  outDir: string;
}

/** Run dirs the booted instance produced, oldest first. */
function bootedRunDirs(dataDir: string): string[] {
  const root = path.join(dataDir, "verification-runs");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(path.join(dir, "run.json")))
    .sort();
}

/** Central baselines the booted instance recorded, per project. */
function bootedBaselineFiles(dataDir: string): string[] {
  const root = path.join(dataDir, "projects");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .flatMap((projectId) => walkFiles(path.join(root, projectId, "baselines")))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

export function runEvidenceExportLink(link: EvidenceExportLink, deps: ExportDeps): LinkOutcome {
  const evidence: string[] = [];
  const problems: string[] = [];
  let signaturesVerified = 0;

  if (link.source === "campaign-manifests") {
    for (const chainId of link.requireChains ?? []) {
      const file = path.join(deps.outDir, chainId, "manifest.json");
      if (!existsSync(file)) {
        problems.push(`${chainId}: no manifest at ${file} — that chain has not been run`);
        continue;
      }
      const manifest = JSON.parse(readFileSync(file, "utf-8")) as ChainManifest;
      if (manifest.result !== "green") {
        problems.push(`${chainId}: manifest result is "${manifest.result}" — a matrix cell cannot cite it`);
        continue;
      }
      const dest = path.join(deps.chainOutDir, "inputs", `${chainId}.json`);
      copyVerbatim(file, dest);
      evidence.push(dest);
    }
  } else if (link.source === "booted-runs") {
    for (const runDir of bootedRunDirs(deps.bootedDataDir)) {
      const runId = path.basename(runDir);
      const verdictFile = path.join(runDir, "verdict.json");
      if (existsSync(verdictFile)) {
        const check = verifySignedFile(verdictFile, deps.publicKey);
        if (!check.ok) {
          // Kept, quarantined, and never counted: the failure must be lookable-at.
          const rejected = path.join(deps.chainOutDir, "rejected", runId, "verdict.json");
          copyVerbatim(verdictFile, rejected);
          problems.push(`${runId}/verdict.json: ${check.reason} (kept at ${rejected})`);
          continue;
        }
        signaturesVerified += 1;
      } else {
        problems.push(`${runId}: run record with no verdict — nothing was decided, so nothing is proved`);
        continue;
      }
      evidence.push(...copyTreeVerbatim(runDir, path.join(deps.chainOutDir, "runs", runId)));
      copyTreeVerbatim(runDir, path.join(deps.lockerDir, "runs", runId));
    }
  } else {
    for (const file of bootedBaselineFiles(deps.bootedDataDir)) {
      const rel = path.relative(path.join(deps.bootedDataDir, "projects"), file);
      const dest = path.join(deps.chainOutDir, "baselines", rel);
      copyVerbatim(file, dest);
      copyVerbatim(file, path.join(deps.lockerDir, "baselines", rel));
      evidence.push(dest);
    }
  }

  if (problems.length > 0) {
    return {
      status: "failed",
      detail: `${problems.length} artifact(s) could not be imported: ${problems.join("; ")}`,
      evidence,
      signaturesVerified,
    };
  }
  if (evidence.length < link.minArtifacts) {
    return {
      status: "error",
      detail: `expected at least ${link.minArtifacts} artifact(s) from ${link.source}, found ${evidence.length} — nothing to export`,
      evidence,
      signaturesVerified,
    };
  }
  return {
    status: "green",
    detail: `exported ${evidence.length} file(s) from ${link.source}; ${signaturesVerified} signature(s) verified`,
    evidence,
    signaturesVerified,
  };
}

// ─── Link: audit script ──────────────────────────────────────────────────────

export interface AuditDeps {
  /** Runs the script; resolves with its exit code and captured stdout. */
  run(link: AuditScriptLink): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  chainOutDir: string;
}

/**
 * The JSON report an audit printed, or null. Whole-stdout first; failing that,
 * the outermost `{…}` block — which is what is left when a child process wrote
 * its own banner onto the same stream.
 */
export function extractJsonReport(stdout: string): string | null {
  const parses = (text: string): boolean => {
    try {
      return typeof JSON.parse(text) === "object";
    } catch {
      return false;
    }
  };
  const trimmed = stdout.trim();
  if (parses(trimmed)) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const block = trimmed.slice(start, end + 1);
  return parses(block) ? block : null;
}

export async function runAuditLink(link: AuditScriptLink, deps: AuditDeps): Promise<LinkOutcome> {
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await deps.run(link);
  } catch (err) {
    return {
      status: "error",
      detail: `${link.script} could not be run: ${err instanceof Error ? err.message : String(err)}`,
      evidence: [],
      signaturesVerified: 0,
    };
  }
  const dir = path.join(deps.chainOutDir, "audits");
  mkdirSync(dir, { recursive: true });
  // Raw first, always: whatever the audit printed is the record, banner and all.
  const raw = path.join(dir, `${link.id}.stdout.txt`);
  writeFileSync(raw, result.stdout, "utf-8");
  const log = path.join(dir, `${link.id}.log`);
  writeFileSync(log, result.stderr, "utf-8");
  const evidence = [raw, log];

  // An audit that starts servers of its own gets their banners mixed into its
  // stdout (nav-crawl does), so the report is extracted rather than assumed.
  // Failing to extract it is worth saying out loud, not worth failing a link
  // whose own exit code already answered the question.
  const report = extractJsonReport(result.stdout);
  if (report !== null) {
    const file = path.join(dir, `${link.id}.json`);
    writeFileSync(file, `${report}\n`, "utf-8");
    evidence.push(file);
  }

  return {
    status: result.exitCode === 0 ? "green" : "failed",
    detail: `${link.script} exited ${result.exitCode}${report === null ? " (no JSON report on stdout)" : ""}`,
    evidence,
    signaturesVerified: 0,
  };
}

/**
 * Run an audit script and settle when THAT script exits.
 *
 * Deliberately not `execFile`: an audit that starts servers of its own (the nav
 * crawl starts a daemon and a web server with inherited stdio) leaves those
 * children holding the pipes open, and execFile waits for the pipes, not the
 * process — so a finished crawl looked like a hung one until the link timed
 * out. Settling on `exit` and then killing the whole process group fixes both
 * halves: the campaign moves on, and the audit's servers do not leak.
 */
function spawnAudit(link: AuditScriptLink): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", link.script, ...link.args], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    const reap = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // Group already gone.
      }
    };
    const timer = setTimeout(() => {
      reap();
      reject(new Error(`${link.script} did not finish within ${Math.round(link.timeoutMs / 1000)}s`));
    }, link.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      // Anything the audit spawned and did not clean up dies with the group.
      setTimeout(reap, 500);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

// ─── Link: journey run ───────────────────────────────────────────────────────

/**
 * The panel, pointed at an ALREADY booted instance.
 *
 * `run-journey` normally creates the env itself; here the env is the campaign's
 * booted ligma, shared by every link in the chain, so the run is handed its URL
 * through the documented stub seam and everything downstream — contract,
 * bridges, personas, judge, signing, baseline — is the real pipeline.
 */
function livePanel(
  booted: BootedLigma,
  journeyTags: string[],
  goal: string,
  smoke: boolean,
): (runDir: string, contract: AcceptanceContract) => Promise<PersonaReport[]> {
  return async (runDir, contract) => {
    const config = loadConfig();
    // The instance under test is ligma itself — a UI product — and every
    // campaign journey tags its own surface anyway, which beats the shape.
    const transports = panelTransports("ui", journeyTags, true);
    // One naive user: the load-bearing charters (spec-auditor, saboteur) carry
    // the verdict; naive-user repeats are corroboration a campaign pays for at
    // full spawn price. The wider default panel remains for product verification.
    const roster = panelRoster(transports, { smoke, naiveRuns: 1, kind: "journey" });
    const bridges = [];
    const sessions = new Map<string, string>();
    const reports: PersonaReport[] = [];
    try {
      for (const transport of transports) {
        const bridge = await startPanelBridge(transport, {
          runDir,
          productUrl: booted.url,
          worktreePath: booted.worktreePath,
          appDir: "apps/web",
        });
        bridges.push(bridge);
        for (const spec of roster.filter((s) => (s.transport ?? "browser") === transport)) {
          sessions.set(spec.name, (await bridge.session(spec.name)).url);
        }
      }
      for (const spec of roster) {
        reports.push(
          await runPersona({
            spec,
            runId: path.basename(runDir),
            runDir,
            bridgeUrl: sessions.get(spec.name)!,
            productUrl: booted.url,
            contract,
            goal,
            maxTurns: config.execution.maxTurns,
            timeoutMinutes: config.execution.timeoutMinutes,
          }),
        );
      }
    } finally {
      for (const bridge of bridges) await bridge.close().catch(() => undefined);
    }
    return reports;
  };
}

/**
 * The rehearsal panel: no model, and it says so in every field it fills.
 *
 * It still proves the half of the link that does not need a model — that the
 * booted instance answers on its URL, that the run dir, the contract, the
 * report files, the verdict signing and the baseline write all happen — and it
 * reports every criterion as `not-tested`, because nothing was tested.
 */
function stubPanel(booted: BootedLigma): (runDir: string, contract: AcceptanceContract) => Promise<PersonaReport[]> {
  return async (runDir, contract) => {
    const started = Date.now();
    const res = await fetch(booted.url, { signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    const recordDir = path.join(runDir, "personas", "spec-auditor", "records");
    mkdirSync(recordDir, { recursive: true });
    const record = path.join(recordDir, "home.json");
    writeFileSync(
      record,
      JSON.stringify(
        { method: "GET", url: booted.url, status: res.status, schema: "text/html", bytes: body.length },
        null,
        2,
      ),
      "utf-8",
    );
    if (res.status !== 200) throw new Error(`booted instance answered ${res.status} at ${booted.url}`);

    return [
      {
        charter: "spec-auditor",
        runId: path.basename(runDir),
        personaSeed: null,
        goalAchieved: null,
        stepCount: 1,
        wrongTurns: 0,
        elapsedMs: Date.now() - started,
        findings: [],
        criterionResults: contract.criteria.map((c) => ({
          criterionId: c.id,
          status: "not-tested" as const,
          evidence: ["personas/spec-auditor/records/home.json"],
        })),
        transcriptPath: "personas/spec-auditor/transcript.jsonl",
        invalid: false,
      },
    ];
  };
}

/**
 * The rehearsal judge. It never says "passed": with no persona behind the
 * criteria there is nothing to pass, so it returns the harness's own honest
 * outcome — `error` — signed exactly the way a real verdict is signed, so the
 * signing and export paths are the real ones.
 */
function stubJudge(): (contract: AcceptanceContract, reports: PersonaReport[], runDir: string) => Promise<VerificationVerdict> {
  return async (contract, _reports, runDir) => {
    const payload = {
      runId: path.basename(runDir),
      taskId: null,
      contractId: contract.id,
      contractVersion: contract.version,
      outcome: "error" as const,
      criterionVerdicts: contract.criteria.map((c) => ({
        criterionId: c.id,
        // "unknown" is the harness's own word for "the evidence does not say",
        // and it counts as NOT passed — exactly what a rehearsal knows.
        status: "unknown" as const,
        reasoning: "LIGMA campaign rehearsal: no judge model ran, so nothing was assessed.",
        evidence: [] as string[],
      })),
      humanDecisions: [],
      judgeModel: "campaign-rehearsal-stub",
      causeKind: "harness" as const,
      createdAt: new Date().toISOString(),
    };
    return { ...payload, signature: sign(payload) };
  };
}

function liveJudge(): (
  contract: AcceptanceContract,
  reports: PersonaReport[],
  runDir: string,
) => Promise<VerificationVerdict> {
  return (contract, reports, runDir) => {
    const config = loadConfig();
    return runJudge({
      contract,
      reports,
      // The run dir IS the run id — deriving it here keeps the verdict's runId
      // equal to the record it sits in, whatever named the run.
      runId: path.basename(runDir),
      taskId: null,
      runDir,
      evidenceIndex: walkFiles(runDir).map((f) => path.relative(runDir, f).split(path.sep).join("/")),
      judgeModel: config.execution.harness.judgeModel,
      builderModel: null,
      maxTurns: config.execution.maxTurns,
      timeoutMinutes: config.execution.timeoutMinutes,
    });
  };
}

async function runJourneyLink(
  link: JourneyRunLink,
  booted: BootedLigma,
  opts: CampaignOptions,
  chainOutDir: string,
): Promise<LinkOutcome> {
  const journey = readJourney(REPO_ROOT, link.journeyId);
  if (!journey) {
    return {
      status: "error",
      detail: `no journey ${link.journeyId} in ${REPO_ROOT}/.ligma/journeys`,
      evidence: [],
      signaturesVerified: 0,
    };
  }

  // Checked here rather than only between links: the panel is about to spawn
  // several personas, each with its own turn budget, and a dead port turns every
  // one of them into a long retry loop that reports "the app never loaded" as a
  // finding about the product.
  const unreachable = await targetUnreachable(booted);
  if (unreachable) return { status: "error", detail: unreachable, evidence: [], signaturesVerified: 0 };

  let result;
  try {
    result = await runJourney({
      projectId: opts.projectId,
      journeyId: link.journeyId,
      smoke: opts.smoke,
      stub: {
        productUrl: booted.url,
        panel:
          opts.mode === "live"
            ? livePanel(booted, journey.tags, journey.goal, opts.smoke)
            : stubPanel(booted),
        judge: opts.mode === "live" ? liveJudge() : stubJudge(),
      },
    });
  } catch (err) {
    return {
      status: "error",
      detail: `journey run threw: ${err instanceof Error ? err.message : String(err)}`,
      evidence: [],
      signaturesVerified: 0,
    };
  }

  // The run dir belongs to the dev checkout (the panel runs here); the chain
  // keeps a verbatim copy so the manifest's paths resolve for a reader.
  const copied = copyTreeVerbatim(result.runDir, path.join(chainOutDir, "journeys", result.runId));
  const outcome = result.verdict?.outcome ?? "error";

  if (opts.mode === "stub") {
    return {
      status: "rehearsed",
      detail: `machinery ran end to end against ${booted.url}; verdict outcome "${outcome}" came from the rehearsal stub and is NOT evidence`,
      evidence: copied,
      signaturesVerified: 0,
    };
  }
  return {
    status: outcome === "passed" ? "green" : outcome === "failed" ? "failed" : "error",
    detail: `${result.runId}: verdict ${outcome}`,
    evidence: copied,
    signaturesVerified: result.verdict?.signature ? 1 : 0,
  };
}

// ─── Chain ───────────────────────────────────────────────────────────────────

/**
 * Is the instance under test still there? Returns the env-class reason it is
 * not, or null when it answers.
 *
 * Both halves matter: a process that has already exited names itself and its
 * log, and a process still nominally alive but refusing connections is reported
 * as what it is — an environment failure — rather than left for a persona to
 * discover as a product one.
 */
async function targetUnreachable(booted: BootedLigma): Promise<string | null> {
  const dead = booted.died();
  if (dead) return `env: ${dead}`;
  try {
    const res = await fetch(booted.url, { signal: AbortSignal.timeout(15_000) });
    if (res.status !== 200) return `env: ${booted.url} answered ${res.status} — the instance under test is not serving`;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return `env: ${booted.url} did not answer (${why}). ${booted.died() ?? "Both child processes are still running — the server is up but not serving."}`;
  }
  return null;
}

async function fetchCollection(daemonUrl: string, link: InterludeMonitorLink): Promise<unknown[]> {
  const res = await fetch(`${daemonUrl}${link.path}`, { signal: AbortSignal.timeout(20_000) });
  if (res.status !== 200) throw new Error(`${link.path} answered ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const items = body[link.collection];
  if (!Array.isArray(items)) throw new Error(`${link.path} has no "${link.collection}" array`);
  return items;
}

/** How much of each child's log a chain keeps. Enough to hold a stack trace. */
const LOG_TAIL_LINES = 200;

/**
 * Copy the booted instance's log tails into the chain dir, before teardown.
 *
 * d1-attempt-1 went red on a raw 500 from `promote/preview` and the server-side
 * cause was **unrecoverable**: the logs lived in the throwaway data dir and died
 * with it, so the only account of the failure was five personas describing a red
 * string. The diagnosis then costs a whole second live run. Written for every
 * chain, not just the red ones — a green chain's tail is what the next red one
 * gets compared against, and 200 lines is not a size worth deciding about.
 */
function exportBootedLogs(booted: BootedLigma, chainOutDir: string): void {
  for (const label of ["daemon", "web"]) {
    const file = path.join(booted.logDir, `${label}.log`);
    try {
      writeFileSync(path.join(chainOutDir, `${label}.log.tail`), `${tailLog(file, LOG_TAIL_LINES)}\n`, "utf-8");
    } catch (err) {
      console.error(`[campaign] could not export ${label}.log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function runChain(chain: Chain, opts: CampaignOptions): Promise<ChainManifest> {
  const startedAt = new Date().toISOString();
  const chainOutDir = path.join(opts.outDir, chain.id);
  // A re-run must never leave a prior attempt's manifest in place — a stale
  // manifest reads as this run's result (it did once; see DECISIONS.md). The
  // old attempt is rotated aside wholesale, evidence and all.
  if (existsSync(path.join(chainOutDir, "manifest.json"))) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    renameSync(chainOutDir, `${chainOutDir}-superseded-${stamp}`);
  }
  mkdirSync(chainOutDir, { recursive: true });

  let booted: BootedLigma | null = null;
  // Read before teardown: the key file lives in the throwaway data dir, and
  // teardown takes that dir with it. The manifest still has to name the key its
  // evidence was verified against.
  let bootedKey: string | null = null;
  const links: LinkResult[] = [];
  let stopped = false;

  try {
    if (needsBootedInstance(chain)) {
      console.error(`[campaign] ${chain.id}: booting an ephemeral ligma (seed=${chain.seed}, mode=${opts.mode})…`);
      booted = await bootLigma({
        seed: chain.seed,
        stub: opts.mode === "stub",
        keepData: opts.keepData,
        // Campaign economy: one naive user plus the load-bearing charters is
        // the panel a chain pays for; the wider default panel stays for
        // on-demand product verification runs.
        configOverrides: { execution: { harness: { naiveUserRuns: 1 } } },
      });
      console.error(`[campaign] ${chain.id}: web ${booted.url} · daemon ${booted.daemonUrl} · data ${booted.dataDir}`);
    }

    for (const link of chain.links) {
      const linkStarted = new Date().toISOString();
      if (stopped) {
        links.push({
          ...link,
          status: "skipped",
          detail: "an earlier link in this chain did not pass",
          evidence: [],
          signaturesVerified: 0,
          startedAt: linkStarted,
          finishedAt: new Date().toISOString(),
        });
        continue;
      }

      // A child that fell over between links takes the rest of the chain with
      // it, loudly and immediately: every later link would run against a dead
      // port and blame the product for the silence.
      const dead = booted?.died() ?? null;
      if (dead) {
        console.error(`[campaign] ${chain.id}/${link.id}: aborting — ${dead}`);
        links.push({
          ...link,
          status: "error",
          detail: `env: ${dead}`,
          evidence: [],
          signaturesVerified: 0,
          startedAt: linkStarted,
          finishedAt: new Date().toISOString(),
        });
        stopped = true;
        continue;
      }

      console.error(`[campaign] ${chain.id}/${link.id}: ${link.kind}…`);
      let outcome: LinkOutcome;
      switch (link.kind) {
        case "journey-run":
          outcome = booted
            ? await runJourneyLink(link, booted, opts, chainOutDir)
            : { status: "error", detail: "no booted instance", evidence: [], signaturesVerified: 0 };
          break;
        case "interlude-monitor":
          outcome = booted
            ? await runInterludeLink(link, {
                fetchCollection: (l) => fetchCollection(booted!.daemonUrl, l),
                ...(opts.interludeTimeoutMs === undefined ? {} : { timeoutMs: opts.interludeTimeoutMs }),
              })
            : { status: "error", detail: "no booted instance", evidence: [], signaturesVerified: 0 };
          break;
        case "evidence-export":
          if (booted) bootedKey = bootedPublicKey(booted.dataDir);
          outcome = runEvidenceExportLink(link, {
            bootedDataDir: booted?.dataDir ?? "",
            publicKey: bootedKey,
            chainOutDir,
            lockerDir: path.join(DATA_DIR, "campaign", chain.id),
            outDir: opts.outDir,
          });
          break;
        case "audit-script":
          outcome = await runAuditLink(link, { run: spawnAudit, chainOutDir });
          break;
      }

      links.push({
        ...link,
        ...outcome,
        startedAt: linkStarted,
        finishedAt: new Date().toISOString(),
      });
      console.error(`[campaign] ${chain.id}/${link.id}: ${outcome.status} — ${outcome.detail}`);
      if (outcome.status !== "green" && outcome.status !== "rehearsed" && !opts.continueAfterRed) stopped = true;
    }
  } finally {
    if (booted) {
      bootedKey = bootedPublicKey(booted.dataDir);
      exportBootedLogs(booted, chainOutDir);
      console.error(`[campaign] ${chain.id}: tearing down the booted instance…`);
      await booted.stop().catch((err: unknown) => console.error(`[campaign] teardown: ${String(err)}`));
    }
  }

  const allGreen = links.every((l) => l.status === "green");
  const allRan = links.every((l) => l.status === "green" || l.status === "rehearsed");
  const manifest: ChainManifest = {
    chainId: chain.id,
    title: chain.title,
    brief: chain.brief,
    mode: opts.mode,
    // A chain with a rehearsed link is never green: rehearsal is not evidence.
    result: allGreen ? "green" : allRan ? "rehearsed" : "red",
    ...(opts.mode === "stub"
      ? {
          unrehearsable: links
            .filter((l) => l.status !== "green" && l.status !== "rehearsed")
            .map((l) => ({
              id: l.id,
              kind: l.kind,
              reason:
                l.status === "skipped"
                  ? l.detail
                  : `${l.detail} — with the model layer stubbed the booted instance cannot do the work this link waits on`,
            })),
        }
      : {}),
    bootedInstance: booted
      ? {
          envId: booted.envId,
          url: booted.url,
          daemonUrl: booted.daemonUrl,
          dataDir: booted.dataDir,
          publicKey: bootedKey,
        }
      : null,
    links,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(chainOutDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return manifest;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

/** Flags that take a value — so their value is never read as the chain id. */
const VALUE_FLAGS = ["out", "project", "interlude-timeout-ms"];

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function positionalArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.includes(arg.slice(2))) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * The ligma project the campaign's journeys belong to. The dogfood project is
 * the one whose repoPath IS this checkout (twin primitives: ligma adopted
 * itself). A rehearsal is allowed to create it in its own scratch data dir —
 * that is fixture setup, not evidence.
 */
async function resolveProjectId(explicit: string | undefined, mode: "live" | "stub"): Promise<string> {
  if (explicit) return explicit;
  // A scratch data dir starts with no stores at all; a live one always has them.
  const data = await getProjects().catch((err: unknown) => {
    if (mode === "live") throw err;
    mkdirSync(DATA_DIR, { recursive: true });
    return { projects: [] } as Awaited<ReturnType<typeof getProjects>>;
  });
  const dogfood = data.projects.find((p) => p.repoPath && path.resolve(p.repoPath) === REPO_ROOT);
  if (dogfood) return dogfood.id;
  if (mode === "live") {
    throw new Error(
      `No project in ${DATA_DIR}/projects.json points at ${REPO_ROOT}. Adopt this repo first, or pass --project <id>.`,
    );
  }
  const id = "proj_campaign_rehearsal";
  data.projects.push({
    id,
    name: "ligma (campaign rehearsal)",
    description: "Created by run-campaign --stub so the journeys have a project to hang off.",
    status: "active",
    repoPath: REPO_ROOT,
    shape: "ui",
  } as unknown as (typeof data.projects)[number]);
  await saveProjects(data);
  console.error(`[campaign] created rehearsal project ${id} in ${DATA_DIR}`);
  return id;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const target = positionalArgs(argv)[0] ?? "all";
  const mode: "live" | "stub" = argv.includes("--stub") ? "stub" : "live";

  // "Real" is now two things: the default root (~/.ligma/data — a fresh user's
  // whole install) and the dogfood pin (<repo>/data). A rehearsal must be
  // pointed at a scratch store deliberately, not merely at a non-repo path.
  const store = dataRootInfo();
  if (mode === "stub" && (store.source === "default" || store.path === path.join(REPO_ROOT, "data"))) {
    throw new Error(
      `Refusing to rehearse against the real data dir (${store.path}, source: ${store.source}). Run with LIGMA_DATA_DIR=<scratch> so no rehearsal artifact can land in the evidence locker.`,
    );
  }
  if (mode === "stub") {
    // The rehearsal's own scratch store, so the panel's writes (contracts, run
    // records, human decisions) have somewhere real to go.
    mkdirSync(DATA_DIR, { recursive: true });
    for (const [file, empty] of Object.entries(EMPTY_STORES)) {
      const target = path.join(DATA_DIR, file);
      if (!existsSync(target)) writeFileSync(target, `${JSON.stringify(empty, null, 2)}\n`, "utf-8");
    }
  }

  const chains = target === "all" ? CHAINS : [chainById(target)].filter((c): c is Chain => !!c);
  if (chains.length === 0) throw new Error(`Unknown chain "${target}". Known: ${CHAINS.map((c) => c.id).join(", ")}`);

  const timeoutFlag = flag(argv, "interlude-timeout-ms");
  const opts: CampaignOptions = {
    mode,
    outDir: path.resolve(flag(argv, "out") ?? path.join(REPO_ROOT, "docs", "evidence", "campaign")),
    projectId: await resolveProjectId(flag(argv, "project"), mode),
    smoke: argv.includes("--smoke") || mode === "stub",
    keepData: argv.includes("--keep"),
    // Live campaigns always stop at the first unproven link: running the rest
    // against a broken prefix produces evidence about nothing.
    ...(argv.includes("--all-links") && mode === "stub" ? { continueAfterRed: true } : {}),
    ...(timeoutFlag ? { interludeTimeoutMs: Number(timeoutFlag) } : {}),
  };

  const manifests: ChainManifest[] = [];
  for (const chain of chains) manifests.push(await runChain(chain, opts));

  console.log(JSON.stringify({ mode, outDir: opts.outDir, chains: manifests }, null, 2));

  const summary = manifests
    .map((m) => `${m.chainId}: ${m.result} (${m.links.map((l) => `${l.id}=${l.status}`).join(", ")})`)
    .join("\n");
  console.error(`\n[campaign] ${mode} run complete\n${summary}\n`);

  // Live: anything not green is a failure. Rehearsal: only a red chain is.
  const bad = manifests.filter((m) => (mode === "live" ? m.result !== "green" : m.result === "red"));
  process.exit(bad.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
