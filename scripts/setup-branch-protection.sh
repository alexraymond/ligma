#!/usr/bin/env bash
# Setup branch protection rules for the main branch.
# Requires: gh CLI authenticated with repo admin access.
#
# Usage: bash scripts/setup-branch-protection.sh
#
# The repository is read from *this* checkout's GitHub remote, never hardcoded —
# a hardcoded slug means running the script unedited reconfigures somebody
# else's repo (D7 MC-269). Override with REPO_SLUG=owner/repo, BRANCH=name.

set -euo pipefail

cd "$(dirname "$0")/.."

REPO_SLUG="${REPO_SLUG:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"
BRANCH="${BRANCH:-main}"

if [ -z "$REPO_SLUG" ]; then
  echo "error: this checkout has no GitHub remote gh can resolve." >&2
  echo "       Set REPO_SLUG=owner/repo and re-run." >&2
  exit 1
fi

echo "Setting branch protection rules for $REPO_SLUG ($BRANCH)..."

gh api \
  --method PUT \
  "/repos/$REPO_SLUG/branches/$BRANCH/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint & Typecheck",
      "Test"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

echo "Branch protection rules configured successfully."
echo ""
echo "Rules applied:"
echo "  - Required status checks: Lint & Typecheck, Test (see .github/workflows/ci.yml)"
echo "  - Strict status checks (branch must be up-to-date)"
echo "  - 1 approving review required"
echo "  - Stale reviews dismissed on new pushes"
echo "  - Force pushes disabled"
echo "  - Branch deletion disabled"
