# Phase 2 build contracts (conductor-pinned)

Shared agreements for the acceptance-harness build. `mission-control/scripts/harness/types.ts`
is the single source of truth for shared types — import it, never redeclare.

## Principles enforced in code (from the brief's §5)

1. Builder never writes `kanban: "done"` — only `applyVerdict()` in `scripts/harness/verdict.ts`
   may, and only on a passed `VerificationVerdict`. One choke point.
2. Contracts are frozen: compiled + Ed25519-signed before build; the judge verifies the signature
   before judging — a tampered contract fails verification hard. Builder spawns additionally get
   `--disallowedTools` for writes to `data/contracts/`.
3. Personas are black-box: they receive a browser-bridge URL and their contract slice inline in the
   prompt. Their `claude -p` spawn gets ONLY `Bash` allowed (the bridge is curl-able); no Read/Edit/
   Write. The bridge refuses navigation off the product origin.
4. Holdout: `buildTaskPrompt` injects only `!holdout` criteria; the panel tests 100%.
5. Structured output everywhere: personas and judge emit JSON (fenced); parse failure ⇒
   `invalid: true` ⇒ never a pass. No regex extraction from prose.
6. Judge model ≠ builder model — enforced in code (judge spawn passes an explicit `--model` that
   must differ from the builder's resolved model; refuse to run otherwise).

## File ownership (no two agents touch the same file)

| Owner | Files |
|---|---|
| conductor | `scripts/harness/types.ts`, `docs/CONTRACTS.md` |
| 2a contract compiler | `scripts/harness/{signing,contract-store,compile-contract}.ts`, `scripts/daemon/prompt-builder.ts` (visible-slice injection), tests |
| 2b harness runtime | `scripts/harness/{browser-bridge,personas,judge,verdict,run-verification}.ts`, `scripts/daemon/{run-task,dispatcher}.ts` (awaiting-verification pickup), tests |
| 2c evidence UI | `src/app/api/verification-runs/**`, `src/components/verification-*.tsx`, `src/components/task-detail-panel.tsx` (verification section), `src/app/launch/**` |

## Pinned decisions

- Evidence root: `mission-control/data/verification-runs/<runId>/` (layout documented in types.ts).
  Gitignored. Pruned by the same 72h discipline as run-outputs (verdicts + reports are kept:
  prune only `shots/`, `transcript.jsonl`, traces).
- Contract storage: `mission-control/data/contracts/<scope>.jsonl`, append-only, one
  `AcceptanceContract` per line; `<scope>` = taskId or productId. Editing a criterion = new version
  + requires an answered decision card (human approval).
- v1 contract source: compiled from the task's `acceptanceCriteria` + `description` by an LLM pass
  that rephrases into user-observable behaviour and proposes invariants; conversation-provenance
  fields populated when a planning conversation is supplied.
- Holdout split: deterministic hash of criterion id, ~30%, chosen at compile time, invariants are
  always holdout (the Saboteur's target list must not leak to the builder).
- Persona spawns: `claude -p` via `AgentRunner` (respects existing concurrency config), personas run
  with `--model` left at CLI default; judge runs with `--model opus`. Backend routing for cheap
  high-volume personas is Phase 3 (decision card raised for Alex).
- The browser bridge is an HTTP server bound to 127.0.0.1, one instance per verification run,
  proxy-locked to the env's origin; it records steps.jsonl + screenshots server-side so evidence
  exists even if the persona lies.
- Naive User runs 3× with distinct persona seeds, no shared memory (fresh sessions).
- Charter roster v1 (post-memo cuts): naive-user ×3, saboteur, returning-user, visual-critic
  (includes a11y rubric + axe-core call), spec-auditor. No separate regression prober / a11y agent.

## Amendments

Appended, never rewritten — a pinned decision that changed is still a decision that was made.

### 2026-08-13 — contracts are store data, not repo content

The "Contract storage" pin above is unchanged in *shape* and amended in *location and tracking*:

- **Location.** `mission-control/data/contracts/<scope>.jsonl` is now
  `<DATA_DIR>/contracts/<scope>.jsonl`, and `DATA_DIR` defaults to `~/.ligma/data`, outside any
  checkout (docs/DECISIONS.md, "Data root moves outside the checkout"). Only the dogfood instance —
  the daemon started from this repo through `apps/daemon/package.json`'s scripts — pins it back to
  `<repo>/data`, and does so with a visible `LIGMA_DATA_DIR=` prefix.
- **Tracking.** `apps/daemon/src/harness/contract-store.ts` claimed contracts "ARE tracked in git
  (pinned decision, docs/CONTRACTS.md)". Nothing in this file ever said that, and the claim is now
  retired outright: contracts are gitignored. What made them worth tracking — reviewability and an
  audit trail — is served by the file being append-only and every line being Ed25519-signed and
  verified before it is judged. What tracking actually bought was a repo that accumulated live
  product evidence and stray test output.
- **Committed samples.** The contract JSONL files that had accumulated under `data/contracts/` are
  no longer part of the store's history. The two real ones are kept as regression fixtures under
  `apps/daemon/__tests__/fixtures/contracts/`; the ten `test_*.jsonl` files were test output that
  had leaked into the real store and are simply untracked.

Unchanged by this: the builder is still denied writes to the contracts directory
(`apps/daemon/src/engine/config.ts`'s `CONTRACTS_GLOB` resolves through `DATA_DIR`, so the deny
rule follows the store wherever it lands).
