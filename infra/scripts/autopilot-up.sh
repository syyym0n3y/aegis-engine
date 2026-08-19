#!/usr/bin/env bash
# autopilot-up.sh — bring the owned node up (idempotent) + run the autonomous autopilot daemon. This is the single entry the
# launchd/systemd unit calls. Self-healing: if colima/containers are down it brings them up; the autopilot skips+retries a
# cycle if the node is briefly unavailable. Runs forever (DORMANT — research only, never trades/spends).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start --cpu 2 --memory 4) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || bash scripts/provision-owned.sh || true
export OWNED_REST="http://localhost:${REST_PORT:-3000}"
exec deno run --allow-net --allow-env ../scripts/aegis-autopilot.ts
