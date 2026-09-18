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
  deno run --allow-net --allow-env ../scripts/aegis-daily.ts || true
  echo "=== on-chain refresh (D-928, blockchain.info keyless) ==="
  deno run --allow-net --allow-env ../scripts/ingest-onchain.ts || true
  echo "=== intraday perp refresh (D-881 5m/1m90 magnified history, Binance keyless) — wire the ingest that had no invoker (D-944) ==="
  # D-944: ingest-perp-5m.ts wrote trd_bars_intraday 5m/1m90 for BTC/ETH/SOL/XRP/BNB but NOTHING scheduled it, so the
  # current-quarter chunk froze 4.5d after the last manual run and reddened data-stack. A daily refresh keeps it ~1d
  # fresh (well inside the 4d budget). Idempotent upsert on (symbol,tf); keyless; sequential; $0.
  deno run --allow-net --allow-env ../scripts/ingest-perp-5m.ts || true
  sleep 86400
done
