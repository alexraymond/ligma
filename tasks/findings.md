# Findings

> Source plan: /Users/alexraymond/.claude/plans/snappy-snacking-sutton.md
> Source design: (single-file plan)
> Generated: 2026-04-23

## Architecture Decisions

<!-- Seeded from plan §"Decisions Locked Tonight". Swarm/Ralph appends more as they discover. -->

| Decision | Rationale |
| -------- | --------- |
| Fresh repo at `~/ligma/`, source copied from `~/open-codesign/` with fresh `git init` and one initial commit. | Avoids history-scrub risk (no `filter-repo`, no force-push). The app is new from the OS's perspective (new `appId`, new config dir). |
| Runtime: Electron + React + Vite (unchanged from starting code). | User needs a graphical UI for HTML preview + inline edits. Tauri migration would conflict with "copy existing code." 120MB bundle is acceptable for a design tool. |
| Architecture mirrors Claude Code source patterns (async-generator agent loop, typed events, concurrency-safe tool partitioning, append-only session log). | Direct pattern reuse from `~/collection-claude-code-source-code/claude-code-source-code/src/` reduces translation cost and gives CC-parity UX. |
| Overnight engine: `claude-skills:swarm-execute` (parallel Agent Teams per workstream). | 6 independent workstreams fit the swarm model; parallelism is the point of going autonomous. |
| Merge policy: auto-merge green workstream branches into a single local `overnight` integration branch. No remote pushes. | Isolates overnight changes; morning review decides whether to promote. No `main` or upstream churn if anything goes wrong. |
| API-key path: keep BYO Anthropic key as a non-default option; claude CLI subscription is the default. | Broader appeal (BYOK still works) while showcasing the Max-subscription-native path. |
| Morning state target: install → launch → prompt → streamed response → one fs-write tool call fires end-to-end. | Concrete golden path agents optimize toward. Everything else is foundation or deferred. |
| UI aesthetic: conservative reskin overnight (dark-theme default, placeholder Ligma accent, two-circle icon, tightened spacing). Full redesign is a follow-up spec. | Without human design direction, agents can only reskin safely. Reskin is visible from launch so user sees "different" immediately. |
| No AI co-author trailers on any commit (global hard constraint). | User wants to own the project cleanly. Applies to every agent team and every conductor commit. |
| No prose describing lineage from open-codesign anywhere except LICENSE (legally required copyright preservation). | User wants Ligma presented as a new project. `rg -i 'open.codesign\|opencoworkai'` should return hits only in LICENSE. |
| Worktree isolation: each workstream runs in `/tmp/ligma-ws/<id>/` with exclusive file ownership. | Prevents merge conflicts; agents can't accidentally stomp each other's work. |
| Stop-on-ambiguity: workstreams write `TODO-MORNING.md` on undecided product calls and exit that task. | Prevents agents from inventing requirements overnight that the user never asked for. |

## Errors Encountered

<!-- Swarm/Ralph appends errors here so later iterations avoid repeating them. -->

| Error | Attempt | Resolution |
| ----- | ------- | ---------- |

## Patterns Discovered

<!-- Swarm/Ralph appends codebase patterns here as they discover them. -->

- IPC-ACK pattern (W1 introduces, W2 + W4 consume) — main awaits a sequenced ACK from renderer with bounded timeout; no silent fallback.
- Async-generator agent loop yielding typed `AgentEvent`s — replaces the flat `generate()` call.
- Concurrency-safe tool partitioning — `Tool.isConcurrencySafe()` gates parallel reads, serial writes.
- Append-only JSONL session log with sibling entry types — schema-version every entry; new entry types add, never mutate.
- Grep guardrail (`rg -i 'open.codesign|opencoworkai'` → only LICENSE hits allowed) as the final-pass check in W3 + W6.

## Resources

<!-- Useful file paths, API references, documentation links. -->

- Plan file: `/Users/alexraymond/.claude/plans/snappy-snacking-sutton.md`
- Claude Code source reference: `/Users/alexraymond/collection-claude-code-source-code/claude-code-source-code/src/`
  - Agent loop: `src/query.ts:219-250`, `src/QueryEngine.ts:184-250`
  - Event types: `src/entrypoints/sdk/coreTypes.ts:25-53`
  - Tool orchestration: `src/services/tools/toolOrchestration.ts:8-189`
  - File read tool: `src/tools/FileReadTool/FileReadTool.ts`
  - Session history: `src/assistant/sessionHistory.ts:1-88`, `src/types/logs.ts:8-52`
- Overnight scripts: `~/ligma/scripts/overnight-{setup,merge,report}.sh`
- Worktree state: `~/ligma/.claude/workspace/overnight/*.json`
