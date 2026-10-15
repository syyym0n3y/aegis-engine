#!/usr/bin/env bash
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"; . "$(dirname "$SELF")/_self-restart.sh"  # D-824: a parse-once loop cannot see its own source change; this makes it exec the current file.
. "$(dirname "$SELF")/_night-window.sh"; NW_START=03:40  # D-989: hold the launchd slot — no `sleep 86400` drift, no off-window cycle after a reload
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start >/dev/null 2>&1) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
while true; do
  self_restart_if_changed
  nw_wait_for_window; self_restart_if_changed   # D-989: outside the slot, wait for it (re-check source after a long hold)
  deno run --allow-net --allow-env ../scripts/crypto-forward.ts || true
  nw_wait_next_start   # D-989: was `sleep 86400` — start walked ~2h later every day (cycle duration + 24h)
done
