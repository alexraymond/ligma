/**
 * drill.ts — zero-token acceptance drills for the daemon's build/design/deck
 * seams (build brief §7's D1, D2, D4).
 *
 * DRILL — NOT ACCEPTANCE EVIDENCE. A drill never proves the product works; it
 * proves the plumbing (dispatch, arg/env construction, reply parsing, promote,
 * the deck's PATCH/undo journal) does not crash. A real campaign
 * (scripts/acceptance/run-campaign.ts) is the only thing that may be reported
 * as acceptance evidence.
 *
 * Each drill boots its own REAL ephemeral ligma — real daemon, real web, real
 * HTTP routes, real promote/contract-signing — and fakes only the
 * intelligence (fake-claude for CLI spawns, LIGMA_STUB_STUDIO for the SDK-only
 * studio wire). See drill-d1.ts / drill-d2.ts / drill-d4.ts for the seam each
 * one exercises and why it needs no real model.
 *
 * Run all three: `npx tsx scripts/acceptance/drill.ts`
 * Run one:       `npx tsx scripts/acceptance/drill.ts d2`
 * Run several:   `npx tsx scripts/acceptance/drill.ts d1 d4`
 */

import { runD1 } from "./drill-d1";
import { runD2 } from "./drill-d2";
import { runD4 } from "./drill-d4";
import { runD5 } from "./drill-d5";
import { runD6 } from "./drill-d6";
import { printSummary, type StepResult } from "./drill-support";

const DRILLS: Record<string, { title: string; run: () => Promise<StepResult[]> }> = {
  d1: { title: "D1 — headless greenfield dispatch seam", run: runD1 },
  d2: { title: "D2 — studio design loop", run: runD2 },
  d4: { title: "D4 — the daily loop (Deck)", run: runD4 },
  d5: { title: "D5 — the conversation seams (Talk + discovery thread)", run: runD5 },
  d6: { title: "D6 — fresh-install walkthrough (composer → consequence)", run: runD6 },
};

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const ids = requested.length > 0 ? requested : Object.keys(DRILLS);

  const unknown = ids.filter((id) => !(id in DRILLS));
  if (unknown.length > 0) {
    console.error(`Unknown drill(s): ${unknown.join(", ")}. Known: ${Object.keys(DRILLS).join(", ")}`);
    process.exit(1);
  }

  console.log("DRILL — not acceptance evidence. Zero-token seam check(s) against fake-claude / LIGMA_STUB_STUDIO.");
  console.log(`Running: ${ids.join(", ")}\n`);

  let anyFailed = false;
  for (const id of ids) {
    const drill = DRILLS[id];
    console.log(`\n########## ${id.toUpperCase()} — ${drill.title} ##########\n`);
    const drillResults = await drill.run();
    const failed = printSummary(id.toUpperCase(), drillResults);
    anyFailed = anyFailed || failed;
  }

  console.log(`\n=== OVERALL — not acceptance evidence ===`);
  console.log(anyFailed ? "ONE OR MORE DRILLS FAILED — not acceptance evidence either way." : "ALL DRILLS PASSED — not acceptance evidence.");
  process.exit(anyFailed ? 1 : 0);
}

if (require.main === module) {
  void main();
}
