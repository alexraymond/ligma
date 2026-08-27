# CONTRACTS — UI/UX Fix Waves (2026-08-13)

Owner directive: fix everything in docs/reviews/ui-ux-review.md (10 majors + minor/polish).
Blockers B1–B6 already fixed. Binding rules: no two agents edit the same file; no live-LLM
calls anywhere; suite + typecheck + lint green before reporting; agents do NOT commit —
report diffstat + test tail; conductor commits. No AI-attribution trailers, no
open-codesign references. Read the cited findings in docs/reviews/mechanics/findings.md
and docs/reviews/walkthrough/findings.md before touching code.

## Wave 1 — foundation

| W | Review items | Work | Owns (exclusively) |
|---|---|---|---|
| U1 | M1, M9, minors (dead use-dashboard, SSE wire-up) | Shared collections provider + explicit invalidation for the four always-on collections; mutations invalidate derived surfaces; visibility-gated polling; dedupe duplicated mounts; consume the run-output SSE endpoint; delete dead use-dashboard.ts | `apps/web/src/providers/**`, `apps/web/src/hooks/**`, fetch call-sites in pages/components that swap onto the provider |
| U2 | M5, M10 (components only) | `WaitingStatus` (queued · deferred resumes ~HH:MM · running 4m · stalled) + unified `ErrorState` presentation component; NEW FILES ONLY, wiring happens in Wave 2 | new `apps/web/src/components/waiting-status.tsx`, new `apps/web/src/components/error-state.tsx`, their tests |

## Wave 2 — surfaces (after Wave-1 green)

| W | Review items | Work | Owns (exclusively) |
|---|---|---|---|
| U3 | M4 | Status truth: badges derive from the same data they sit next to (Not Started over 7/7, 0/4 milestones over 78/78, done+failed journey, 208 vs 200) | status-derivation lib + the badge call-sites named in walkthrough M3 |
| U4 | M6 | Runs page shows runs; Board collapses/paginates Done (36,900px) | `apps/web/src/app/runs/**`, board column components |
| U5 | M7 | Raw internals → user copy: vrun_/task_ ids get titles, SDK JSON transcript summarized, markdown rendered, PIDs out of prose | the surfaces named in M6/M7 + mechanics vocabulary list |
| U6 | M8 + wiring | Health table summary-first, detail on demand; wire WaitingStatus + ErrorState into the surfaces Wave-2 owns | health table components; waiting/error call-site swaps coordinated via ownership rows above |

## Wave 3 — vocabulary + polish (after Wave-2 green)

| W | Review items | Work | Owns (exclusively) |
|---|---|---|---|
| U7 | M2, M3 | Rebrand completion (Mission Control headline, dead mission-control/ path in agent prompt, tab title, Autopilot card, demo copy) + one-name-per-concept sweep (Projects, Board, Deck, Crew, Home) | copy/string edits repo-wide; no logic changes |
| U8 | minors | Empty states with a way out, icon-only rows get labels, one relative-time util replacing five date formats, mid-word truncation, container insets, olive Studio canvas, context-aware primary buttons, delete the six self-describing unwired comments | the minor-list call-sites; new `apps/web/src/lib/time.ts` |

Conductor verifies between waves: web tests + typecheck + lint, daemon suite, drills 3/3,
nav-crawl + seam audit at the end.
