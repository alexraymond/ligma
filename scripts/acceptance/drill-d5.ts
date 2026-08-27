/**
 * drill-d5.ts — the conversation seams (phase 2): Talk and the discovery
 * thread, at zero tokens.
 *
 * DRILL — NOT ACCEPTANCE EVIDENCE. Proves the plumbing, never the product:
 *
 *  1. Talk (UX spec §10): POST a thread message → the daemon dispatches a
 *     respond run through the governor's "human" role → fake-claude (role
 *     "talk", switched on LIGMA_SPAWN_ROLE, never prompt text) returns a
 *     canned reply carrying one chip that resolves (task_demo_1) and one that
 *     doesn't — the engine must keep the first and drop the second, and the
 *     daemon (never the model) writes the store.
 *  2. Discovery thread (brief §Phase 2): ask → skip ("You decide" is the
 *     escape affordance a required question actually offers) → answer → lock
 *     → edit one answer through the amend path → the consequence is recorded:
 *     an answered DecisionItem with `consequenceTaskIds`, `staleFlaggedAt` on
 *     the locked brief, and the stale-brief card firing on the deck.
 *
 * Discovery uses the daemon-side stub (LIGMA_DISCOVERY_STUB=1) — the same
 * fixed one-question form the e2e lane uses — so the walk is deterministic.
 */

import { YOU_DECIDE } from "../../packages/api/src/briefs";
import { bootLigma, type BootedLigma } from "./booted-ligma";
import { FAKE_CLAUDE } from "./drill-d1";
import { call, createStepRunner, type StepResult } from "./drill-support";

interface TalkChip {
  kind: string;
  id: string;
  label?: string;
}
interface TalkMessage {
  id: string;
  author: string;
  body: string;
  chips?: TalkChip[];
}
interface BriefQuestion {
  id: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
}
interface BriefTurn {
  form: { id: string; questions: BriefQuestion[] };
  answers: Record<string, unknown> | null;
}
interface BriefBody {
  brief?: { status: string; turns: BriefTurn[]; staleFlaggedAt: string | null };
}

const TALK_PROJECT = "proj_demo_1";
const LIVE_CHIP_TASK = "task_demo_1"; // seed-demo's landing-page task; fake-claude cites it plus one dead id

async function pollForReply(api: string, timeoutMs: number): Promise<TalkMessage | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await call(`${api}/api/projects/${TALK_PROJECT}/talk`);
    const messages = ((res.body as { messages?: TalkMessage[] })?.messages ?? []) as TalkMessage[];
    const reply = messages.find((m) => m.author !== "you");
    if (reply) return reply;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function runD5(): Promise<StepResult[]> {
  const { results, step, fail } = createStepRunner("");

  let instance: BootedLigma | null = null;
  let api = "";
  let briefProjectId = "";
  let formId = "";
  let shapeChoice = "";
  let amendDecisionId = "";

  try {
    console.log("[drill:d5] booting an ephemeral ligma seeded with demo data (discovery stubbed)...");
    instance = await bootLigma({
      seed: "demo",
      stub: false,
      configOverrides: { execution: { claudeBinaryPath: FAKE_CLAUDE } },
      extraEnv: { LIGMA_DISCOVERY_STUB: "1" },
    });
    api = instance.daemonUrl;
    console.log(`[drill:d5] booted — web ${instance.url}, daemon ${api}, data ${instance.dataDir}\n`);

    // ── Talk ────────────────────────────────────────────────────────────────
    await step(
      "POST /api/projects/:id/talk — the human message lands in the store",
      async () => {
        const res = await call(`${api}/api/projects/${TALK_PROJECT}/talk`, {
          method: "POST",
          body: { body: "What should I look at next?" },
        });
        if (res.status !== 200 && res.status !== 201) {
          throw new Error(`expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        return "message appended";
      },
    );

    await step(
      "the reply arrives via the governor's human role, and only the chip that resolves survives",
      async () => {
        const reply = await pollForReply(api, 30_000);
        if (!reply) throw new Error("no reply appeared within 30s");
        if (!reply.body || reply.body.trim() === "") throw new Error("reply body is empty");
        const chips = reply.chips ?? [];
        const ids = chips.map((c) => c.id);
        if (!ids.includes(LIVE_CHIP_TASK)) {
          throw new Error(`expected surviving chip ${LIVE_CHIP_TASK}, got [${ids.join(", ")}]`);
        }
        if (ids.includes("task_does_not_exist")) {
          throw new Error("dead chip task_does_not_exist was not dropped");
        }
        // The chip must resolve against the store, not just look plausible.
        const tasks = await call(`${api}/api/tasks`);
        const items = ((tasks.body as { tasks?: Array<{ id: string }> })?.tasks ?? []) as Array<{ id: string }>;
        if (!items.some((t) => t.id === LIVE_CHIP_TASK)) {
          throw new Error(`chip ${LIVE_CHIP_TASK} does not resolve to a stored task`);
        }
        return `reply with ${chips.length} chip(s); ${LIVE_CHIP_TASK} resolves, dead chip dropped`;
      },
    );

    await step(
      "remember on a repo-less project refuses with a plain reason (409), never silently",
      async () => {
        const thread = await call(`${api}/api/projects/${TALK_PROJECT}/talk`);
        const messages = ((thread.body as { messages?: TalkMessage[] })?.messages ?? []) as TalkMessage[];
        const mine = messages.find((m) => m.author === "you");
        if (!mine) throw new Error("own message not found in thread");
        const res = await call(`${api}/api/projects/${TALK_PROJECT}/talk/remember`, {
          method: "POST",
          body: { messageId: mine.id },
        });
        if (res.status !== 409) throw new Error(`expected 409 for a repo-less project, got ${res.status}`);
        return "409 with a stated reason";
      },
    );

    // ── Discovery thread ────────────────────────────────────────────────────
    await step(
      "ask — POST /api/briefs opens the stub form (audience + the shape question)",
      async () => {
        const res = await call(`${api}/api/briefs`, {
          method: "POST",
          body: { prompt: "A tiny CLI that renames photos by their EXIF date" },
        });
        if (res.status !== 200 && res.status !== 201) {
          throw new Error(`expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        const body = res.body as { brief?: { projectId?: string }; project?: { id?: string } };
        briefProjectId = body.brief?.projectId ?? body.project?.id ?? "";
        if (!briefProjectId) throw new Error(`no project id in response: ${JSON.stringify(res.body)}`);

        const briefRes = await call(`${api}/api/projects/${briefProjectId}/brief`);
        const turns = (briefRes.body as BriefBody).brief?.turns ?? [];
        const open = turns.find((t) => t.answers === null);
        if (!open) throw new Error("no open discovery turn");
        formId = open.form.id;
        const qids = open.form.questions.map((q) => q.id);
        if (!qids.includes("audience") || !qids.includes("shape")) {
          throw new Error(`expected audience+shape questions, got [${qids.join(", ")}]`);
        }
        const shapeQ = open.form.questions.find((q) => q.id === "shape")!;
        shapeChoice = shapeQ.options[0] ?? "";
        if (!shapeChoice) throw new Error("shape question has no options");
        return `form ${formId} open with [${qids.join(", ")}]`;
      },
    );

    await step(
      'skip + answer — "You decide" on the required question, a real answer on the shape',
      async () => {
        const res = await call(`${api}/api/projects/${briefProjectId}/brief/answers`, {
          method: "POST",
          body: { formId, answers: { audience: YOU_DECIDE, shape: shapeChoice } },
        });
        if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        return `answered — audience left to the system (${YOU_DECIDE}), shape=${shapeChoice}`;
      },
    );

    await step(
      "lock — the brief freezes",
      async () => {
        const res = await call(`${api}/api/projects/${briefProjectId}/brief`, {
          method: "PATCH",
          body: { lock: true },
        });
        if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        return "locked";
      },
    );

    await step(
      "edit one answer — the amend path applies it and reports the consequence",
      async () => {
        const res = await call(`${api}/api/projects/${briefProjectId}/brief/amend`, {
          method: "POST",
          body: { formId, questionId: "audience", answer: "Weekend photographers" },
        });
        if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        const body = res.body as { ok?: boolean; decisionId?: string; staleFlagged?: boolean };
        if (!body.ok || !body.decisionId) throw new Error(`no decisionId in ${JSON.stringify(res.body)}`);
        if (body.staleFlagged !== true) throw new Error("locked brief did not report staleFlagged");
        amendDecisionId = body.decisionId;
        return `amended; decision ${amendDecisionId}, staleFlagged=true`;
      },
    );

    await step(
      "consequence recorded — answered decision with consequenceTaskIds, stale flag on the brief, card on the deck",
      async () => {
        const decisions = await call(`${api}/api/decisions`);
        const rows = ((decisions.body as { decisions?: Array<Record<string, unknown>> })?.decisions ?? []) as Array<
          Record<string, unknown>
        >;
        const row = rows.find((d) => d.id === amendDecisionId);
        if (!row) throw new Error(`decision ${amendDecisionId} not found`);
        if (row.status !== "answered") throw new Error(`decision status is ${String(row.status)}, not answered`);
        if (!Array.isArray(row.consequenceTaskIds)) {
          throw new Error("consequenceTaskIds is not recorded on the decision");
        }

        const briefRes = await call(`${api}/api/projects/${briefProjectId}/brief`);
        const stale = (briefRes.body as BriefBody).brief?.staleFlaggedAt ?? null;
        if (!stale) throw new Error("staleFlaggedAt not set on the locked brief");

        const deck = await call(`${api}/api/deck`);
        const cards = ((deck.body as { cards?: Array<{ kind: string; projectId: string | null }> })?.cards ?? []) as Array<{
          kind: string;
          projectId: string | null;
        }>;
        if (!cards.some((c) => c.kind === "stale-brief" && c.projectId === briefProjectId)) {
          throw new Error("stale-brief card did not fire for the amended project");
        }
        return "decision + consequenceTaskIds + staleFlaggedAt + deck card all present";
      },
    );
  } catch (err) {
    fail("d5 setup/teardown", err instanceof Error ? err.message : String(err));
  } finally {
    if (instance) {
      console.log("\n[drill:d5] tearing down the ephemeral instance...");
      await instance.stop();
    }
  }

  return results;
}
