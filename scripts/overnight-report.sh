#!/usr/bin/env bash
# overnight-report.sh — produce OVERNIGHT-REPORT.md from state files + git.
#
# First thing Alex reads when he wakes up. Summarizes per-workstream status,
# commits, test results, TODO-MORNING notes, and merge outcomes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$REPO_ROOT/.claude/workspace/overnight"
OUT="$REPO_ROOT/OVERNIGHT-REPORT.md"

cd "$REPO_ROOT"

{
  echo "# Ligma Overnight Report"
  echo
  echo "_Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)_"
  echo
  echo "## Summary"
  echo
  printf '| WS | Branch | Status | Tests | Typecheck | Lint | Merged | Commits |\n'
  printf '|----|--------|--------|-------|-----------|------|--------|---------|\n'

  for state in "$STATE_DIR"/*.json; do
    [ -f "$state" ] || continue
    ws=$(jq -r '.id' "$state")
    br=$(jq -r '.branch' "$state")
    status=$(jq -r '.status' "$state")
    tests=$(jq -r '.tests_passed // "—"' "$state")
    tc=$(jq -r '.typecheck_passed // "—"' "$state")
    lint=$(jq -r '.lint_passed // "—"' "$state")
    merged=$(jq -r '.merged_to_overnight' "$state")
    commits="—"
    if git show-ref --verify --quiet "refs/heads/$br"; then
      commits=$(git rev-list --count "main..$br" 2>/dev/null || echo "—")
    fi
    printf '| %s | `%s` | %s | %s | %s | %s | %s | %s |\n' \
      "$ws" "$br" "$status" "$tests" "$tc" "$lint" "$merged" "$commits"
  done

  echo
  echo "## Integration branch"
  echo
  echo "\`\`\`"
  git log --oneline overnight ^main 2>/dev/null | head -40 || echo "(empty)"
  echo "\`\`\`"

  echo
  echo "## Per-workstream detail"
  for state in "$STATE_DIR"/*.json; do
    [ -f "$state" ] || continue
    ws=$(jq -r '.id' "$state")
    br=$(jq -r '.branch' "$state")
    wt=$(jq -r '.worktree' "$state")

    echo
    echo "### $ws"
    echo
    echo "- Branch: \`$br\`"
    echo "- Worktree: \`$wt\`"
    echo

    echo "**Commits (main..$br):**"
    echo
    if git show-ref --verify --quiet "refs/heads/$br"; then
      git log --oneline "main..$br" 2>/dev/null | sed 's/^/- /' | head -20 || echo "- (none)"
    else
      echo "- (branch not found)"
    fi
    echo

    echo "**Files changed:**"
    echo
    if git show-ref --verify --quiet "refs/heads/$br"; then
      git diff --stat "main...$br" 2>/dev/null | tail -5 || echo "(none)"
    fi
    echo

    # Conflict report, if any.
    if [ -f "$STATE_DIR/$ws-conflict.md" ]; then
      echo "**Merge conflict — human review required:**"
      echo
      cat "$STATE_DIR/$ws-conflict.md"
      echo
    fi

    # TODO-MORNING notes from the worktree.
    if [ -d "$wt" ]; then
      todos=$(find "$wt" -name 'TODO-MORNING.md' -not -path '*/node_modules/*' 2>/dev/null || true)
      if [ -n "$todos" ]; then
        echo "**TODO-MORNING notes:**"
        echo
        while IFS= read -r t; do
          echo "_From \`${t#$wt/}\`_:"
          echo
          echo '```'
          cat "$t"
          echo '```'
          echo
        done <<< "$todos"
      fi
    fi
  done

  echo
  echo "## Morning checklist"
  echo
  echo "1. Run the golden-path smoke: \`cd ~/ligma && git checkout overnight && pnpm i && pnpm dev\`"
  echo "2. Verify window title says **Ligma** and a prompt → streamed response works end-to-end."
  echo "3. Check \`rg -i 'open.codesign|todo-morning' ~/ligma\` returns hits only in \`LICENSE\`."
  echo "4. Review TODO-MORNING notes above."
  echo "5. Decide: create GitHub repo + push, commit final palette, tag v0.1.0."
} > "$OUT"

echo "wrote $OUT"
