#!/usr/bin/env bash
# paper-book-up.sh (D-586) — the paper rung's own runner. Until now the rung was "armed" only in the sense that the
# table and the executor existed: NOTHING scheduled it, so it would never have marked a month even once the panel
# caught up. Runs daily, marks any complete month at or after the arm month, and is a no-op otherwise (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
echo "=== paper-book run $(date -u +%FT%TZ) ==="
deno run --allow-net --allow-env --allow-read --allow-write ../scripts/paper-book.ts
echo "=== attribution refresh (own log: the agent-output guard reads one file per agent) ==="
deno run --allow-net --allow-env --allow-read --allow-write ../scripts/aegis-attribution.ts > ./data/attribution.log 2>./data/attribution.err
tail -5 ./data/attribution.log
echo "=== done $(date -u +%FT%TZ) ==="
