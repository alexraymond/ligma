# Fix campaign contracts — 2026-08-27

Remediation of all findings in the three 2026-08-27 audits (`codebase-audit`, `docs-audit`,
`process-audit`, same directory). Conductor: top-level session. Everything lands
**uncommitted** — the maintainer owns git. No commits, no pushes, no branch changes.

## Lanes and file ownership (no two concurrent lanes edit the same file)

| Lane | Owns (exclusively) | Does NOT touch |
|---|---|---|
| **A1 — daemon engine+store** | `apps/daemon/src/engine/**`, `apps/daemon/src/store/data.ts` (+ colocated tests) | routes, harness, studio, `package.json`, `data/**` contents, docs |
| **A2 — daemon harness+routes+studio** | `apps/daemon/src/harness/**`, `routes/**`, `studio/**`, `env/**`, `store/` except `data.ts`, `server.ts`, `http.ts`, `mcp-server.ts`, `notify.ts`, `paths.ts`, `packages/api/src/**` | `engine/**`, `store/data.ts`, `package.json`, `data/**` contents, docs |
| **B — web** | `apps/web/src/**`, `apps/web/e2e/**`, `apps/web/*.ts` config files | `apps/web/*.md`, `packages/**`, daemon |
| **C — packages** | `packages/**` EXCEPT `packages/api` (lane A's), incl. package-local READMEs/entry headers | `packages/api`, apps |
| **D — docs & repo hygiene** | all `*.md` outside `packages/` and `apps/desktop/`, `docs/**` (incl. `git mv` into `docs/history/`), `.gitignore`, `.github/**`, root `package.json`, `CHANGELOG.md`, `README.md`, `craft/`, `skills/*.md`, `design-systems/README.md`, `design-templates/AGENTS.md`, `apps/web/*.md` (incl. deleting `DEPLOYMENT.md`), `examples/`, `scripts/setup-branch-protection.sh` | source code, `apps/desktop/**` |
| **E — desktop, CLI, scripts** | `apps/desktop/**` (incl. its new README), `apps/cli/**`, `scripts/*.ts`, `scripts/*.mjs`, `scripts/*.js` | daemon, web, packages, root config |

`git mv` for the docs/history move is allowed (it stages the rename; that is acceptable —
do not commit).

## Pinned decisions (defaults chosen where an audit offered options; Alex can reverse)

1. **`data/` tracking (X1/D4/P11):** keep the dogfood pin and the tracked seed files.
   Fix = reword README's false sentence + add `data/needs-you-pings.json`,
   `data/task-checkpoints.json` (and a comment about adding future stores) to the
   dogfood gitignore block. Do NOT edit the contents of any `data/*.json` (it's Alex's
   live store). X11 (automation-ON defaults in tracked config) is flagged, not changed.
2. **Frozen matrices (D3/D19/D20/D27/D28):** freeze banners + a short "overtaken events"
   addendum. No row-by-row edits of parity/completeness matrices.
3. **Legacy artifacts (D16):** `git mv` into `docs/history/` with a 5-line README index.
4. **Store integrity (R1/R3/P1/P3):** no SQLite. All mutating store access in
   `store/data.ts` goes through the existing cross-process `withFileLock` + write via
   temp-file+rename. Strict mutate helpers get the same missing-file fallback as
   `readOrDefault`. `run-task.ts` active-runs writes take the same lock.
5. **Packages kept:** `deez`, `nuts`, `templates`, and the desktop app are NOT deleted.
   Desktop gets a README (lane E) and its specific security fixes.
6. **P20 hardening:** mutating daemon routes require `content-type: application/json`
   (form posts can't send it). No auth token added; local-first posture gets documented
   instead (lane D, configuration doc).
7. **Rebrand residue (P21 etc.):** wave 1 fixes only the outbound User-Agent URL. The
   broader `Codesign*` identifier rename is wave 2 (single sequential agent), keeping
   `CODESIGN_CHROME_PATH` readable as a legacy alias.
8. **CI (X4):** minimal `.github/workflows/ci.yml` — pnpm install, lint, typecheck,
   unit tests (no e2e, no release). `setup-branch-protection.sh` check names aligned to
   the workflow's job names. Dead changeset toolchain removed from root `package.json`.

## Cross-lane seams (exact contracts)

- **S1 — run-output SSE errors (A↔E, fixes D6/P14):** when the poll route returns
  non-2xx, `routes/runs/[id]/output/stream` emits an SSE frame
  `data: {"error": "<message>", "status": <httpStatus>}` with `event: error`, then ends.
  The CLI's `runs tail` prints the error to stderr and exits 1 on an `error` frame.
- **S2 — spot-check server persistence (A↔B, fixes P9):** lane A adds store
  `spot-check-reviews.json` + registry route `POST /api/deck/spot-check`
  (body `{taskId, runId, answer: "confirmed" | "disputed"}`), the deck route excludes
  reviewed cards and cards whose task/run rows no longer exist. Lane B replaces the
  localStorage mechanism with calls to that route.
- **S3 — deck-card constants (A↔B, fixes W10):** lane A hoists the deck-card option
  display strings into exported constants in `packages/api` (with the daemon's
  `buildDeckCards` as the single implementation, tests daemon-side). Lane B deletes
  `apps/web/src/lib/deck-cards.ts` (the drifted duplicate) and its tests, importing the
  constants from `@ligma/api`.
- **S4 — provider PATH resolution (C, fixes D5-codebase):** lives in
  `packages/providers` — lane C only; lane E does not patch around it in desktop code.
- **S5 — stale-retry double-build (A1↔A2, fixes P7):** A1 makes the retry queue drop a
  task's pending entries on any terminal settle and re-check `kanban === "not-started"`
  at fire time; A2 removes the `verificationAttempts = 0` reset from the builder settle
  path in `harness/verdict.ts` (~:239). No shared file.
- **S6 — cap-card consumption latency (A1↔A2, fixes P16):** A1 exports a callable
  `consumeAnsweredCapCardsNow()` from the engine; A2 invokes it from the decisions
  answer route after a successful answer write. The poll cycle remains the backstop.
- **Reassignment note:** codebase P3 (web tweaks-bridge never ported into the web
  srcdoc) belongs to lane B, not C. Codebase E9/E10 (`engine/run-inbox-respond.ts`,
  `run-brain-dump-triage.ts`) belong to A1.

## Ground rules for every lane

- Read your audit report sections in full before editing; the finding's "Direction" line
  is the spec. Deviating from it requires a written reason in your report.
- No new dependencies without a written justification in your report.
- Never mark a finding fixed without a runnable check: run the tests you touched and the
  area test suite; report commands + exit codes + output tails honestly.
- Skips are legitimate (a finding that needs a maintainer decision, or is wave-2), but
  every skip must be listed with its reason.
- Follow repo style: TypeScript strict, no `any`, structured output over regex-on-prose.

---

# Outcome (appended at campaign close, 2026-08-27)

**Verified final state** — lint 0 errors (1204 files, full coverage after X12), typecheck
16/16 uncached, unit suites all green (daemon 153 files/1602, web 84/711, desktop 74/968,
cli 8, api 41, packages all green), daemon integration 15 files/137. Everything
uncommitted: 899 modified files (+18 staged renames into docs/history/), dominated by the
biome reformat; the behavioral diff is far smaller.

**Waves:** 6 parallel fix lanes → 3 cross-cutting wave-2 agents → 3 independent
fresh-context validators (one empirical, against a live throwaway daemon) → 5 residual
agents fixing everything actionable the validators surfaced (including 3 defects in the
campaign's own fixes: e2e selectors, a `..` allowlist bypass, an unreachable deck-format
override) → verdict async-lock migration → biome coverage expansion with unsafe-autofix
audit.

**Consciously NOT fixed (maintainer decisions)** — see the final campaign report in the
conversation: E18 verdict-key trust model; TweakSchema unification (blocked on
@ligma/api's zero-deps design); W18 duplicate search UIs; D12 desktop arbitrary-path IPC
trust boundary; X9 evidence-locker size/LFS; X20 missing git remote; X11 automation-ON
tracked config (flagged in docs/README.md); D23 ai-context twin tracking; D36 upstream
voice in vendored rule bodies (flagged); package version incoherence; saveConfig
self-heal sync lock (narrow window, rationale in code); desktop dead updater IPC surface.
Known ceilings marked in-code with ponytail: comments — read-url DNS rebinding,
inline-whitespace collapse in HTML prettify, bilingual keyword tables.

**Not executed:** the rewritten e2e specs (parse-verified, typechecked, selectors
verified against source; playwright now targets a throwaway data dir — run once locally:
`pnpm --filter @ligma/web run test:e2e`).
