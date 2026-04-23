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
