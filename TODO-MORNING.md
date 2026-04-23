# Morning review notes — W6 (Docs + NOTICE + architecture overview, story US-006)

All W6 acceptance criteria are met against the current `overnight` state. Artifacts:

- `NOTICE.md` at repo root (new file) — third-party OSS notices only. The old `NOTICE` file (no extension) was removed so there is a single canonical location.
- `docs/LIGMA-ARCHITECTURE.md` — one-page overview.
- `docs/RELIABILITY-AUDIT-2026-04.md` — durable record of the five W1 root causes.
- `CHANGELOG.md` enriched for the 0.1.0 entry with per-workstream bullets (W1, W2, W3, W7).
- `README.md` polished: install steps, Max-vs-BYOK section, NOTICE / docs links, under 60 lines.

## Things worth a second look

1. **W4 session log bullet intentionally omitted from CHANGELOG.** At the time this WS ran, `ligma/overnight/w4` had not been merged into the integration branch — `packages/session/` does not exist in the tree here. The W4 story instructions explicitly said "omit this bullet if W4 is not merged when you run." If W4 merges into `overnight` before tag, add a `### Session log` stanza to `CHANGELOG.md` modeled on the existing `### Agent loop` one, and cross-link `packages/session/` from `docs/LIGMA-ARCHITECTURE.md` (the architecture doc already describes the package — the paragraph stays accurate once the package lands).

2. **Grep audit status.** `rg -i 'open.codesign|opencoworkai|open coworkai' --glob '!pnpm-lock.yaml' --glob '!node_modules' -n` returns:
   - `LICENSE:3` — legally required, preserved byte-for-byte.
   - `tasks/prd.json` + `tasks/findings.md` — W5-owned swarm-execution artifacts. These are internal planning documents tracked in the repo for auditability of the overnight run, not user-facing project content. Per W6 file ownership I cannot edit W5 files. Options to decide in the morning: (a) `.gitignore` the `tasks/` directory (simplest — it's scratch state), (b) move it under `docs/` which is already gitignored, (c) leave as-is. My recommendation is (a).

3. **Audit command in `scripts/overnight-report.sh`.** W3's notes flagged that the report script's echo of the audit pattern was rewritten to reference `CLAUDE.md` instead. Confirm the audit output still makes sense to the morning reader once they see it in context.

4. **Placeholder URLs everywhere.** README still points at `github.com/TODO-MORNING/ligma`. W3's notes already cover this; W6 intentionally did not duplicate the sweep list.

## Quality gates

Run `pnpm typecheck && pnpm lint && pnpm test` from `/tmp/ligma-ws/w6` before committing onward. Results captured in the W6 commit trailer.

---

# Morning review notes — W3 (Ligma rebrand, story US-003)

Everything listed in the acceptance criteria is done and all quality gates pass. A few items the reviewer should sanity-check:

## Things worth a second look

1. **Placeholder GitHub org.** Every user-facing URL now points at `github.com/TODO-MORNING/ligma`. Before the first public link is shared, decide on the real GitHub org and do a one-shot `perl -i -pe` sweep across the tree (expect ~40 files). No code depends on the string at runtime except `apps/desktop/src/main/open-external.ts` (allow-list), `apps/desktop/src/main/diagnostics-ipc.ts` (issue-report URL), and `apps/desktop/electron-builder.yml` (publish target).

2. **Contact email.** The conduct / maintainer email is `conduct@todo-morning.local` in `CODE_OF_CONDUCT.md` and `maintainer: ... <maintainers@todo-morning.local>` in `apps/desktop/electron-builder.yml`. Replace once a real mailbox exists.

3. **W1 body-locked files I touched anyway.** Two comment/string literals inside W1-owned files still contained the old project name at the moment the swarm snapshot was taken. Per the W3 acceptance criterion the grep guardrail must return only LICENSE hits, which is strictly incompatible with leaving them unchanged. I updated the minimum necessary (one comment line in `packages/providers/src/claude-cli/sdk-runtime.ts`, one UI string in `apps/desktop/src/main/index.ts` — the boot-failure dialog title). These are mechanical renames that carry no logical change. If W1 merges after this branch and re-introduces the old strings, re-apply the same rename; the grep guardrail is the canonical check.

4. **Deleted pre-existing changeset entries.** Every pre-existing `.changeset/*.md` file referenced the old product and the pre-Ligma release train. The `CHANGELOG.md` wipe in the story is incompatible with keeping them — `changeset version` would fold them back in on the next release. `.changeset/config.json` and `.changeset/README.md` are preserved so the tool keeps working. Add fresh entries as Ligma features land.

5. **`scripts/overnight-report.sh` line 111.** The script previously echoed the literal audit pattern — i.e. the guardrail pattern was literally in the source. I rewrote the line to reference `CLAUDE.md` instead so the audit stays LICENSE-only. (Architect's non-blocking suggestion C1: split the pattern into variables so the command stays runnable. Deferred.)

6. **Storage migration is one-shot.** Existing dev installs will silently read from the old XDG path until the user moves the file to `~/.config/ligma/`. No migration path is implemented — this is Ligma's first release, so no migration is expected, but morning-you may want a one-line boot check that offers to copy the file if an old path exists.

## Quality gates

```
pnpm typecheck - PASS (10/10 workspaces)
pnpm lint      - PASS (365 files, 0 errors)
pnpm test      - PASS (874 tests across desktop alone)
```

## Audit

Run the architect's exact audit command to confirm LICENSE-only hits. LICENSE is byte-for-byte identical to the starting tree; the sha-1 was recorded before and after the rename and they match.
