#!/usr/bin/env bash
# overnight-merge.sh — merge a green workstream branch into `overnight`.
#
# Usage: overnight-merge.sh <workstream-id>   # e.g. w1, w2, w3, ...
#
# Preconditions: workstream tests/typecheck/lint all passed in its worktree.
# Strategy: checkout `overnight` in the main repo, fast-forward from the
# workstream branch; on conflict, retry with `-X theirs` limited to
# generated files (pnpm-lock.yaml, dist-like). On any failure, write a
# conflict report to .claude/workspace/overnight/<id>-conflict.md and exit
# non-zero. Never force-merge, never push.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <workstream-id>" >&2
  exit 2
fi

WS="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$REPO_ROOT/.claude/workspace/overnight"
STATE="$STATE_DIR/$WS.json"
BR="ligma/overnight/$WS"

cd "$REPO_ROOT"

if [ ! -f "$STATE" ]; then
  echo "no state file for $WS — was it set up? ($STATE missing)" >&2
  exit 2
fi

if ! git show-ref --verify --quiet "refs/heads/$BR"; then
  echo "branch $BR does not exist" >&2
  exit 2
fi

PRIOR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
trap 'git checkout "$PRIOR_BRANCH" >/dev/null 2>&1 || true' EXIT

git checkout overnight

# Try fast-forward only first.
if git merge --ff-only "$BR" 2>/dev/null; then
  echo "fast-forward merged: $BR → overnight"
  MERGED=true
else
  # Non-ff. Try a normal merge; let conflicts surface.
  if git merge --no-ff --no-edit "$BR"; then
    echo "non-ff merged: $BR → overnight"
    MERGED=true
  else
    # Conflict. Abort and write a report.
    git merge --abort || true
    REPORT="$STATE_DIR/$WS-conflict.md"
    {
      echo "# Workstream $WS merge conflict"
      echo
      echo "Branch: $BR"
      echo "Attempted at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo
      echo "## Conflicting files"
      git diff --name-only --diff-filter=U "$BR" overnight 2>/dev/null || true
      echo
      echo "## Recent commits on $BR"
      git log --oneline main.."$BR" | head -20
      echo
      echo "Action: human review required in the morning."
    } > "$REPORT"
    echo "conflict — report at $REPORT" >&2
    MERGED=false
  fi
fi

# Update state file.
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HEAD_SHA="$(git rev-parse HEAD)"
python3 - "$STATE" "$MERGED" "$HEAD_SHA" "$TS" <<'PY'
import json, sys, pathlib
path, merged, sha, ts = sys.argv[1:]
p = pathlib.Path(path)
data = json.loads(p.read_text())
data["merged_to_overnight"] = (merged == "true")
data["merged_at"] = ts if merged == "true" else None
data["overnight_head_after_merge"] = sha if merged == "true" else None
p.write_text(json.dumps(data, indent=2) + "\n")
PY

[ "$MERGED" = true ]
