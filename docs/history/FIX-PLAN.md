# Fix plan — xhigh review remediation (conductor-pinned)

Binding for all fix agents. Shared types are ALREADY edited and committed by the conductor:
`src/lib/types.ts`, `src/lib/validations.ts`, `scripts/harness/types.ts`. **No agent may edit those
three files or `docs/`.** Code against what is in them.

## Design decisions (pinned — do not re-litigate)

**D1 — Contracts compile automatically, or the task is honestly waived.**
When a builder finishes, the daemon compiles a contract in-process (deterministic path, no LLM, no
CLI spawn) if the task has `acceptanceCriteria` and no contract exists. If the task has **no**
acceptance criteria there is no oracle: do not park it forever — complete it with
`kanban: "done"`, `verificationStatus: "waived"`, unblock its dependents, and word the inbox/activity
entries honestly ("completed without verification — no acceptance criteria"). `waived` must never be
rendered as `passed`.

**D2 — Verify the builder's actual work, never HEAD.**
The builder edits the live working tree and does not commit. Before creating the env, snapshot the
working tree into a dangling commit **without touching the user's index, worktree, or branches**:
```
GIT_INDEX_FILE=<tmp> git read-tree HEAD
GIT_INDEX_FILE=<tmp> git add -A          # respects .gitignore; picks up untracked work
tree=$(GIT_INDEX_FILE=<tmp> git write-tree)
snap=$(git commit-tree $tree -p HEAD -m "verification snapshot <taskId>")
```
then `git worktree add --detach <path> $snap`. Record `snap` as the manifest's `baseCommit`.
A verification run that tests code the builder did not write is worse than no verification at all.

**D3 — A harness malfunction is not a product failure.**
`VerificationVerdict.outcome` now has `"error"`. Judge crash/timeout/unparseable output, contract
signature mismatch, unreadable evidence ⇒ `error`. `applyVerdict` on `error`: leave the task
`awaiting-verification` / `unverified`, increment attempts, post an inbox report titled
**"Harness error"** — never "Verification failed", never bounce the task back to the builder.

**D4 — Attempts are capped and the cap never lies.**
`task.verificationAttempts` increments when a run starts and resets to 0 when a new build completes.
At `harness.maxVerificationAttempts` (default 3) the task stops being selected, gets a
`Blocked: <title>` inbox report and a decision card (`blocksTask: false`) naming the real reason.
Do **not** stamp `verificationStatus: "failed"` for what were harness errors — that is the same
class of lie this whole branch exists to remove.

**D5 — A dead run does not own a task.**
Record `pid` in the run manifest. `hasRunningVerification` counts a `"running"` manifest as live only
if the pid is alive **and** `startedAt` is within `2 × execution.timeoutMinutes`; otherwise rewrite it
to `status: "error"` (reason: run died) and let the task proceed. Sweep stale manifests at daemon start.

**D6 — A new build invalidates the previous verdict.**
`markTaskAwaitingVerification` resets `verificationStatus` to `"unverified"` and
`verificationAttempts` to 0, whatever the previous verdict was.

**D7 — The oracle is denied to the builder at the tool level.**
Builder spawns pass deny rules covering the compiled contracts and the raw task store
(`--disallowedTools` or the CLI's actual equivalent — verify empirically against `claude --help`
before relying on it, and unit-test the constructed argv). Generated agent context
(`ai-context*.md`) must not contain acceptance criteria. Invariants (the Saboteur's list) live only
in the contract file, never in `tasks.json`. Document any residual leak honestly rather than
claiming an enforcement that does not hold.

**D8 — Restrictions that cannot be expressed must fail closed.**
`runner.buildArgs` currently drops `allowedTools`/`skipPermissions` for codex and gemini. Map them
where a real flag exists; where none exists, **throw** rather than spawn unrestricted. A judge or
persona silently granted write access to the evidence it is grading voids every verdict it signs.

**D9 — Tool sets are per role.**
`config.ts` exports `toolsForRole(role: "builder" | "scheduled" | "inbox" | "triage"): string[]`.
The **builder keeps `Bash`** — the original brief requires it ("the builder must be able to run
things"), so the review's "no functional gain" premise is wrong for that path. Inbox-respond,
brain-dump triage and scheduled commands get `Read`/`Edit`/`Write` only, which is where the real
over-grant was.

**D10 — Every spawn passes the governor.** Including each backend-fallback attempt.

## File ownership (no two agents share a file)

| Agent | Files |
|---|---|
| conductor | `src/lib/types.ts`, `src/lib/validations.ts`, `scripts/harness/types.ts`, `docs/**` |
| **P** pipeline | `scripts/daemon/{run-task,dispatcher,index}.ts`, `scripts/harness/{verdict,run-verification}.ts`, `scripts/env/lifecycle.ts`, own tests |
| **I** integrity | `scripts/harness/{compile-contract,contract-store,judge,personas}.ts`, `scripts/daemon/{prompt-builder,runner,config,run-inbox-respond,run-brain-dump-triage}.ts`, `scripts/generate-context.ts`, `data/daemon-config.json`, own tests |
| **U** ui/api | `src/app/api/**`, `src/app/launch/**`, `src/hooks/**`, `src/components/**`, own tests |

Cross-agent seam: **I** defines `toolsForRole()` in `config.ts`; **P** and **I** both call it. Agree on
the signature above and do not change it. **I**'s `judge.ts` returns `outcome: "error"`; **P**'s
`applyVerdict` consumes it per D3.
