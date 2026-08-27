/**
 * preflight.ts — two-minute environment + seam smoke before a campaign chain.
 *
 * A chain costs 30–60 minutes and most of that is spent before the links that
 * die of environmental causes: d2 attempt 4 (dispatch crashed on the empty
 * seed's task shape) and attempt 5 (CLI self-update swapped the binary under
 * the judge) were both detectable in seconds without booting anything. Each
 * check here exists because a live attempt paid for it.
 *
 * Exit 0: safe to launch. Exit 1: a named check failed — the launcher should
 * hold, not burn an attempt. This is an ENV gate, not a test: product defects
 * still belong to the chains.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "..", "..");

function fail(check: string, detail: string): never {
  console.error(`[preflight] FAIL ${check}: ${detail}`);
  process.exit(1);
}

function ok(check: string, detail = ""): void {
  console.log(`[preflight] ok ${check}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Child mode: LIGMA_DATA_DIR is already pointed at an empty temp dir by the
 * parent, so every daemon module below resolves against the same stores a
 * freshly booted instance sees. Throws (exit 1) on any seam crash.
 */
async function seedCheck(): Promise<void> {
  const dataDir = process.env.LIGMA_DATA_DIR;
  if (!dataDir || !dataDir.includes("ligma-preflight-")) {
    throw new Error("seed-check must be launched by preflight with LIGMA_DATA_DIR set to its temp dir");
  }
  const daemonSrc = path.join(REPO, "apps", "daemon", "src");
  const { EMPTY_STORES } = await import(path.join(REPO, "scripts", "acceptance", "booted-ligma.ts"));
  for (const [file, empty] of Object.entries(EMPTY_STORES)) {
    writeFileSync(path.join(dataDir, file), JSON.stringify(empty, null, 2));
  }
  const { ensureBuilderAgent } = await import(path.join(daemonSrc, "store", "data.ts"));
  const builderId = await ensureBuilderAgent();
  const task = {
    id: "task_preflight",
    title: "Preflight synthetic task",
    description: "Never dispatched — exists to walk buildTaskPrompt over the exact empty-seed stores a booted instance starts from.",
    importance: "important",
    urgency: "not-urgent",
    kanban: "not-started",
    verificationStatus: "unverified",
    projectId: null,
    milestoneId: null,
    assignedTo: builderId,
    collaborators: [],
    dailyActions: [],
    subtasks: [],
    blockedBy: [],
    estimatedMinutes: null,
    actualMinutes: null,
    acceptanceCriteria: ["preflight criterion"],
    comments: [],
    tags: [],
    notes: "",
    dueDate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    deletedAt: null,
  };
  writeFileSync(path.join(dataDir, "tasks.json"), JSON.stringify({ tasks: [task] }, null, 2));
  const { buildTaskPrompt, getTask } = await import(path.join(daemonSrc, "engine", "prompt-builder.ts"));
  const fromDisk = getTask("task_preflight");
  if (!fromDisk) throw new Error("synthetic task not readable back from tasks.json");
  const prompt = buildTaskPrompt(builderId, fromDisk);
  if (prompt.length < 100) throw new Error("prompt suspiciously short");
}

async function main(): Promise<void> {

// ── 1. claude binary present and answering (attempt-5 class) ────────────────
let binPath = "";
try {
  binPath = execFileSync("/bin/sh", ["-c", "command -v claude"], { encoding: "utf-8" }).trim();
  execFileSync(binPath, ["--version"], { encoding: "utf-8", timeout: 15_000 });
  ok("claude-binary", binPath);
} catch (err) {
  fail("claude-binary", `not found or not executable (${err instanceof Error ? err.message : String(err)})`);
}

// ── 2. judge model config sane (misconfig beats a 28-minute discovery) ──────
const daemonSrc = path.join(REPO, "apps", "daemon", "src");
const { loadConfig } = await import(path.join(daemonSrc, "store", "config.ts")).catch(() => import(path.join(daemonSrc, "engine", "config.ts")));
const config = loadConfig();
const judgeModel: string | undefined = config?.execution?.harness?.judgeModel;
if (!judgeModel || judgeModel.trim() === "") {
  fail("judge-model", "execution.harness.judgeModel is not set in daemon-config.json");
}
ok("judge-model", judgeModel);

// ── 3. empty-seed task builds a prompt (attempt-4 class: raw-read seam) ─────
// Runs in a SUBPROCESS: DATA_DIR freezes at first daemon-module import, and
// this process already imported config against the real store. The child gets
// LIGMA_DATA_DIR=tmp before any import, exactly like a booted instance.
const tmp = mkdtempSync(path.join(os.tmpdir(), "ligma-preflight-"));
try {
  execFileSync("npx", ["tsx", __filename, "--seed-check"], {
    encoding: "utf-8",
    timeout: 60_000,
    cwd: REPO,
    env: { ...process.env, LIGMA_DATA_DIR: tmp },
  });
  ok("empty-seed-dispatch");
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  fail("empty-seed-dispatch", (e.stderr || e.stdout || e.message || "").trim().slice(-400));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 4. one governed spawn on the judge's model (attempt-3 class: credits/429/auth) — LAST: it spends a slot
const { claimSpawn, refundSpawn } = await import(path.join(daemonSrc, "engine", "quota-governor.ts"));
const decision = claimSpawn("judge", { label: "campaign preflight probe", ref: "preflight" });
if (!decision.allow) {
  fail("governor", `no headroom for the probe itself (${decision.reason ?? "denied"}) — the chain would stall anyway`);
}
try {
  const out = execFileSync(binPath, ["-p", "reply with exactly: ok", "--model", judgeModel, "--max-turns", "1"], {
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (!out.toLowerCase().includes("ok")) fail("model-probe", `unexpected reply: ${out.slice(0, 120)}`);
  ok("model-probe", `${judgeModel} answered`);
} catch (err) {
  // The claim was for a spawn that produced nothing usable — hand it back.
  refundSpawn("judge", "preflight", "claude");
  const msg = err instanceof Error ? err.message : String(err);
  fail("model-probe", `spawn on ${judgeModel} failed — credits/auth/binary (${msg.slice(0, 200)})`);
}

console.log("[preflight] all checks passed");
}

if (process.argv.includes("--seed-check")) {
  seedCheck().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
} else {
  void main();
}
