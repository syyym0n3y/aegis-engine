#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
while true; do
  if ! deno run --allow-net --allow-env ../scripts/coverage-guard.ts; then
    echo "$(date -u +%FT%TZ) COVERAGE GUARD RED — a factor family lacks adequate data; nulls there are UNTESTED, not NULL"
  fi
  # LIQUIDITY LAW (D-424): two independent panels showed the entire cross-sectional return sits in the illiquid tail
  # (liq:HIGH SR 0.26 and 0.04). A promotion without a liquid-tercile number is a promotion of something that cannot
  # absorb size, so the same daily agent certifies both laws.
  if ! deno run --allow-net --allow-env ../scripts/liquidity-guard.ts; then
    echo "$(date -u +%FT%TZ) LIQUIDITY GUARD RED — a promoted strategy has no demonstrated edge in the liquid tercile"
  fi
  sleep 86400
done
