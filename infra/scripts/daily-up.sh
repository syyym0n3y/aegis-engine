#!/usr/bin/env bash
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"; . "$(dirname "$SELF")/_self-restart.sh"  # D-824: a parse-once loop cannot see its own source change; this makes it exec the current file.
. "$(dirname "$SELF")/_night-window.sh"; NW_START=02:10  # D-989: hold the launchd slot — no `sleep 86400` drift, no off-window cycle after a reload
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
command -v colima >/dev/null && (colima status >/dev/null 2>&1 || colima start >/dev/null 2>&1) || true
docker start aegis-db aegis-rest >/dev/null 2>&1 || true
export OWNED_REST="http://localhost:${REST_PORT:-33000}"
while true; do
  self_restart_if_changed
  nw_wait_for_window; self_restart_if_changed   # D-989: outside the slot, wait for it (re-check source after a long hold)
  deno run --allow-net --allow-env ../scripts/aegis-daily.ts || true
  echo "=== on-chain refresh (D-928, blockchain.info keyless) ==="
  deno run --allow-net --allow-env ../scripts/ingest-onchain.ts || true
  echo "=== intraday perp refresh (D-881 5m/1m90 magnified history, Binance keyless) — wire the ingest that had no invoker (D-944) ==="
  # D-944: ingest-perp-5m.ts wrote trd_bars_intraday 5m/1m90 for BTC/ETH/SOL/XRP/BNB but NOTHING scheduled it, so the
  # current-quarter chunk froze 4.5d after the last manual run and reddened data-stack. A daily refresh keeps it ~1d
  # fresh (well inside the 4d budget). Idempotent upsert on (symbol,tf); keyless; sequential; $0.
  deno run --allow-net --allow-env ../scripts/ingest-perp-5m.ts || true
  # D-982: trd_yield_curve went 50 DAYS stale because ingest-yield-curve.sh existed and NOTHING invoked it —
  # the orphaned-ingest class (D-944) recurring. Keyless; idempotent; backfills whatever it missed.
  bash ../scripts/ingest-yield-curve.sh >/dev/null 2>&1 || echo "$(date -u +%FT%TZ) YIELD CURVE INGEST FAILED"
  # D-976: the regime tape — every clock mark is uninterpretable without knowing which market it ran through
  # (D-944/945: the sleeves are regime-specialised). Keyless, derived from bars already held, joined BY DATE.
  deno run --v8-flags=--max-old-space-size=4096 --allow-net --allow-env --allow-read ../scripts/market-context.ts >/dev/null 2>&1 || echo "$(date -u +%FT%TZ) MARKET CONTEXT FAILED"
  echo "=== blockchair multi-chain feed (D-966, keyless, 6 chains, accrual feed) ==="
  deno run --allow-net --allow-env ../scripts/ingest-blockchair.ts || true
  nw_wait_next_start   # D-989: was `sleep 86400` — start walked ~2h later every day (cycle duration + 24h)
done
