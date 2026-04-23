#!/usr/bin/env bash
# overnight-setup.sh — create worktrees for each Ligma overnight workstream.
#
# Idempotent: safe to re-run. Workstreams: w1 (reliability), w2 (agent loop),
# w3 (rebrand), w4 (session log), w6 (docs), w7 (UI reskin). W5 is this
# scaffolding itself and has no worktree.
#
# Preconditions: run from the Ligma repo root. `main` branch exists with at
# least one commit. The `overnight` integration branch will be created if
# missing.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WORKSTREAMS=(w1 w2 w3 w4 w6 w7)
WS_ROOT="/tmp/ligma-ws"
STATE_DIR="$REPO_ROOT/.claude/workspace/overnight"

mkdir -p "$WS_ROOT" "$STATE_DIR"

# Integration branch — created from main if missing.
if ! git show-ref --verify --quiet refs/heads/overnight; then
  git branch overnight main
  echo "created branch: overnight"
fi

for ws in "${WORKSTREAMS[@]}"; do
  BR="ligma/overnight/$ws"
  WT="$WS_ROOT/$ws"

  if [ -d "$WT/.git" ] || [ -f "$WT/.git" ]; then
    echo "worktree exists: $WT (skipping)"
    continue
  fi

  if git show-ref --verify --quiet "refs/heads/$BR"; then
    git worktree add "$WT" "$BR"
  else
    git worktree add -b "$BR" "$WT" main
  fi

  cat > "$STATE_DIR/$ws.json" <<EOF
{
  "id": "$ws",
  "branch": "$BR",
  "worktree": "$WT",
  "status": "pending",
  "last_commit": null,
  "tests_passed": null,
  "typecheck_passed": null,
  "lint_passed": null,
  "merged_to_overnight": false,
  "todo_morning": []
}
EOF
  echo "created worktree: $WT on $BR"
done

echo
echo "Worktree summary:"
git worktree list
