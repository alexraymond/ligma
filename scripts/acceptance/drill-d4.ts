/**
 * drill-d4.ts — zero-token acceptance drill for the D4 (the daily loop / Deck)
 * seam.
 *
 * DRILL — NOT ACCEPTANCE EVIDENCE. Same discipline as drill-d1.ts and
 * drill-d2.ts: a REAL ephemeral ligma, seeded with the repo's own demo data
 * (`seed: "demo"` runs `apps/daemon/scripts/seed-demo.ts` against the
 * instance's throwaway data dir — see `.ligma/boot.json`'s `seed` command).
 * No model wire is on this path at all — decisions are plain CRUD — so there
 * is nothing to stub; `execution.claudeBinaryPath` is still pinned at
 * fake-claude defensively, same reasoning as d2: a stray dispatcher tick must
 * never be able to reach a real `claude` process.
 *
 * TWO GAPS CLOSED (Wave 2, Q3) — this drill used to reproduce both by hand;
 * it now drives the real server capabilities:
 *
 *  1. There is now one server-side queue route, `GET /api/deck`
 *     (apps/daemon/src/routes/deck/route.ts), that composes every Deck card
 *     kind — decisions, design approvals, stale briefs, pending promotions,
 *     adoption reviews, verdict spot-checks — the same way
 *     apps/web/src/lib/deck-cards.ts's `buildDeckCards` used to, just
 *     server-side. The demo seed plants four of the six kinds (decision,
 *     design-approval, stale-brief, verdict-spot-check — see seed-demo.ts's
 *     "the other three Deck card kinds" section), so this drill's first step
 *     asserts the composed queue actually contains all four rather than only
 *     the decisions the old drill could see through `/api/decisions`.
 *
 *  2. There is now a real batch endpoint, `PATCH /api/decisions/bulk`
 *     (apps/daemon/src/routes/decisions/bulk/route.ts), that answers N
 *     decisions in one atomic server round-trip instead of the Deck's old
 *     client-side loop of N sequential single PATCHes. This drill's batch
 *     step drives that endpoint directly and also replays the identical
 *     batch to prove it fails idempotently (already-answered, not
 *     re-answered) rather than double-applying.
 */

import type { DecisionItem } from "../../packages/api/src/types";
import { bootLigma, type BootedLigma } from "./booted-ligma";
import { FAKE_CLAUDE } from "./drill-d1";
import { call, createStepRunner, type StepResult } from "./drill-support";

interface DeckCard {
  id: string;
  kind: string;
  decision: DecisionItem | null;
}

interface DeckResponse {
  cards: DeckCard[];
  meta: { total: number; byKind: Record<string, number> };
}

interface DeckPatchResponse {
  decision: DecisionItem;
  undoExpiresAt?: string;
}

interface BulkDecisionsResponse {
  results: Array<
    | { id: string; ok: true; undoExpiresAt: string }
    | { id: string; ok: false; error: string }
  >;
  succeeded: number;
  failed: number;
}

const BATCH_SIZE = 5;
// The demo seed plants these alongside its 12 decisions (seed-demo.ts). Their
// presence is how this drill knows GET /api/deck actually composed from
// every source rather than only decisions.
const EXPECTED_OTHER_KINDS = ["design-approval", "stale-brief", "verdict-spot-check"] as const;

export async function runD4(): Promise<StepResult[]> {
  const { results, step, fail } = createStepRunner("");

  let instance: BootedLigma | null = null;
  let api = "";
  let seedDecisionId = "";
  let batchIds: string[] = [];

  try {
    console.log("[drill:d4] booting an ephemeral ligma seeded with demo data...");
    instance = await bootLigma({
      seed: "demo",
      stub: false,
      configOverrides: { execution: { claudeBinaryPath: FAKE_CLAUDE } },
    });
    api = instance.daemonUrl;
    console.log(`[drill:d4] booted — web ${instance.url}, daemon ${api}, data ${instance.dataDir}\n`);

    await step(
      "the tray is the surface (phase 1): /needs-you serves, /deck and /inbox hand off to it",
      async () => {
        const tray = await fetch(`${instance!.url}/needs-you`);
        if (tray.status !== 200) throw new Error(`/needs-you answered ${tray.status}`);
        for (const legacy of ["/deck", "/inbox"]) {
          const res = await fetch(`${instance!.url}${legacy}`);
          const body = await res.text();
          // Server redirect() lands on the tray directly; a prerendered page
          // ships the target in its meta refresh. Either way the tray's path
          // must be in what came back.
          if (res.status !== 200 || !body.includes("/needs-you")) {
            throw new Error(`${legacy} did not hand off to /needs-you (status ${res.status})`);
          }
        }
        return "/needs-you 200; /deck and /inbox both hand off";
      },
    );

    await step(
      "GET /api/deck — the one composed queue (gap #1 closed): counts agree, every seeded card kind is present, ≥10 pending decisions (batch mode needs to be reachable)",
      async () => {
        const res = await call(`${api}/api/deck`);
        if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        const body = res.body as DeckResponse;
        if (body.meta.total !== body.cards.length) {
          throw new Error(`meta.total (${body.meta.total}) disagrees with the card list length (${body.cards.length})`);
        }

        const kinds = new Set(body.cards.map((c) => c.kind));
        for (const expected of EXPECTED_OTHER_KINDS) {
          if (!kinds.has(expected)) {
            throw new Error(`expected a "${expected}" card from the demo seed, got kinds [${[...kinds].join(", ")}]`);
          }
        }

        const decisionCards = body.cards.filter((c) => c.kind === "decision");
        if (decisionCards.length < 1 + BATCH_SIZE) {
          throw new Error(`expected the demo seed's own ≥10 pending decisions, got ${decisionCards.length}`);
        }
        seedDecisionId = decisionCards[0].decision!.id;
        batchIds = decisionCards.slice(1, 1 + BATCH_SIZE).map((c) => c.decision!.id);
        return `${body.cards.length} card(s) across kinds [${[...kinds].join(", ")}], meta agrees — single-answer target ${seedDecisionId}, batch targets [${batchIds.join(", ")}]`;
      },
    );

    await step("answer the decision — the server's undo journal opens with a real deadline", async () => {
      const res = await call(`${api}/api/decisions`, {
        method: "PATCH",
        body: { id: seedDecisionId, action: "answer", answer: "CSS animations only (lightweight)" },
      });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const body = res.body as DeckPatchResponse;
      const expiresAt = body.undoExpiresAt ? Date.parse(body.undoExpiresAt) : NaN;
      if (body.decision.status !== "answered" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error(`expected an answered decision with a future undoExpiresAt, got ${JSON.stringify(body)}`);
      }
      return `answered, undoExpiresAt ${body.undoExpiresAt} (server-derived, ${expiresAt - Date.now()}ms out)`;
    });

    await step("undo within the window — the decision reverts to pending", async () => {
      const res = await call(`${api}/api/decisions`, { method: "PATCH", body: { id: seedDecisionId, action: "undo" } });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const body = res.body as DeckPatchResponse;
      if (body.decision.status !== "pending" || body.decision.answer !== null) {
        throw new Error(`expected the decision reverted to pending with no answer, got ${JSON.stringify(body.decision)}`);
      }
      return `reverted — status "${body.decision.status}", answer ${JSON.stringify(body.decision.answer)}`;
    });

    await step("re-answer and let it stand", async () => {
      const res = await call(`${api}/api/decisions`, {
        method: "PATCH",
        body: { id: seedDecisionId, action: "answer", answer: "CSS animations only (lightweight)" },
      });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      const body = res.body as DeckPatchResponse;
      if (body.decision.status !== "answered") throw new Error(`expected it to stick, got ${JSON.stringify(body.decision)}`);
      return `answered and left standing`;
    });

    await step(
      "PATCH /api/decisions/bulk (gap #2 closed) — one atomic call answers 5 decisions; replaying the identical batch fails idempotently instead of double-applying",
      async () => {
        const before = await call(`${api}/api/deck`);
        const pendingBefore = (before.body as DeckResponse).cards.filter((c) => c.kind === "decision").length;

        const items = batchIds.map((id) => ({ id, action: "dismiss" as const }));
        const res = await call(`${api}/api/decisions/bulk`, { method: "PATCH", body: { items } });
        if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        const body = res.body as BulkDecisionsResponse;
        if (body.succeeded !== BATCH_SIZE || body.failed !== 0) {
          throw new Error(`expected all ${BATCH_SIZE} to succeed on the first pass, got ${JSON.stringify(body)}`);
        }

        // Idempotency: the same batch, replayed. Every item is now
        // not-pending, so this must fail cleanly per item, not re-apply.
        const replay = await call(`${api}/api/decisions/bulk`, { method: "PATCH", body: { items } });
        const replayBody = replay.body as BulkDecisionsResponse;
        if (replayBody.succeeded !== 0 || replayBody.failed !== BATCH_SIZE) {
          throw new Error(`expected the replayed batch to fail idempotently (0 succeeded), got ${JSON.stringify(replayBody)}`);
        }

        const after = await call(`${api}/api/deck`);
        const pendingAfter = (after.body as DeckResponse).cards.filter((c) => c.kind === "decision").length;
        if (pendingAfter !== pendingBefore - BATCH_SIZE) {
          throw new Error(`expected the pending queue to drop by ${BATCH_SIZE} (${pendingBefore} → ${pendingBefore - BATCH_SIZE}), got ${pendingAfter}`);
        }
        return `${BATCH_SIZE} decisions cleared via ONE PATCH /api/decisions/bulk call, replay correctly no-opped (0 succeeded/${BATCH_SIZE} failed), queue ${pendingBefore} → ${pendingAfter}`;
      },
    );
  } catch (err) {
    fail("unexpected failure", err instanceof Error ? err.message : String(err));
  } finally {
    if (instance) {
      console.log("\n[drill:d4] tearing down the ephemeral instance...");
      await instance.stop();
    }
  }

  return results;
}
