/**
 * drill-d2.ts — zero-token acceptance drill for the D2 (studio design loop)
 * seam.
 *
 * DRILL — NOT ACCEPTANCE EVIDENCE. Same discipline as drill-d1.ts: a REAL
 * ephemeral ligma, real daemon, real HTTP routes, real contract-signing — with
 * only the model absent. Every design turn and the promote planner route
 * through `studio/provider.ts`'s `campaignStubProvider` (LIGMA_STUB_STUDIO=1),
 * which discriminates on what the tool registry declares exactly as the real
 * Claude-subscription provider does, so the tools, containment checks,
 * snapshots and the governor gate upstream all run their real code — only the
 * model call is a canned reply.
 *
 * No CLI binary is spawned by this drill's own flow (the studio wire never
 * shells out — see provider.ts), but `execution.claudeBinaryPath` is pinned at
 * fake-claude anyway: a stray dispatcher tick on the tasks this drill promotes
 * must never be able to reach a real `claude` process.
 */

import type {
  CompiledInstructionPreview,
  DesignApproveResult,
  DesignManifest,
  DesignPin,
  DesignSummary,
  DesignTurnAccepted,
} from "../../packages/api/src/designs";
import type { AcceptanceContract } from "../../packages/api/src/harness";
import type { PromotePreview, PromoteResult } from "../../packages/api/src/promote";
import type { Task } from "../../packages/api/src/types";
import { verifyContract } from "../../apps/daemon/src/harness/contract-store";
import { bootLigma, type BootedLigma } from "./booted-ligma";
import { FAKE_CLAUDE } from "./drill-d1";
import { call, createStepRunner, sleep, type StepResult } from "./drill-support";

const DESIGN_PROMPT = "A two-screen marketing site: a hero landing page and a detail page.";
const TURN_WAIT_MS = 60_000;
const TURN_POLL_MS = 1_000;

interface DesignDetail {
  design: DesignManifest;
  summary: DesignSummary;
  turnInFlight: boolean;
}

/** Poll the design until no turn is in flight — generation AND its critique pass both finish before this clears. */
async function awaitTurnSettled(api: string, projectId: string, designId: string): Promise<DesignDetail> {
  const deadline = Date.now() + TURN_WAIT_MS;
  for (;;) {
    const res = await call(`${api}/api/projects/${projectId}/designs/${designId}`);
    const detail = res.body as DesignDetail;
    if (res.status !== 200) throw new Error(`design fetch failed: ${res.status} ${JSON.stringify(res.body)}`);
    if (!detail.turnInFlight) return detail;
    if (Date.now() >= deadline) throw new Error(`turn still in flight after ${TURN_WAIT_MS / 1000}s`);
    await sleep(TURN_POLL_MS);
  }
}

export async function runD2(): Promise<StepResult[]> {
  const { results, step, fail } = createStepRunner("");

  let instance: BootedLigma | null = null;
  let api = "";
  let projectId = "";
  let designId = "";
  let pinId = "";
  let firstTaskId = "";
  let preview: PromotePreview | null = null;

  try {
    console.log("[drill:d2] booting an ephemeral ligma (studio wire stubbed via LIGMA_STUB_STUDIO)...");
    instance = await bootLigma({
      seed: "none",
      stub: false,
      configOverrides: { execution: { claudeBinaryPath: FAKE_CLAUDE } },
      extraEnv: { LIGMA_STUB_STUDIO: "1" },
    });
    api = instance.daemonUrl;
    console.log(`[drill:d2] booted — web ${instance.url}, daemon ${api}, data ${instance.dataDir}\n`);

    await step("create a UI project", async () => {
      const res = await call(`${api}/api/projects`, { method: "POST", body: { name: "D2 drill — studio loop" } });
      if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      projectId = (res.body as { id: string }).id;
      return `project ${projectId}`;
    });

    await step("start a design session with an opening prompt — stub generates onto the Wall", async () => {
      const res = await call(`${api}/api/projects/${projectId}/designs`, {
        method: "POST",
        body: { title: "Marketing site", prompt: DESIGN_PROMPT },
      });
      if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      const body = res.body as { design: DesignSummary; turn: DesignTurnAccepted | null };
      designId = body.design.id;
      if (!body.turn || body.turn.appliedWithoutSpawn) {
        throw new Error(`expected a detached generation turn, got ${JSON.stringify(body.turn)}`);
      }
      return `design ${designId}, turn ${body.turn.turnId} accepted (kind=${body.turn.kind})`;
    });

    await step("prompt turn lands a version with files on the Wall", async () => {
      const detail = await awaitTurnSettled(api, projectId, designId);
      const version = detail.design.versions.at(-1);
      if (!version || version.files.length === 0) {
        throw new Error(`expected at least one version with files, got ${JSON.stringify(detail.design.versions)}`);
      }
      const paths = version.files.map((f) => f.path);
      if (!paths.includes("index.html")) {
        throw new Error(`expected the stub's index.html among the version's files, got ${JSON.stringify(paths)}`);
      }
      return `version ${version.id} (n=${version.n}) with ${version.files.length} file(s): ${paths.join(", ")}`;
    });

    await step("critique lane is populated — GET the design, read its critique", async () => {
      const res = await call(`${api}/api/projects/${projectId}/designs/${designId}`);
      const detail = res.body as DesignDetail;
      const critique = detail.design.critique;
      if (!critique || critique.status !== "scored" || critique.score === null) {
        throw new Error(`expected a scored stub critique, got ${JSON.stringify(critique)}`);
      }
      const stubNote = critique.rules.some((r) => r.note.includes("LIGMA_STUB_STUDIO"));
      if (!stubNote) throw new Error(`expected a rule noting the stub ran, got ${JSON.stringify(critique.rules)}`);
      return `critique status "${critique.status}", score ${critique.score}, ${critique.rules.length} rule(s)`;
    });

    await step("pin a comment on the design", async () => {
      const res = await call(`${api}/api/projects/${projectId}/designs/${designId}/pins`, {
        method: "POST",
        body: {
          filePath: "index.html",
          selector: ".hero",
          tag: "h1",
          outerHTML: '<h1 class="hero">Stubbed screen (revision 1)</h1>',
          text: "Make the hero heading larger and bolder",
        },
      });
      if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      const pin = res.body as DesignPin;
      if (pin.status !== "pending") throw new Error(`expected a pending pin, got ${JSON.stringify(pin)}`);
      pinId = pin.id;
      return `pin ${pinId} staged on ${pin.filePath}`;
    });

    await step("apply-preview shows the pinned comment's text in the compiled instruction", async () => {
      const res = await call(`${api}/api/projects/${projectId}/designs/${designId}/pins/preview`, {
        method: "POST",
        body: {},
      });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const preview = res.body as CompiledInstructionPreview;
      if (!preview.pinIds.includes(pinId)) {
        throw new Error(`expected pin ${pinId} in the preview, got ${JSON.stringify(preview.pinIds)}`);
      }
      if (!preview.instruction.includes("Make the hero heading larger and bolder")) {
        throw new Error(`expected the pin's own text in the compiled instruction, got: ${preview.instruction}`);
      }
      return `instruction (${preview.instruction.length} chars) quotes the pin's text verbatim`;
    });

    await step("apply the pinned edit — a new version lands, the pin is marked applied", async () => {
      const before = await call(`${api}/api/projects/${projectId}/designs/${designId}`);
      const versionsBefore = (before.body as DesignDetail).design.versions.length;

      const turnRes = await call(`${api}/api/projects/${projectId}/designs/${designId}/turn`, {
        method: "POST",
        body: { kind: "comment-apply" },
      });
      if (turnRes.status !== 202) throw new Error(`expected 202, got ${turnRes.status}: ${JSON.stringify(turnRes.body)}`);

      const detail = await awaitTurnSettled(api, projectId, designId);
      if (detail.design.versions.length <= versionsBefore) {
        throw new Error(`expected a new version after apply, still at ${detail.design.versions.length}`);
      }
      const pin = detail.design.pins.find((p) => p.id === pinId);
      if (!pin || pin.status !== "applied" || !pin.appliedInVersionId) {
        throw new Error(`expected the pin marked applied, got ${JSON.stringify(pin)}`);
      }
      return `version ${detail.design.versions.length} landed, pin ${pinId} applied in ${pin.appliedInVersionId}`;
    });

    await step("approve the design — status approved, baseline frozen at the latest version", async () => {
      const res = await call(`${api}/api/projects/${projectId}/designs/${designId}/approve`, { method: "POST" });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const result = res.body as DesignApproveResult;
      if (result.status !== "approved" || result.baseline.designId !== designId) {
        throw new Error(`expected an approved baseline for ${designId}, got ${JSON.stringify(result)}`);
      }
      return `approved at ${result.approvedAt}, baseline pinned to version ${result.baseline.versionId}`;
    });

    await step("promote preview from the design — tasks + designBaseline present", async () => {
      const res = await call(`${api}/api/projects/${projectId}/promote/preview`, { method: "POST", body: { designId } });
      preview = res.body as PromotePreview;
      if (res.status !== 200 || preview.error !== null) {
        throw new Error(`preview failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
      if (preview.tasks.length === 0 || preview.designBaseline === null || preview.designId !== designId) {
        throw new Error(`expected task(s) with a design baseline, got ${JSON.stringify(preview)}`);
      }
      const detail = `${preview.tasks.length} task(s), designBaseline for ${preview.designBaseline.designId} v${preview.designBaseline.versionId}`;
      return detail;
    });

    await step("promote — commits tasks with a signed contract carrying the design baseline", async () => {
      const res = await call(`${api}/api/projects/${projectId}/promote`, { method: "POST", body: { preview } });
      if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      const result = res.body as PromoteResult;
      if (result.tasks.length === 0 || !result.designBaselineIngested) {
        throw new Error(`expected landed tasks with the design baseline ingested, got ${JSON.stringify(result)}`);
      }
      firstTaskId = result.tasks[0].taskId;
      return `${result.tasks.length} task(s) landed, designBaselineIngested=${result.designBaselineIngested}`;
    });

    await step("tasks land not-started + assigned, carrying the design id", async () => {
      const res = await call(`${api}/api/tasks?projectId=${projectId}`);
      const tasks = (res.body as { tasks: Task[] }).tasks;
      if (tasks.length === 0) throw new Error("no tasks found for the project right after promote");
      const bad = tasks.filter((t) => t.kanban !== "not-started" || !t.assignedTo || t.designId !== designId);
      if (bad.length > 0) {
        throw new Error(`expected every task not-started+assigned+designId=${designId}, got ${JSON.stringify(bad)}`);
      }
      return `${tasks.length} task(s) not-started, assigned, designId=${designId}`;
    });

    await step("the promoted task's contract is signed and verifies", async () => {
      const res = await call(`${api}/api/contracts/${firstTaskId}`);
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const { contracts } = res.body as { contracts: AcceptanceContract[] };
      const latest = contracts.at(-1);
      if (!latest) throw new Error(`no contract found for task ${firstTaskId}`);
      if (!latest.designBaseline || latest.designBaseline.designId !== designId) {
        throw new Error(`expected the contract to carry the design baseline, got ${JSON.stringify(latest.designBaseline)}`);
      }
      if (!verifyContract(latest)) {
        throw new Error(`contract ${latest.id} v${latest.version} failed signature verification`);
      }
      return `contract ${latest.id} v${latest.version} verified, designBaseline=${latest.designBaseline.designId}`;
    });
  } catch (err) {
    fail("unexpected failure", err instanceof Error ? err.message : String(err));
  } finally {
    if (instance) {
      console.log("\n[drill:d2] tearing down the ephemeral instance...");
      await instance.stop();
    }
  }

  return results;
}
