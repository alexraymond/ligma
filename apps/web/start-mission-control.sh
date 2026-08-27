#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Ligma - Start Script (Linux/macOS)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE=".mc.pid"
PORT=3000
URL="http://localhost:$PORT"

# --- Pre-flight: check if already running via PID file ---
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo ""
        echo "[Ligma] Already running (PID $OLD_PID)."
        echo "  To stop it:  ./stop-mission-control.sh"
        echo "  To use it:   $URL"
        echo ""
        exit 1
    else
        echo "[Ligma] Cleaning up stale PID file."
        rm -f "$PID_FILE"
    fi
fi

# --- Pre-flight: check if port is in use ---
EXISTING_PID=""
if command -v lsof &>/dev/null; then
    EXISTING_PID=$(lsof -ti:"$PORT" 2>/dev/null || true)
elif command -v ss &>/dev/null; then
    EXISTING_PID=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' || true)
fi

if [ -n "$EXISTING_PID" ]; then
    echo ""
    echo "[Ligma] Port $PORT is already in use (PID $EXISTING_PID)."
    echo "  To stop it:  ./stop-mission-control.sh"
    echo "  To use it:   $URL"
    echo ""
    exit 1
fi

# --- Cleanup handler ---
cleanup() {
    rm -f "$PID_FILE"
    echo ""
    echo "[Ligma] Server stopped."
}
trap cleanup EXIT INT TERM

# --- Open browser once server is ready (polls port, up to 60s) ---
(
    elapsed=0
    while [ $elapsed -lt 60 ]; do
        sleep 2
        elapsed=$((elapsed + 2))
        if bash -c "echo >/dev/tcp/127.0.0.1/$PORT" 2>/dev/null; then
            if command -v open &>/dev/null; then
                open "$URL" 2>/dev/null
            elif command -v xdg-open &>/dev/null; then
                xdg-open "$URL" 2>/dev/null
            elif command -v wslview &>/dev/null; then
                wslview "$URL" 2>/dev/null
            fi
            break
        fi
    done
) &

# --- Start dev server ---
echo ""
echo "[Ligma] Starting dev server..."
echo "  URL:  $URL"
echo "  Stop: Press Ctrl+C, or run ./stop-mission-control.sh"
echo ""

# Start pnpm dev in background, capture PID, then wait for it
pnpm dev &
DEV_PID=$!
echo "$DEV_PID" > "$PID_FILE"

# Wait for the dev server process (blocks until Ctrl+C or process exits)
wait "$DEV_PID" 2>/dev/null || true
