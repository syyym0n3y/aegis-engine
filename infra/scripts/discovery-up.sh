#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
exec deno run --v8-flags=--max-old-space-size=6144 --allow-net --allow-env ../scripts/aegis-discovery.ts
