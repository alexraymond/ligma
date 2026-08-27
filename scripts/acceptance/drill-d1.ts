/**
 * drill-d1.ts — zero-token acceptance drill for the D1 (greenfield headless)
 * dispatch seam.
 *
 * DRILL — NOT ACCEPTANCE EVIDENCE. This never proves the product works; it
 * proves the plumbing (dispatch, arg/env construction, reply parsing, promote)
 * does not crash. A real campaign (scripts/acceptance/run-campaign.ts) is the
 * only thing that may be reported as acceptance evidence.
 *
 * Why this exists: live campaign attempts cost 30-60 minutes and dozens of
 * premium spawns to surface seam bugs (a dispatch crash on an empty seed, a
 * partial-Task promote) that need no real model at all. This boots a REAL
 * ephemeral ligma — real daemon, real dispatcher, real HTTP routes, real
 * promote/contract-signing — and only fakes the intelligence: the instance's
 * `daemon-config.json` points `execution.claudeBinaryPath` at
 * `fake-claude-bin/claude` (a thin wrapper — see its own header — around
 * `fake-claude.mjs`), which prints a canned, schema-valid reply per governor
 * role and exits 0. Every spawn still goes through
 * findCliBinary → validateBinary → AgentRunner.spawnAgent → the quota
 * governor → the dispatcher's real accounting; only the model is absent.
 *
 * The one exception is the promote planner (`studio/promote.ts`'s
 * `runPlanner`): it talks to the Claude Agent SDK directly rather than
 * spawning the CLI as a subprocess, so a fake binary would break its stream
 * instead of stubbing it (see `studio/provider.ts`). That one wire uses the
 * SDK's own existing rehearsal stub, `LIGMA_STUB_STUDIO=1`.
 *
 * Deliberately does NOT set `LIGMA_DISCOVERY_STUB` — that switch skips the
 * discovery spawn entirely, which is exactly the seam this drill exists to
 * exercise (a real `spawnAgent` call, hitting fake-claude, parsed by the real
 * `discoveryReplySchema`).
 */

import path from "node:path";
import type { Brief } from "../../packages/api/src/briefs";
import { SHAPE_LABELS, SHAPE_QUESTION_ID } from "../../packages/api/src/briefs";
import type { PromotePreview, PromoteResult } from "../../packages/api/src/promote";
import type { Task } from "../../packages/api/src/types";
import type { DaemonStatus } from "../../apps/daemon/src/engine/types";
import { REPO_ROOT } from "../../apps/daemon/src/paths";
import { bootLigma, type BootedLigma } from "./booted-ligma";
import { call, createStepRunner, sleep, type StepResult } from "./drill-support";

// `execution.claudeBinaryPath` must resolve to a file named exactly "claude" —
// `validateBinary` (engine/security.ts) allowlists spawned binaries by
// basename, and "fake-claude.mjs" is not on it. The wrapper execs the real
// script; see fake-claude-bin/claude's own header for why it's a separate file.
export const FAKE_CLAUDE = path.join(REPO_ROOT, "scripts", "acceptance", "fake-claude-bin", "claude");
const BRIEF_PROMPT =
  "A headless REST API for tracking widget inventory: list widgets, add one, remove one. No UI — just the API.";

/** How long to wait for the dispatcher to attempt the promoted task, at most. */
const DISPATCH_WAIT_MS = 3 * 60_000;
const DISPATCH_POLL_MS = 5_000;

export async function runD1(): Promise<StepResult[]> {
  const { results, step, fail } = createStepRunner("");

  let instance: BootedLigma | null = null;
  let api = "";
  let projectId: string | null = null;
  let taskIds: string[] = [];
  let preview: PromotePreview | null = null;

  try {
    console.log("[drill:d1] booting an ephemeral ligma (real daemon, real web, fake-claude pinned in)...");
    instance = await bootLigma({
      seed: "none",
      stub: false,
      configOverrides: {
        execution: { claudeBinaryPath: FAKE_CLAUDE },
        // Cron's own floor. Worst case ~2 minutes for the 2 ticks step (d) wants.
        polling: { enabled: true, intervalMinutes: 1 },
      },
      // The one model wire fake-claude cannot stand in for (see header comment).
      extraEnv: { LIGMA_STUB_STUDIO: "1" },
    });
    api = instance.daemonUrl;
    console.log(`[drill:d1] booted — web ${instance.url}, daemon ${api}, data ${instance.dataDir}\n`);

    await step("(a)+(b) create headless project + brief — first discovery pass hits fake-claude", async () => {
      const res = await call(`${api}/api/briefs`, { method: "POST", body: { prompt: BRIEF_PROMPT, kind: "headless" } });
      if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      const brief = (res.body as { brief: Brief }).brief;
      projectId = brief.projectId;
      const openTurn = brief.turns.find((t) => t.answers === null);
      const hasShapeQuestion = openTurn?.form.questions.some((q) => q.id === SHAPE_QUESTION_ID) ?? false;
      if (!openTurn || !hasShapeQuestion) {
        throw new Error(`expected an open form asking the shape question, got turns=${JSON.stringify(brief.turns)}`);
      }
      return `project ${projectId}, brief ${brief.id}, open form "${openTurn.form.title}"`;
    });

    await step("answer discovery (shape=headless) — second discovery pass hits fake-claude", async () => {
      const briefRes = await call(`${api}/api/projects/${projectId}/brief`);
      const brief = (briefRes.body as { brief: Brief }).brief;
      const openTurn = brief.turns.find((t) => t.answers === null);
      if (!openTurn) throw new Error(`no open discovery form to answer: ${JSON.stringify(brief.turns)}`);
      const res = await call(`${api}/api/projects/${projectId}/brief/answers`, {
        method: "POST",
        body: { formId: openTurn.form.id, answers: { [SHAPE_QUESTION_ID]: SHAPE_LABELS.headless } },
      });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const answered = (res.body as { brief: Brief }).brief;
      return `brief status "${answered.status}", shape confirmed, ${answered.turns.length} turn(s) total`;
    });

    await step("lock the brief", async () => {
      const res = await call(`${api}/api/projects/${projectId}/brief`, { method: "PATCH", body: { lock: true } });
      const brief = (res.body as { brief?: Brief }).brief;
      if (res.status !== 200 || brief?.status !== "locked") {
        throw new Error(`expected a locked brief, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      return `locked at ${brief.lockedAt}`;
    });

    await step("(c) promote preview — planner runs via LIGMA_STUB_STUDIO, no CLI spawn", async () => {
      const res = await call(`${api}/api/projects/${projectId}/promote/preview`, { method: "POST", body: {} });
      const body = res.body as PromotePreview;
      if (res.status !== 200 || body.error !== null || body.tasks.length === 0) {
        throw new Error(`preview did not produce a breakdown: ${res.status} ${JSON.stringify(res.body)}`);
      }
      preview = body;
      return `${body.tasks.length} task(s), ${body.criteria.length} criteria, ${body.journeys.length} journey(s)`;
    });

    await step("(c) promote — commits tasks + signs contracts, no CLI spawn", async () => {
      const res = await call(`${api}/api/projects/${projectId}/promote`, { method: "POST", body: { preview } });
      if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      const result = res.body as PromoteResult;
      taskIds = result.tasks.map((t) => t.taskId);
      if (taskIds.length === 0) throw new Error(`promote reported zero landed tasks: ${JSON.stringify(res.body)}`);
      return `${taskIds.length} task(s) landed: ${taskIds.join(", ")}`;
    });

    await step("tasks land not-started + assigned (dispatchable)", async () => {
      const res = await call(`${api}/api/tasks?projectId=${projectId}`);
      const tasks = (res.body as { tasks: Task[] }).tasks;
      if (tasks.length === 0) throw new Error("no tasks found for the project right after promote");
      const bad = tasks.filter((t) => t.kanban !== "not-started" || !t.assignedTo);
      if (bad.length > 0) {
        throw new Error(`expected every task not-started+assigned, got ${JSON.stringify(bad.map((t) => ({ id: t.id, kanban: t.kanban, assignedTo: t.assignedTo })))}`);
      }
      return `${tasks.length} task(s) not-started, assigned to "${tasks[0].assignedTo}"`;
    });

    await step("(d) dispatcher attempts the task within ~2 ticks, daemon stays alive", async () => {
      const deadline = Date.now() + DISPATCH_WAIT_MS;
      for (;;) {
        const daemonRes = await call(`${api}/api/daemon`);
        const { status, isRunning } = daemonRes.body as { status: DaemonStatus; isRunning: boolean };
        if (!isRunning) throw new Error("the daemon process is no longer running — dispatch crashed it");

        const attemptedInHistory = status.history.some((h) => taskIds.includes(h.taskId ?? ""));
        const runningNow = status.activeSessions.some((s) => taskIds.includes(s.taskId ?? ""));

        const tasksRes = await call(`${api}/api/tasks?projectId=${projectId}`);
        const tasks = (tasksRes.body as { tasks: Task[] }).tasks;
        const moved = tasks.some((t) => taskIds.includes(t.id) && t.kanban !== "not-started");

        if (attemptedInHistory || runningNow || moved) {
          const kinds = tasks.filter((t) => taskIds.includes(t.id)).map((t) => t.kanban);
          return `dispatch attempted (history=${attemptedInHistory}, active=${runningNow}), kanban now [${kinds.join(", ")}]`;
        }

        if (Date.now() >= deadline) {
          throw new Error(`no dispatch attempt observed within ${DISPATCH_WAIT_MS / 1000}s (tried every ${DISPATCH_POLL_MS / 1000}s)`);
        }
        await sleep(DISPATCH_POLL_MS);
      }
    });
  } catch (err) {
    // A failure outside any named step (boot itself, an unexpected throw) —
    // still recorded so the summary and exit code are honest about it.
    fail("unexpected failure", err instanceof Error ? err.message : String(err));
  } finally {
    if (instance) {
      console.log("\n[drill:d1] tearing down the ephemeral instance...");
      await instance.stop();
    }
  }

  return results;
}
