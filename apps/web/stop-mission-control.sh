#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Ligma - Stop Script (Linux/macOS)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE=".mc.pid"
PORT=3000

echo ""
echo "[Ligma] Stopping server on port $PORT..."

KILLED=false

# --- Strategy 1: Kill via PID file (preferred, kills process group) ---
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "  Killing process group for PID $PID..."
        # Kill the entire process group (pnpm + node + next children)
        kill -- -"$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true
        # Give it a moment, then force-kill if needed
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            echo "  Force-killing PID $PID..."
            kill -9 -- -"$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
        fi
        KILLED=true
    else
        echo "  PID $PID from PID file is no longer running."
    fi
    rm -f "$PID_FILE"
fi

# --- Strategy 2: Kill anything still on the port (fallback) ---
PORT_PIDS=""
if command -v lsof &>/dev/null; then
    PORT_PIDS=$(lsof -ti:"$PORT" 2>/dev/null || true)
elif command -v fuser &>/dev/null; then
    PORT_PIDS=$(fuser "$PORT/tcp" 2>/dev/null || true)
fi

if [ -n "$PORT_PIDS" ]; then
    for P in $PORT_PIDS; do
        echo "  Killing remaining process on port $PORT: PID $P..."
        kill -9 "$P" 2>/dev/null || true
        KILLED=true
    done
fi

# --- Verify port is free ---
sleep 1
STILL_RUNNING=""
if command -v lsof &>/dev/null; then
    STILL_RUNNING=$(lsof -ti:"$PORT" 2>/dev/null || true)
fi

if [ -n "$STILL_RUNNING" ]; then
    echo ""
    echo "  WARNING: Port $PORT is still in use (PID $STILL_RUNNING)."
    echo "  You may need to kill it manually: kill -9 $STILL_RUNNING"
    echo ""
    exit 1
fi

if [ "$KILLED" = true ]; then
    echo ""
    echo "[Ligma] Server stopped. Port $PORT is free."
else
    echo "  No running Ligma process found."
    echo ""
    echo "[Ligma] Nothing to stop."
fi
echo ""
