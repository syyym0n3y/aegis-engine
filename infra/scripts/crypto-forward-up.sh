#!/usr/bin/env bash
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"; . "$(dirname "$SELF")/_self-restart.sh"  # D-824: a parse-once loop cannot see its own source change; this makes it exec the current file.
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
while true; do
  self_restart_if_changed
  deno run --allow-net --allow-env ../scripts/crypto-forward.ts || true
  sleep 86400
done
