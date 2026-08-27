#!/usr/bin/env node
/**
 * fake-claude.mjs — the "intelligence" drill mode fakes.
 *
 * Pinned through a booted instance's `daemon-config.json` (`execution.claudeBinaryPath`,
 * see drill.ts), so every spawn still goes through the real
 * findCliBinary → validateBinary → AgentRunner.spawnAgent → the quota governor →
 * the dispatcher's real accounting. Only the model is absent: this prints a
 * schema-valid canned reply, in the same `--output-format json` envelope shape
 * the real `claude` CLI produces, and exits 0.
 *
 * It switches ONLY on `LIGMA_SPAWN_ROLE` (set by runner.ts's `spawnAgent` from
 * `SpawnOptions.role` — see engine/security.ts's `buildSafeEnv`), never on the
 * prompt text: a role is typed at the source, and pattern-matching a prompt is
 * exactly the kind of "extract structured data from free text" this repo bans.
 *
 * NEVER used as acceptance evidence — a passing drill proves the seam (dispatch,
 * parsing, promote) does not crash, not that the product works. Real acceptance
 * still runs scripts/acceptance/run-campaign.ts against a real model.
 */

/**
 * One object per role, matching exactly what that role's real parser expects:
 *   - discovery: `discoveryReplySchema` (engine/discovery.ts) — needMore/form.
 *   - builder:   `parseCompletedSubtaskIds` (engine/prompt-builder.ts) reads
 *                `completedSubtaskIds` from the SOP's required fenced block.
 *   - persona:   `parsePersonaOutput` (harness/personas.ts) — goalAchieved/
 *                wrongTurns/findings.
 *   - judge:     `parseJudgeOutput` (harness/judge.ts) — criterionVerdicts/
 *                humanDecisions. Empty array is valid: unmatched criterion ids
 *                just stay "unknown" (fail-closed by construction).
 * Every other role (scheduled/inbox/triage/promote-plan/undeclared) gets a
 * generic empty object — nothing in this repo requires those roles to produce
 * fenced JSON to make progress.
 */
const CANNED = {
  discovery: { needMore: false, form: null },
  builder: { completedSubtaskIds: [] },
  persona: { goalAchieved: null, wrongTurns: 0, findings: [] },
  judge: { criterionVerdicts: [], humanDecisions: [] },
  //   - talk: `parseTalkReply` (packages/api/src/talk.ts) — reply/chips. The
  //     chip ids reference the demo seed's stable records (seed-demo/route.ts)
  //     so the engine's chip validation is exercised for real: one id that
  //     resolves (kept) and one that doesn't (dropped, logged).
  talk: {
    reply: "LIGMA_DRILL: canned talk reply. The landing page task is the closest open work.",
    chips: [
      { kind: "task", id: "task_demo_1" },
      { kind: "task", id: "task_does_not_exist" },
    ],
  },
};

const role = process.env.LIGMA_SPAWN_ROLE ?? "";
const payload = CANNED[role] ?? {};

const text =
  `LIGMA_DRILL: fake-claude reply for role="${role || "(none)"}". No model ran.\n\n` +
  "```json\n" +
  `${JSON.stringify(payload, null, 2)}\n` +
  "```\n";

// Shape A of the three real `claude -p --output-format json` envelopes
// (see personas.ts's `unwrapCliReply`): a single JSON object with a string
// `result` field, which is where the fenced block above gets found.
process.stdout.write(
  `${JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    result: text,
  })}\n`,
);
process.exit(0);
