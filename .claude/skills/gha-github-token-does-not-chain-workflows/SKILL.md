---
name: gha-github-token-does-not-chain-workflows
description: Diagnose why one GitHub Actions workflow triggers, creates a git object (tag/commit/PR/release), but a downstream workflow that subscribes to that object event (e.g. `on: push: tags`, `on: pull_request`, `on: release`) silently never runs. The failure mode is almost always GitHub's intentional recursion-prevention rule — events created by the default `GITHUB_TOKEN` do not cascade to other workflows. Covers the two canonical fixes: `workflow_dispatch` call from the creating workflow, and using a PAT / GitHub App token. Trigger words — "tag pushed but release didn't fire", "auto-tag workflow not triggering release", "on: push: tags silent", "workflow created PR doesn't run CI", "GITHUB_TOKEN doesn't trigger workflow", "release.yml skipped after auto-tag", "cascading workflow broken".
allowed-tools: Read, Bash, Edit, Glob, Grep
---

# GitHub Actions GITHUB_TOKEN does not trigger downstream workflows

## The bug

You have a pipeline like:

- `auto-tag.yml` — on `push` to `main`, pushes a new `vX.Y.Z` tag.
- `release.yml` — on `push: tags: v*.*.*`, builds installers and publishes the GitHub Release.

You bump the package version, push to `main`, and see:

```
✓ auto-tag.yml      ran, created + pushed v0.1.6
  ...and nothing else. release.yml never starts.
```

`git fetch --tags` proves the tag landed on origin. `gh workflow list` shows `release.yml` active. The workflow's `on: push: tags` filter is correct. A manual `git push origin v0.1.7` from your laptop DOES trigger `release.yml`. But the tag pushed by the workflow does not.

## Why

From GitHub's docs (often missed):

> When you use the repository's `GITHUB_TOKEN` to perform tasks, events triggered by the `GITHUB_TOKEN`... will not create a new workflow run. This prevents you from accidentally creating recursive workflow runs.

So if *Workflow A* (authenticated with the default `GITHUB_TOKEN`):

- pushes a commit → `on: push` in *Workflow B* does NOT fire
- pushes a tag → `on: push: tags` does NOT fire
- opens a PR → `on: pull_request` does NOT fire
- creates a release → `on: release` does NOT fire

Manual pushes from a developer laptop DO trigger downstream workflows, which is why the pipeline looks broken only in automation.

## The two fixes

### Fix 1: `workflow_dispatch` from the creating workflow (simplest)

If the downstream workflow supports `workflow_dispatch` (or you can add it), invoke it explicitly from the upstream workflow. `workflow_dispatch` is exempt from the recursion rule.

```yaml
# auto-tag.yml
  - name: Push tag
    env:
      TAG: ${{ steps.version.outputs.tag }}
    run: git push origin "${TAG}"

  - name: Trigger release workflow (bypass GITHUB_TOKEN recursion block)
    env:
      TAG: ${{ steps.version.outputs.tag }}
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: gh workflow run release.yml --ref "${TAG}" -f tag="${TAG}"
```

The downstream workflow needs:

```yaml
# release.yml
on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:
    inputs:
      tag:
        required: true
        type: string
```

Both triggers are kept — manual tag pushes still work as before.

### Fix 2: Use a PAT or GitHub App token (for complex chains)

If you cannot add `workflow_dispatch` to the downstream (e.g. the event is `on: pull_request` which doesn't support dispatch), push the object using a **Personal Access Token** or **GitHub App installation token**. Those identities are treated like a human actor, so downstream workflows DO fire.

```yaml
permissions:
  contents: write   # still needed for the PAT fallback step

steps:
  - uses: actions/checkout@v4
    with:
      token: ${{ secrets.RELEASE_PAT }}   # PAT with `repo` scope

  - run: git push origin "${TAG}"
```

Trade-offs:

- **PAT**: simple, but tied to one user; revoked/expired PAT = silently broken pipeline; counts against that user's rate limit.
- **GitHub App**: more secure (fine-grained scopes, org-managed), but one-time setup cost (install the app, generate a token via `actions/create-github-app-token`).

## How to confirm the fix

Before: push a tag from the workflow, watch `gh run list --workflow=release.yml` — only the manually-pushed tags show up.

After: run the upstream workflow, then immediately:

```sh
gh run list --workflow=release.yml --limit 5
```

You should see a new `release.yml` run with `workflow_dispatch` (or `push` if you went the PAT route) as the trigger. No silence.

## Unblocking an already-broken run

If the automation already pushed the tag without triggering a run, you have three options:

1. **`gh` CLI from your laptop:**
   ```sh
   gh workflow run release.yml --ref v0.1.6 -f tag=v0.1.6
   ```

2. **Re-tag locally** (only if the tag hasn't been announced anywhere yet):
   ```sh
   git tag -d v0.1.6
   git push origin :refs/tags/v0.1.6
   git tag v0.1.6
   git push origin v0.1.6   # manual push — triggers downstream
   ```

3. **Bump the version again** and push. The auto-tag workflow cuts a new tag, which with the fix in place now chains into release.yml.

## Related behaviours

- **`pull_request_target`** is sometimes suggested as a workaround — don't. It runs against the target branch's workflow file with write-scoped secrets and is a common source of injection bugs. It solves a different problem (using secrets on forked PRs), not this one.
- **`repository_dispatch`**: another exempt event type. Works like `workflow_dispatch` but targets any listener by name. Useful for cross-repo pipelines.
- **GITHUB_TOKEN pushing to a protected branch**: a separate rule — can be allowed explicitly in branch protection settings, but still won't chain workflows.
- **Default branch check-runs**: events *you* create via REST API using `GITHUB_TOKEN` (like marking a check run) do NOT suffer the recursion block — only commit/tag/PR/release object creations.
