# CONTRACTS — Port Wave 1 (2026-08-13)

Owner directive: build remaining features by porting from reference repos; no live-LLM
testing. Source triage: D7 waiver re-triage (69 PORTABLE rows). This wave takes the
S-effort, high-value slice. Binding rules: no two agents edit the same file; port, never
rewrite; Apache-2.0 attribution preserved; conventional commits, no AI trailers; suite +
typecheck green before reporting; every agent reports evidence (diffstat, test tail).

| W | Rows | Work | Owns (exclusively) |
|---|---|---|---|
| P1 | OD-067, OD-077 | Vendor full open-design catalogs: 155 design systems, 166 skills; attribution refresh | `design-systems/**`, `skills/**`, `NOTICE` |
| P2 | OD-033, OD-036 | Discovery form input types (range/date/time/url/email/tel/switch) + back/skip across sequential forms | `apps/web/src/components/question-form.tsx`, `apps/daemon/src/engine/discovery.ts` (control enum only) |
| P3 | OD-097, OD-096, OD-098 | Settings: configurable product-repo location, notifications section, About panel | `apps/web/src/app/settings/**`, `apps/daemon/src/store/product-repo.ts` (root resolution only), new settings routes |
| P4 | OD-115, OD-049, OD-046 | Studio: export diagnostics panel, shiki code viewer in version rail, device-frame chrome | `apps/web/src/components/studio/**`, `apps/web/src/runtime/**` (new), `assets/frames/**` |
| P5 | OD-103 | "Use ligma everywhere" guide modal off the command bar | `apps/web/src/components/command-bar.tsx`, new `apps/web/src/components/use-everywhere/**` |

Out of scope for this wave (gated on Alex, decision cards below): BYOK wiring (OD-063,
OD-162–165), Composio/Orbit (OD-102, OD-108), media generation kinds (OD-026 et al.),
desktop pet (OD-018, OD-129–132), reopening spec-approved reductions (OD-051/053/054/060/023).

## Wave 2 (2026-08-13, after Wave-1 green)

Rule: NOBODY edits `apps/daemon/src/routes/index.ts` — report your registration
line(s) as a handoff; the conductor applies them. Same for NOTICE.md.

| W | Rows | Work | Owns (exclusively) |
|---|---|---|---|
| Q1 | OD-061, OD-065, OD-086, OD-088, OD-117–119, OD-128 | Agent-probe settings screen: live per-backend probe (version/path/auth/models/rescan) over the dormant probeBackend/findCliBinary, failure-class cards wired | `apps/web/src/app/settings/agents-*`, new `apps/daemon/src/routes/backends/**`, `apps/daemon/src/engine/backend-probe.ts` (new) |
| Q2 | OD-077 wiring | Serve `skills/` catalog via daemon route + Library listing (follow craft/ + design-systems/ pattern) | new `apps/daemon/src/routes/skills/**`, `apps/web/src/app/library/**` |
| Q3 | D4 seam gaps | Server-side deck-queue route (one source for cards+counts) + batch decisions endpoint; deck page consumes both; drill-d4 updated to drive them | new `apps/daemon/src/routes/deck/**`, `apps/daemon/src/routes/decisions/**`, `apps/web/src/app/deck/**`, `apps/web/src/providers/deck-queue-provider.tsx`, `apps/web/src/hooks/use-deck-sources.ts`, `scripts/acceptance/drill-d4.ts` |
| Q4 | OD-135 | Terminal tab in the Studio workspace over the existing pty-bridge | `apps/web/src/components/studio/terminal-*`, `apps/web/src/components/pipeline-strip.tsx`, new `apps/daemon/src/routes/pty/**` |

## Wave 3 (2026-08-13, after Wave-2 green)

Same rules. routes/index.ts + NOTICE.md + packages/api/src/routes.ts entries are
conductor-applied handoffs (report the lines).

| W | Rows | Work | Owns (exclusively) |
|---|---|---|---|
| R1 | OD-005, OD-022, OD-024, OD-025, OD-087 | Studio deep links (session+file in URL) + composer garnish (sub-chips, template picker over the 5 chips, placeholder carousel, starter copy) | `apps/web/src/app/projects/[id]/studio/**`, `apps/web/src/lib/composer.ts`, `apps/web/src/components/kickoff-composer.tsx`, new `apps/web/src/components/composer-*` |
| R2 | OD-048, OD-137, OD-134, OD-138 | Reference/mood-board browser + side-chat + design-files as FIXED pipeline-strip slots (no tab registry — brief §3) | `apps/web/src/components/pipeline-strip.tsx`, new `apps/web/src/components/workspace/**`, new `apps/daemon/src/routes/references/**` |
| R3 | OD-057 | Critique-run replay: critic persists its event stream (.ndjson per run), critique lane replays with speed control | `apps/daemon/src/studio/critic.ts`, `apps/web/src/components/studio/critique-lane.tsx`, new replay files beside them |
| R4 | OD-064, OD-101, OD-104, OD-014, OD-100 | Integrations page: export ligma as an MCP server, manage external MCP servers, open-in-editor/copy-prompt handoff | new `apps/daemon/src/routes/mcp/**`, new `apps/daemon/src/mcp-server.ts`, new `apps/web/src/app/settings/integrations/**` |

## Wave 4 (2026-08-13, after Wave-3 green) — the L items + pending-live closure

Same rules; conductor applies routes/index.ts, packages/api/src/routes.ts, NOTICE.md,
settings/layout inclusions.

| W | Rows | Work | Owns (exclusively) |
|---|---|---|---|
| S1 | MC-049, MC-130–138, MC-298 (pending-live) | Zero-LLM closure: boot the real app, render /verification/[id] against the on-disk d2a verdicts, cite; fixture test proving a real compiled contract parses | `docs/evidence/completeness-matrix.md` pending-live citations, new `apps/daemon/__tests__/compiled-contract-fixture.test.ts` + fixture, `scripts/audit/**` reruns |
| S2 | OD-092 | Cross-session memory subsystem + model picker | new `apps/daemon/src/routes/memory/**`, new `apps/daemon/src/store/memory.ts`, new `apps/web/src/app/settings/memory-card.tsx` |
| S3 | OD-007, OD-008, OD-154–159 | Library facets/ranking/bookmarks/authoring over the local catalogs (no registry) | `apps/web/src/app/library/**`, `apps/web/src/components/library/**`, new `apps/daemon/src/routes/library-meta/**` |
| S4 | OD-010, OD-069, OD-075 | Design-system creation: wizard (import/tokens/revisions) + brand extraction from a live site | new `apps/daemon/src/routes/design-systems/wizard/**`, new `apps/web/src/app/library/new-design-system/**`, new `apps/web/src/runtime/brand-*` |

OD-047 (brownfield restyle) stays a roadmap item per the triage; gated families still ⚠ Alex.
