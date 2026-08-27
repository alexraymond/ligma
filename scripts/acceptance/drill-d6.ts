/**
 * drill-d6.ts — the fresh-install walkthrough (phase 3 DoD), at zero tokens.
 *
 * DRILL — NOT ACCEPTANCE EVIDENCE. Empty data dir, fake intelligence
 * everywhere (fake-claude for CLI spawns, LIGMA_DISCOVERY_STUB for the
 * discovery pass, LIGMA_STUB_STUDIO for the SDK studio wire), and the whole
 * first-session path walked end to end through the REAL routes:
 *
 *   composer → project → discovery thread → (stub) design → Start building
 *   → tray item → answer → consequence
 *
 * Every arrow is one seam the shell rebuild moved. If a rename broke the
 * door, this fails at the door, not in a user's first five minutes.
 */

import { YOU_DECIDE } from "../../packages/api/src/briefs";
import { bootLigma, type BootedLigma } from "./booted-ligma";
import { FAKE_CLAUDE } from "./drill-d1";
import { call, createStepRunner, type StepResult } from "./drill-support";

interface BriefQuestion {
  id: string;
  options: string[];
}
interface BriefTurn {
  form: { id: string; questions: BriefQuestion[] };
  answers: Record<string, unknown> | null;
}
interface BriefBody {
  brief?: { projectId?: string; status: string; turns: BriefTurn[] };
}

export async function runD6(): Promise<StepResult[]> {
  const { results, step, fail } = createStepRunner("");

  let instance: BootedLigma | null = null;
  let api = "";
  let projectId = "";
  let formId = "";
  let uiShapeOption = "";
  let designId = "";
  let preview: unknown = null;
  let decisionId = "";

  try {
    console.log("[drill:d6] booting an ephemeral ligma with an EMPTY data dir...");
    instance = await bootLigma({
      seed: "none",
      stub: false,
      configOverrides: { execution: { claudeBinaryPath: FAKE_CLAUDE } },
      extraEnv: { LIGMA_DISCOVERY_STUB: "1", LIGMA_STUB_STUDIO: "1" },
    });
    api = instance.daemonUrl;
    console.log(`[drill:d6] booted — web ${instance.url}, daemon ${api}, data ${instance.dataDir}\n`);

    await step("fresh install — no projects, and the tray serves its empty state as a page", async () => {
      const projects = await call(`${api}/api/projects`);
      const list = ((projects.body as { projects?: unknown[] })?.projects ?? []) as unknown[];
      if (list.length !== 0) throw new Error(`expected 0 projects, got ${list.length}`);
      const tray = await fetch(`${instance!.url}/needs-you`);
      if (tray.status !== 200) throw new Error(`/needs-you answered ${tray.status}`);
      return "0 projects; /needs-you 200";
    });

    await step("composer — POST /api/briefs creates the project and opens discovery", async () => {
      const res = await call(`${api}/api/briefs`, {
        method: "POST",
        body: { prompt: "A recipe box the whole family can edit from their phones" },
      });
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      projectId = (res.body as { brief?: { projectId?: string } }).brief?.projectId ?? "";
      if (!projectId) throw new Error("no projectId in briefs response");
      return `project ${projectId} born from the composer's door`;
    });

    await step("discovery thread — answer the stub form, choosing a UI shape", async () => {
      const briefRes = await call(`${api}/api/projects/${projectId}/brief`);
      const turns = (briefRes.body as BriefBody).brief?.turns ?? [];
      const open = turns.find((t) => t.answers === null);
      if (!open) throw new Error("no open discovery turn");
      formId = open.form.id;
      const shapeQ = open.form.questions.find((q) => q.id === "shape");
      if (!shapeQ) throw new Error("no shape question on the first form");
      uiShapeOption = shapeQ.options.find((o) => /ui|look at it/i.test(o)) ?? shapeQ.options[0]!;
      const res = await call(`${api}/api/projects/${projectId}/brief/answers`, {
        method: "POST",
        body: { formId, answers: { audience: YOU_DECIDE, shape: uiShapeOption } },
      });
      if (res.status !== 200) throw new Error(`answers: expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const lock = await call(`${api}/api/projects/${projectId}/brief`, { method: "PATCH", body: { lock: true } });
      if (lock.status !== 200) throw new Error(`lock: expected 200, got ${lock.status}`);
      return `form answered (shape="${uiShapeOption}"), brief locked`;
    });

    await step("stub design — a session opens and a version lands on the Wall", async () => {
      const res = await call(`${api}/api/projects/${projectId}/designs`, {
        method: "POST",
        body: { prompt: "A warm, phone-first recipe card wall" },
      });
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`designs: expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      designId = (res.body as { design?: { id?: string }; id?: string }).design?.id ?? (res.body as { id?: string }).id ?? "";
      if (!designId) throw new Error(`no design id in ${JSON.stringify(res.body)}`);
      return `design ${designId} created via the stub studio wire`;
    });

    await step("the stub turn settles — a version lands, then approve freezes the baseline", async () => {
      // The stub studio writes its version asynchronously; approving mid-turn
      // is refused (409) by design. Wait for the turn to land first.
      const deadline = Date.now() + 30_000;
      let versions = 0;
      while (Date.now() < deadline) {
        const res = await call(`${api}/api/projects/${projectId}/designs/${designId}`);
        const design = (res.body as { design?: { versions?: unknown[]; turnInFlight?: boolean } }).design;
        versions = design?.versions?.length ?? 0;
        if (versions > 0 && design?.turnInFlight !== true) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (versions === 0) throw new Error("no design version landed within 30s");
      const res = await call(`${api}/api/projects/${projectId}/designs/${designId}/approve`, { method: "POST" });
      if (res.status !== 200) throw new Error(`approve: expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      return `approved after ${versions} version(s) landed`;
    });

    await step("Start building — promote preview then promote; tasks land signed", async () => {
      const prev = await call(`${api}/api/projects/${projectId}/promote/preview`, {
        method: "POST",
        body: { designId },
      });
      if (prev.status !== 200) throw new Error(`preview: expected 200, got ${prev.status}: ${JSON.stringify(prev.body)}`);
      preview = prev.body;
      const res = await call(`${api}/api/projects/${projectId}/promote`, { method: "POST", body: { preview } });
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`promote: expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      const tasks = await call(`${api}/api/tasks?projectId=${projectId}`);
      const list = ((tasks.body as { tasks?: Array<{ id: string }> })?.tasks ?? []) as Array<{ id: string }>;
      if (list.length === 0) throw new Error("no tasks landed from promote");
      return `${list.length} task(s) on the Board`;
    });

    await step("a tray item appears — a blocking decision reaches /api/deck", async () => {
      const tasks = await call(`${api}/api/tasks?projectId=${projectId}`);
      const firstTask = (((tasks.body as { tasks?: Array<{ id: string }> })?.tasks ?? []) as Array<{ id: string }>)[0]!;
      const res = await call(`${api}/api/decisions`, {
        method: "POST",
        body: {
          requestedBy: "developer",
          taskId: firstTask.id,
          question: "Should recipe photos be required?",
          options: ["Required", "Optional"],
          context: "The card layout differs.",
        },
      });
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`decision create: expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      decisionId = (res.body as { decision?: { id?: string }; id?: string }).decision?.id ?? (res.body as { id?: string }).id ?? "";
      if (!decisionId) throw new Error(`no decision id in ${JSON.stringify(res.body)}`);
      const deck = await call(`${api}/api/deck`);
      const cards = ((deck.body as { cards?: Array<{ kind: string; decision: { id: string } | null }> })?.cards ?? []) as Array<{
        kind: string;
        decision: { id: string } | null;
      }>;
      if (!cards.some((c) => c.kind === "decision" && c.decision?.id === decisionId)) {
        throw new Error("the decision did not appear as a deck/tray card");
      }
      return `decision ${decisionId} waiting in the tray queue`;
    });

    await step("answer it — the consequence is recorded, not just displayed", async () => {
      const res = await call(`${api}/api/decisions`, {
        method: "PATCH",
        body: { id: decisionId, action: "answer", answer: "Optional" },
      });
      if (res.status !== 200) throw new Error(`answer: expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const undo = (res.body as { undoExpiresAt?: string }).undoExpiresAt;
      if (!undo || new Date(undo).getTime() <= Date.now()) {
        throw new Error("no live server-side undo window on the answer");
      }
      const log = await call(`${api}/api/activity-log`);
      const events = ((log.body as { events?: Array<{ type: string; projectId?: string | null }> })?.events ?? []) as Array<{
        type: string;
        projectId?: string | null;
      }>;
      const answered = events.find((e) => e.type === "decision_answered");
      if (!answered) throw new Error("no decision_answered activity event");
      if (answered.projectId !== projectId) {
        throw new Error(`decision_answered carries projectId=${String(answered.projectId)}, expected ${projectId}`);
      }
      return "answered — undo window live, activity event carries the projectId";
    });
  } catch (err) {
    fail("d6 setup/teardown", err instanceof Error ? err.message : String(err));
  } finally {
    if (instance) {
      console.log("\n[drill:d6] tearing down the ephemeral instance...");
      await instance.stop();
    }
  }

  return results;
}
