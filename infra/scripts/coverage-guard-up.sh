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
  # EFFECT-SIZE LAW (D-429): D-426 produced 20/20 sign consistency at |t| 4.9 on a $523M/hour instrument and was STILL
  # untradable at 0.02-0.14x the fee. Significance answers "is it there"; only fee-multiples answer "is it worth acting on".
  if ! deno run --allow-net --allow-env ../scripts/effect-size-guard.ts; then
    echo "$(date -u +%FT%TZ) EFFECT-SIZE GUARD RED — a promoted strategy has no stated edge larger than its own cost"
  fi
  # BASIS WATCH (D-432): the quarterly carry is real, needs no forecast, and has decayed to ~0 — but it is CONDITIONAL, not
  # dead. A filed-away research verdict would never notice it returning. DORMANT: surfaces only, nothing armed.
  deno run --allow-net --allow-env ../scripts/basis-watch.ts || true
  # OPTION SKEW COLLECTOR (D-444): Deribit publishes no historical option chain, so skew and term structure are UNTESTED
  # rather than null. The honest response to a genuinely-unavailable history is to start the clock — this snapshots the
  # live surface daily so the series exists to test later. Idempotent (UTC day bucket); measures, never trades.
  deno run --allow-net --allow-env ../scripts/collect-option-skew.ts || true
  sleep 86400
done
