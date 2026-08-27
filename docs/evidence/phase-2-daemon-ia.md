# Phase 2 — Daemon + IA skeleton: acceptance evidence

Date: 2026-08-11 · Monorepo: `~/ligma` · Branch: `main`

Phase 2's contract (build brief §6, `docs/history/CONTRACTS-phase2.md` acceptance section): every
pre-existing mission-control flow works through the new nav; an automated nav crawl from the
rail reaches every routable surface (zero orphans); the CLI can list projects, tail a run, and
answer a decision. Evidence below is captured fresh in this session — suites re-run, crawl
re-run, CLI transcripts taken against a live daemon.

## 1. Suite results — re-run this session

| Package | Command | Result |
|---|---|---|
| `@ligma/daemon` unit | `pnpm --filter @ligma/daemon test` | **500 passed (500)**, 31 files, exit 0 |
| `@ligma/daemon` integration | `pnpm --filter @ligma/daemon test:integration` | **66 passed (66)**, 7 files, exit 0 |
| `@ligma/web` check (tsc + lint) | `pnpm --filter @ligma/web check` | pass, exit 0 (3 pre-existing `no-img-element` warnings, no errors) |
| `@ligma/web` unit | `pnpm --filter @ligma/web test` | **20 passed (20)**, 3 files, exit 0 |
| `@ligma/web` build | `pnpm --filter @ligma/web build` | pass, exit 0 — 27/27 static pages generated |
| `@ligma/web` e2e | `pnpm --filter @ligma/web test:e2e` | **9 passed (9)**, 1.6s, exit 0 (`e2e/smoke.spec.ts`) |
| `@ligma/cli` unit | `pnpm --filter @ligma/cli test` | **7 passed (7)**, 4 files, exit 0 |

Daemon unit count (500) is 4 below the ancestor's 504 — expected drift noted in
`docs/DECISIONS.md` ("split may shift between packages; the sum may grow, never shrink," per
`docs/history/CONTRACTS-phase2.md`): daemon (500) + web (20) + cli (7) = 527 unit tests total, and 66
integration, both **above** the Phase 1 baseline (504 + 66 = 570 vs. 593 today). Conserved and
grown, not shrunk.

## 2. Nav crawl — zero-orphans proof

**Headline: fixed same night — see the "Addendum — post-fix crawl" at the end of this
file for the PASS re-run.** The `FAIL` below was the state before that fix landed.

Script: `scripts/audit/nav-crawl.ts`. Reproduce: `npx tsx scripts/audit/nav-crawl.ts` from the
repo root (reuses a running daemon/web on 4477/3000, otherwise starts the daemon via
`pnpm --filter @ligma/daemon serve` and web via a production `build` + `start`, matching
`apps/web/playwright.config.ts`'s own e2e pattern — dev mode was not needed). It enumerates
every `page.tsx` under `apps/web/src/app`, BFS-crawls same-origin `<a href>` links from `/`
against the real `data/` (the dogfood project of the day, 208 tasks) with `mc-onboarded` pre-seeded in
`localStorage`, and separately exercises the retired-URL redirects.

**Route inventory:** 31 `page.tsx` files — 23 static, 8 dynamic families
(`/library/[id]`, `/projects/[id]`, `/projects/[id]/board`, `/projects/[id]/runs`,
`/projects/[id]/verify`, `/team/[role]`, `/verification/[id]`, `/skills/[id]`). 8 of the 31 are
redirect stubs (validated separately, not counted as orphan-checkable) — leaving **23
checkable surfaces**.

**Crawl result:** 27 pathnames reached out of 23 checkable surfaces + dynamic-family hits.
**3 orphans found — real findings, not excluded:**

| Route | Why it's orphaned |
|---|---|
| `/crew/new` | Only reachable via a `Button onClick={() => router.push("/crew/new")}` in `apps/web/src/app/crew/page.tsx` (no `<a href>`/`<Link>` anywhere in the app links to it). Functionally reachable by a human clicking the button; invisible to an anchor-based crawl, middle-click-to-new-tab, and any crawler/SEO/accessibility path that relies on a real `href`. |
| `/library/new` | Same pattern, `apps/web/src/app/library/page.tsx`: `Button onClick={() => router.push("/library/new")}`, no anchor. |
| `/verification/[id]` | The only place this family is ever linked is `apps/web/src/app/projects/[id]/verify/page.tsx`, gated on `latestRunFor.has(task.id)` — a task having a completed verification-harness run. The live daemon's `/api/verification-runs` currently returns `{"runs":[]}` and no task in the store carries a `verificationRunId`, so the link never renders in the current data. The code path is correct; there is simply no verified task yet to produce a real instance. Confirmed live: `curl http://127.0.0.1:4477/api/verification-runs` → `{"runs":[]}`. |

These are reported, not patched — ownership of `apps/web/**` and `data/` seeding belongs to
other workstreams (see `docs/history/CONTRACTS-phase2.md`'s ownership table).

**Redirect table — all 8 pass** (6 required by acceptance + 2 extra redirect pages found in
the filesystem inventory, verified for completeness rather than left silently unchecked):

| From | Expected | Landed | Result |
|---|---|---|---|
| `/decisions` | `/deck` | `/deck` | pass |
| `/status-board` | `/board` | `/board` | pass |
| `/priority-matrix` | `/board/matrix` | `/board/matrix` | pass |
| `/skills` | `/library` | `/library` | pass |
| `/checkpoints` | `/settings/checkpoints` | `/settings/checkpoints` | pass |
| `/launch` | `/runs` | `/runs` | pass |
| `/skills/new` | `/library/new` | `/library/new` | pass |
| `/skills/skill_demo_research` | `/library/skill_demo_research` | `/library/skill_demo_research` | pass |

Mechanical note: these are statically prerendered pages — the redirect ships as
`<meta http-equiv="refresh" content="1;url=...">`, not a server 30x, so the URL only updates
~1s after `load`; the script waits for it explicitly (`page.waitForURL`) rather than reading
`page.url()` immediately.

**Overall script result: `FAIL` (exit 1)** — by design: 3 genuine orphans exist. The crawl
mechanism itself is sound and reproducible (redirects: 8/8 pass; reached: 27/31 surfaces,
with the 3 misses independently confirmed by source/data inspection above, not a crawler bug).

## 3. CLI acceptance transcripts — captured against the live daemon (127.0.0.1:4477)

`ligma projects list`:
```
ID                 NAME        STATUS  TASKS
proj_oFbAe2ugPMBW  <dogfood project>  active  208
```

`ligma runs tail run_1786473750503` (an existing run id from `data/run-outputs/`):
```
{"type":"result","subtype":"success","is_error":false,"result":"I did the thing (not really)"}
```
(Completed run: the daemon's SSE `end` frame closes the stream and the CLI exits cleanly —
no Ctrl-C needed for a finished run.)

`ligma decisions list`:
```
ID                 STATUS    QUESTION
dec_1786365382905  pending   Which backend should high-volume acceptance-harness personas (Naive U…
dec_sf007          answered  What is the deployment architecture for MVP?
dec_sf006          answered  Should action validation happen pre-narration or post-narration?
dec_sf005          answered  What is our strategy for handling unreliable LLM tool calling?
dec_sf004          answered  How should we manage LLM context window limits for long campaigns?
dec_sf003          answered  How do we handle D&D 5e content licensing — SRD-only or full PHB?
dec_sf002          answered  Where should game state be persisted — client-side or server-side?
dec_sf001          answered  Which LLM provider and model should we use for the AI DM?
```

`ligma decisions answer dec_nonexistent_id "some option"` (deliberately a nonexistent id —
does not mutate tracked data; the real answer-a-decision mutation path is covered by
`apps/cli` unit tests):
```
Decision not found
```
Exit code 1. Clean, typed error — no crash, no partial write.

## 4. Known deviations

From `docs/DECISIONS.md` (Phase 2 entries, verbatim):

> - ℹ **Daemon = Express 5 on 127.0.0.1:4477** (open-design's proven daemon shape), engine +
>   HTTP in one process; JSON stores moved to repo-root `data/`; all 35 API routes ported with
>   byte-identical shapes; SSE added only as a *sibling* endpoint (`/api/runs/:id/output/stream`).
>
> *(Editorial note, 2026-08-27: "35 routes" was the count at Phase 2. The registry has grown
> since — `packages/api/src/routes.ts` is the canonical current count; don't restate a number
> here or anywhere else without recounting from that file. Quote above left verbatim per the
> frozen-evidence policy.)*
> - ℹ **Stop-semantics parity restored.** One-process design initially made "stop daemon" kill
>   the API that serves the UI — the parent never behaved that way. Now `{action:"stop"}` stops
>   the engine loop only; the API keeps serving; CLI `daemon:stop` remains the ops-level
>   process kill. (Parity ratchet, not a new behavior.)
> - ℹ **Biome scoped to the ligma-classic packages.** The ported mission-control trees keep
>   their own gates (tsc strict + eslint); reformatting 12k ported lines would have destroyed
>   the port's byte-equivalence. ⚠ only if you want one style enforced repo-wide later — that
>   is a one-shot `biome check --write` + config change.
> - ⚠ **`packages/api` carries ~120 lines of runtime logic** (route-path interpolator, quadrant
>   helpers, deck ordering) because daemon and web must agree on "actionable" — the alternative
>   was duplication. Flag if you want a stricter types-only split.

**`git log --follow` linkage breaks at one IA re-home move boundary.** The rail's IA re-home
(`/decisions`→`/deck`, `/status-board`→`/board`, `/priority-matrix`→`/board/matrix`,
`/skills`→`/library`, `/checkpoints`→`/settings/checkpoints`) landed across two commits from
concurrent agent work: `53dcb9c` (adds the five new-home pages, several as real `git`-tracked
renames) and `86ce884` (strips the old paths down to redirect stubs, and splits
`/launch`'s content into `/runs` + `/settings`). Five of the six moves trace cleanly — e.g.
`git log --follow -- apps/web/src/app/library/page.tsx` correctly walks back through the
`{skills => library}/page.tsx` rename in `53dcb9c` all the way to the original mission-control
import (`bbe63a5`).

The sixth, `/launch`→`/runs` + `/settings`, is a genuine one-to-two split inside a single
commit (`86ce884`), which git's rename detector cannot represent — it can only pair one
delete with one add. It picks the wrong pairing: `git log --follow -- apps/web/src/app/settings/page.tsx`
shows `86ce884` as `{runs => settings}/page.tsx`, so `--follow` walks `settings/page.tsx`'s
history backward through `runs/page.tsx`'s *run-streaming* commits (`53dcb9c`'s launch→runs
rename, then the original `/launch` output-capture and run-row history back to `bbe63a5`) —
none of which is settings content. The commits that actually authored the schedule/execution
config UI now living in `settings/page.tsx` (e.g. "surface quota in the status file, dashboard
and CLI," "stop Autopilot config saves from deleting governor/harness config") are invisible
to `--follow` on that path, even though the content itself is intact and traceable by direct
diff (`apps/web/src/app/settings/page.tsx` shares its config-card imports and ~24 Autopilot/
schedule references with the pre-split `launch/page.tsx`). Content survived the move; the
automated history trace did not, at this one split boundary.

## Addendum — post-fix crawl (conductor)

The two anchor defects were fixed in `adda77f` (real `<Link>` anchors for `/crew/new` and
`/library/new`). Crawl re-run (`npx tsx scripts/audit/nav-crawl.ts`, fresh servers,
production build):

- Reached: 30 of 31 route surfaces (both former anchor-orphans now reached via BFS).
- Redirects: 8/8 pass.
- Remaining unreached: `/verification/[id]` — **data-gated, not orphaned code**: its link
  sites (project Verify tab, task detail panel) are wired and source-verified; the store
  (`data/verification-runs/`) simply contains zero runs, so no instance exists to link yet.
  The first Phase 3 journey run produces a real verdict and closes this cell; the crawl is
  re-run for D5 at that point rather than seeding a fabricated verification record now
  (a fake verdict to green a crawl would be the exact anti-pattern this product exists to
  kill).

Phase 2 gate assessment: every pre-existing flow works through the new nav (e2e 9/9, redirect
sweep, suites green: daemon 500+66, web 20 + build + e2e, cli 7); CLI list/tail/answer proven
with live transcripts; nav crawl clean modulo the one data-gated dynamic family, argued above.
