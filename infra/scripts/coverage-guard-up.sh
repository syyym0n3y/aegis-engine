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
  # BREADTH LAW (D-446): three times a large number came from a CONCENTRATED book and evaporated when the concentration
  # was removed (D-415 pooling, D-423 score-weighting, D-443 a 14-name quintile sort at "SR 1.13"). A t-stat cannot tell
  # a factor from a few idiosyncratic bets; this can.
  if ! deno run --allow-net --allow-env ../scripts/breadth-guard.ts; then
    echo "$(date -u +%FT%TZ) BREADTH GUARD RED — a promoted cross-sectional result was computed on too few names"
  fi
  # EXECUTION LAW (D-449): the strongest candidate in the program (D-447) cleared its bar only under a MAKER assumption,
  # and that assumption was false — measured on 5m bars the passive order fills 92% of the time and those days return
  # -1.85bp, while the +68bp lives in the 8% that never fill. A maker fee is a hypothesis about fills, not a cost.
  if ! deno run --allow-net --allow-env ../scripts/execution-guard.ts; then
    echo "$(date -u +%FT%TZ) EXECUTION GUARD RED — a maker-dependent result has no fill-conditional return"
  fi
  # SELECTION LAW (D-456): D-405 chose WHICH asset classes to overlay using the full sample, then reported an OOS Sharpe
  # of 0.37 on that choice. Re-made on train only, the overlay was negative in every class and the book collapsed onto
  # passive. Look-ahead in the CHOICE is invisible to every other guard — the returns and the split were both correct.
  if ! deno run --allow-net --allow-env ../scripts/selection-guard.ts; then
    echo "$(date -u +%FT%TZ) SELECTION GUARD RED — a promoted result may have chosen its components using the evaluation window"
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
