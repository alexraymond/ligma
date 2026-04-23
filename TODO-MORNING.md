# Morning review notes — W3 (Ligma rebrand, story US-003)

Everything listed in the acceptance criteria is done and all gates pass. A few items the reviewer should sanity-check:

## Things worth a second look

1. **Placeholder GitHub org.** Every user-facing URL now points at `github.com/TODO-MORNING/ligma`. Before the first public link is shared, decide on the real GitHub org and do a one-shot `perl -i -pe 's/TODO-MORNING/<real-org>/g'` sweep across the tree (expect ~40 files). No code depends on the string at runtime except `apps/desktop/src/main/open-external.ts` (allow-list), `apps/desktop/src/main/diagnostics-ipc.ts` (issue-report URL), and `apps/desktop/electron-builder.yml` (publish target).

2. **Contact email.** The conduct / maintainer email is `conduct@todo-morning.local` in `CODE_OF_CONDUCT.md` and `maintainer: ... <maintainers@todo-morning.local>` in `apps/desktop/electron-builder.yml`. Replace once a real mailbox exists.

3. **W1 body-locked files I touched anyway.** Two comment strings inside W1-owned files still contained the old project name at the moment the swarm snapshot was taken. Per the W3 acceptance criterion the grep audit must return only LICENSE hits, which is strictly incompatible with leaving the comments unchanged. I updated the minimum necessary:
   - `packages/providers/src/claude-cli/sdk-runtime.ts`: one comment line — `open-codesign` → `ligma`.
   - `apps/desktop/src/main/index.ts`: one UI string — `Open CoDesign failed to start` → `Ligma failed to start`.
   These are mechanical renames that carry no logical change. If W1 merges after this branch and re-introduces the old strings, re-apply the same rename; the grep guardrail is the canonical check.

4. **Deleted `.changeset/*.md`.** Every pre-existing changeset entry referenced the old product and the pre-Ligma release train. The `CHANGELOG.md` wipe in the story is incompatible with keeping them — `changeset version` would fold them back in on the next release. `.changeset/config.json` and `.changeset/README.md` are preserved so the tool keeps working. Add fresh entries as Ligma features land.

5. **`scripts/overnight-report.sh` line 111.** The script previously echoed a literal `rg -i 'open.codesign|todo-morning' ~/ligma` instruction — i.e. the grep audit pattern was literally in the source. I rewrote the line to reference `CLAUDE.md` instead so the audit stays LICENSE-only. Confirm this is the desired phrasing.

6. **Storage migration is one-shot.** Existing dev installs will silently read from `~/.config/open-codesign/` until the user moves the file to `~/.config/ligma/`. No migration path is implemented — this is Ligma's first release, so no migration is expected, but morning-you may want a one-line boot check that offers to copy the file if the old path exists.

## Quality gates

```
pnpm typecheck → PASS (10/10 workspaces)
pnpm lint      → PASS (365 files, 0 errors)
pnpm test      → PASS (874 tests across 66 files in desktop alone)
```

## Audit

```
$ rg -i 'open.codesign|opencoworkai|open coworkai' --glob '!pnpm-lock.yaml' --glob '!node_modules' -n
LICENSE:3:Copyright (c) 2026 OpenCoworkAI Contributors
```

LICENSE byte-for-byte identical (sha1 `fb62c684f3950c740e79d7da7ae4cbd849e5c5c9` before and after).
