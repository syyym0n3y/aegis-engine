#!/bin/bash
# micro-hourly.sh (D-823) — the MICRO rung runs on an HOURLY rule, so its inputs and its sheet refresh hourly.
# Refreshes the crypto 1h panel (fapi, one symbol per read) and yesterday+today of the 8 Dukascopy hourly series, then
# prints today's sheet to data/micro-sheet.log. Skips a step if the daily loop is already running the same ingest
# (two writers of the same upsert are harmless but pointless). Sequential; keyless; allowlisted hosts only.
set -u
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
export PATH="/opt/homebrew/bin:/usr/bin:/bin:$HOME/.deno/bin:$PATH"
T0=$(date -u +%FT%TZ)
if ! ps -eo command | grep -v grep | grep -q "scripts/refresh-perp-panels.ts"; then
  PANELS=1h:1h MAX_PAGES=2 deno run --allow-net --allow-env ../scripts/refresh-perp-panels.ts > ../data/micro-perp-refresh.log 2>&1 || echo "$T0 MICRO HOURLY: perp 1h refresh FAILED"
fi
if ! ps -eo command | grep -v grep | grep -q "scripts/ingest-dukascopy.py"; then
  FROM=$(date -u -v-1d +%F 2>/dev/null || date -u -d '1 day ago' +%F) PAIRS="EURUSD:1e-5,GBPUSD:1e-5,USDJPY:1e-3,AUDUSD:1e-5,XAUUSD:1e-3,USA500IDXUSD:1e-3,USATECHIDXUSD:1e-3" python3 ../scripts/ingest-dukascopy.py > ../data/micro-fx-refresh.log 2>&1 || echo "$T0 MICRO HOURLY: fx refresh FAILED"
fi
deno run --allow-net --allow-env ../scripts/micro-sheet.ts > ../data/micro-sheet.log 2>&1 || echo "$T0 MICRO HOURLY: sheet FAILED"
echo "$T0 MICRO HOURLY done: $(grep -o '[0-9]* candidate(s); [0-9]* instrument(s) STALE' ../data/micro-sheet.log)"
