# Upstream feature tracking

The recurring counterpart to the one-shot D7 parity audits and the Phase-2
harvest memo: which live upstreams we watch, the commit each was last reviewed
at, and what each review adopted or skipped. Move a repo's pin forward only
after its delta has actually been read.

## Tracked repos

| Repo | Role | Last reviewed at | Status |
| ---- | ---- | ---------------- | ------ |
| `nexu-io/open-design` | Parent: vendored `craft/`, `design-systems/`, `skills/`, `assets/frames/`; capability-parity source ([open-design-capabilities.md](open-design-capabilities.md)) | `d5aa10029` (2026-08-26) | **Active** — high commit velocity |
| `builderz-labs/mission-control` | Harvest source ([../history/harvest.md](../history/harvest.md)) | `5483a0e` (2026-08-24) | **Active** — low velocity |
| `crshdn/mission-control` | Harvest source | `24d2863` (2026-07-06) | Dormant — nothing since before the 2026-08-10 harvest |
| `MeisnerDan/mission-control` | Original mission-control upstream | `2b8c402` (2026-04-01) | Dormant |

## How to run a review

1. Fetch each repo (local checkout of open-design lives at
   `~/open-design`; the mission-control forks are shallow-cloned on demand —
   `git clone --single-branch --shallow-since=<pin date> https://github.com/<repo>.git`).
   Caveat: as of this writing that working tree's HEAD sits at the old
   `eefe796` pin; `d5aa100` above is fetch-only — run `git fetch` in
   `~/open-design` before diffing against it.
2. `git log <pin>..origin/main` — group commits into features, verify each
   against code before judging it, then classify: adopt / candidate / skip.
3. For open-design, split the delta: vendored dirs (mechanical sync, below)
   vs. app-level (feature judgment against Ligma's own architecture).
4. Record the review here, update the pins, commit each adoption separately.

### Vendored-dir sync procedure (open-design)

- `assets/frames/` and `craft/`: wholesale rsync with `--delete`, excluding
  each dir's Ligma-added `LICENSE`.
- `design-systems/`: same, but **`_schema/manifest.schema.ts` must be
  hand-merged** — Ligma adds an `authored?: boolean` field (plus its
  `ALLOWED_TOP_LEVEL_KEYS` entry) that the in-app wizard writes and the
  design-systems routes read. A blind overwrite silently breaks the wizard.
- `skills/`: sync only the vendored set, then re-derive the license audit —
  vendor any new Apache-2.0 skill, add new non-Apache skills to the NOTICE.md
  exclusion list, and re-check existing exclusions (licenses change).
- Update NOTICE.md counts; finish with `rg -i 'open.codesign'` over the four
  dirs (must be zero hits — see docs/DECISIONS.md 2026-08-13).
- Policy (decided 2026-08-26): upstream prose inside vendored files is taken
  verbatim, including upstream's own product name — vendored content is
  attributed third-party material, not Ligma copy.

---

## Review log

### 2026-08-26 — pins moved from the 2026-08-10/11 baselines

Delta sizes: open-design 240 commits (`eefe796..d5aa100`), builderz-labs 9
commits, crshdn 0, MeisnerDan 0.

**Adopted**

| Feature | From | Landed as |
| ------- | ---- | --------- |
| Vendored-dir refresh: Cloudflare Kumo UI design system (`888e1e8`), skill/craft prose updates, product-name unification (`f1a0b60`) | open-design | `0390282` |
| Structure-only layout primitives — a ~50-line structural stylesheet the design-generation agent copies verbatim instead of re-deriving layout rules; kills the stacked-span / distorted-media / un-clamped-text class of generation bugs (`f1a73f0`) | open-design | `5b852df` — `studio/layout.ts` prompt fact |
| MCP stdio idle-exit — orphaned stdio MCP servers exit after a configurable idle period; Ligma's `mcp-server.ts` previously had no disconnect or idle handling at all (`bc93dfe`) | open-design | `c32d6ac` — plus exit-on-stdin-close, which the MCP SDK never does itself |
| Checkpoint/resume for long-running tasks — agents record durable phases to `data/task-checkpoints.json` (decisions.json idiom); re-attempts get a fenced "Resuming Prior Progress" prompt block and verify artifacts before trusting them; pruned per poll cycle once tasks are done | crshdn `recovery.ts` pattern, harvest item 13 (backlog, not a live delta) | `engine/checkpoints.ts` + prompt-builder + dispatcher sweep |

### 2026-08-27 addendum — the parity push

The studio-od-parity roadmap (docs/superpowers/specs/) executed phases 1–8
against the same `d5aa100` pin; two more vendored surfaces arrived:
`apps/web/src/components/studio/visual-styles.ts` (style-catalog data) and
`design-templates/` (113 template dirs, 36 themes; upstream's own landing
page pruned — it carried upstream-lineage prose excluded by policy — along
with upstream CI render output, 38MB→8MB). NOTICE rows added for both.
The former candidates "anti-slop linter" and "capability booleans" remain
open; "OD Next" remains a watch item.

**Candidates — tracked, not yet adopted**

- **OD Next** (open-design `7320f9b`, `0944e17`, ~27 new files under
  `apps/daemon/src/strategies/od-next/`): a deterministic plan-then-execute
  protocol around the coding agent — ranked-source requirement resolution with
  per-field ask/block/default policy, machine-block (JSON contract) extraction
  with exactly-one bounded repair, plan hash-pinned to task profile + strategy
  version. Upstream shipped it default-on, then walked it back to opt-in. The
  architecture is the interesting part for Ligma's Brief→Studio flow; too
  large and too coupled to their task store to port. Re-check next review
  whether it survives their rollout.
- **Standalone single-file HTML bundler** (open-design `7a37c14`,
  `apps/daemon/src/artifacts/standalone-html.ts`, ~1400 lines): walks the real
  dependency graph (scripts, CSS `url()`, fonts, workers, iframes) with typed
  errors and size bounds. Ligma already ships `packages/exporters` with an
  HTML export, but ours inlines only what needs no DOM parse and exports the
  primary HTML file alone — multi-file designs fall back to ZIP. Adopt if
  single-file export of multi-file designs becomes a real ask.
- **Anti-slop artifact linter** (predates the delta; `od lint` CLI wrapper
  `db6db34` is what's new): deterministic checks for AI-design tells
  (purple-gradient hexes, emoji icons, invented metrics) fed back to the agent
  as a self-correction signal. Ligma has `craft/anti-ai-slop.md` as prose for
  the studio critic; upstream's executable-ruleset approach is the next rung
  if critic scores prove too soft.
- **Daemon-advertised capability booleans** (open-design `e34d823`): backend
  advertises a capability computed from the same code path that would 501;
  unknown fails open, only explicit `false` hides UI, no client caching.
  Worth stealing the day a Ligma export/render capability varies by host.

**Skipped**

- open-design: landing/pricing/campaign copy (~60 commits), third-party
  agent-CLI runtime shims (DeepSeek Harness, Antigravity, Kimi, OpenCode),
  multi-user collab fixes, CI/release plumbing, analytics/billing, the
  `packages/standalone` Terminal distribution lifecycle, CSAT survey,
  deck-stage zero-scale probe (technique noted, selectors all theirs), PPTX
  blank-capture retry (their Xvfb path). A shipped+reverted design-systems
  workflow (`4908baa`/`16fad1c`) netted zero.
- builderz-labs, all 9 commits — each already covered by Ligma's design:
  Windows CLI-shim resolution (ours: `apps/daemon/src/engine/runner.ts`,
  ported at build time and flagged "don't break it" in the build brief);
  dispatch-wedge fix (ours: `reconcileStaleInProgressTasks()` +
  claim-before-spawn in `dispatcher.ts`/`quota-governor.ts` prevent the
  class); MiniMax support (ours: `packages/shared/src/base-url.ts`, no
  pricing catalog by design — cost is CLI-reported passthrough); host
  allowlist/logout-cookie hardening (N/A: daemon binds 127.0.0.1 only, no
  auth by design; the harness `bridge-server.ts` already validates loopback
  Host); SQL alias fix, gateway counts, zh-tw locale, sponsor docs (N/A).
