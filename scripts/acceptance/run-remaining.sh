#!/bin/sh
# Self-gating sequential campaign launcher: waits for governor headroom before
# each chain so the campaign never crowds Alex's reserve (brief §4 principle 9).
set -u
REPO=/Users/alexraymond/ligma
OUT="$REPO/docs/evidence/campaign"
STATUS="${CAMPAIGN_STATUS_LOG:-/tmp/campaign-status.log}"
NEED=12

say() { echo "$(date -u +%H:%M:%S) $1" >> "$STATUS"; }

headroom() {
  cd "$REPO/apps/daemon" && npx tsx src/engine/governor-status.ts 2>/dev/null \
    | grep remainingForAutonomy | grep -oE '[0-9]+' | head -1
}

for CHAIN in "$@"; do
  while true; do
    H=$(headroom); H=${H:-0}
    if [ "$H" -lt "$NEED" ]; then
      say "hold $CHAIN — governor headroom $H < $NEED, waiting"
      sleep 300
      continue
    fi
    if ! (cd "$REPO" && npx tsx scripts/acceptance/preflight.ts >> "$STATUS.$CHAIN.log" 2>&1); then
      say "hold $CHAIN — preflight failed (see $STATUS.$CHAIN.log), retry in 15m"
      sleep 900
      continue
    fi
    break
  done
  say "launch $CHAIN (headroom $H)"
  cd "$REPO" && npx tsx scripts/acceptance/run-campaign.ts "$CHAIN" --out "$OUT" >> "$STATUS.$CHAIN.log" 2>&1
  RESULT=$(python3 -c "import json;print(json.load(open('$OUT/$CHAIN/manifest.json')).get('result','?'))" 2>/dev/null || echo "no-manifest")
  say "done $CHAIN → $RESULT"
done
say "sequence complete"
