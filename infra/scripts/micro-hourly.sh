#!/bin/bash
# micro-hourly.sh (D-823) — the MICRO rung runs on an HOURLY rule, so its inputs and its sheet refresh hourly.
# Refreshes the crypto 1h panel (fapi, one symbol per read) and yesterday+today of the 8 Dukascopy hourly series, then
# prints today's sheet to data/micro-sheet.log. Skips a step if the daily loop is already running the same ingest
# (two writers of the same upsert are harmless but pointless). Sequential; keyless; allowlisted hosts only.
set -u
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
export PATH="/opt/homebrew/bin:/usr/bin:/bin:$HOME/.deno/bin:$PATH"
export OWNED_REST="http://localhost:${REST_PORT:-33000}"   # same resolution as the daily runner; the probe below needs it explicitly
T0=$(date -u +%FT%TZ)
# D-823e: BACK OFF WHEN THE NODE IS BUSY. The daily cycle's heavy steps (liquid panel, 1,230 symbols) and this job can
# overlap; measured 2026-09-08, a one-row query took 33s while both ran and docker sat at 2.77GB of 3.9GB — within reach
# of the OOM that killed a backend in D-812. So: time a trivial read first; above the budget, SKIP the ingests and print
# the sheet from what is stored (the sheet already prints bar age, so stale is visible, not hidden).
# POSITIVE CONTROL on the check itself (D-641): a failed token or an unreachable node makes the request return FAST,
# which a naive timer reads as "not busy" — the false-zero class. So require HTTP 200; anything else counts as BUSY.
TOK="$(deno run --allow-env --allow-net ../scripts/_jwt.ts 2>/dev/null)"
PROBE="$(curl -s -o /dev/null -m 30 -w '%{http_code} %{time_total}' -H "Authorization: Bearer $TOK" "$OWNED_REST/trd_prereg?select=id&limit=1" 2>/dev/null)"
CODE="$(echo "$PROBE" | awk '{print $1}')"; LAT="$(echo "$PROBE" | awk '{print int($2)}')"
CODE=${CODE:-000}; LAT=${LAT:-99}
if [ "$CODE" != "200" ] || [ "$LAT" -ge 5 ]; then
  echo "$T0 MICRO HOURLY: node busy or unreachable (HTTP $CODE, one-row read ${LAT}s; budget 200/<5s) — skipping ingests this hour, printing the stored sheet"
  LAT=99
else
  # Only the five perps the sheet trades, not all 25 (D-823e).
  if ! ps -eo command | grep -v grep | grep -q "scripts/refresh-perp-panels.ts"; then
    PANELS=1h:1h MAX_PAGES=2 SYMBOLS="BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" deno run --allow-net --allow-env ../scripts/refresh-perp-panels.ts > ../data/micro-perp-refresh.log 2>&1 || echo "$T0 MICRO HOURLY: perp 1h refresh FAILED"
  fi
fi
if ! ps -eo command | grep -v grep | grep -q "scripts/ingest-dukascopy.py"; then
  FROM=$(date -u -v-1d +%F 2>/dev/null || date -u -d '1 day ago' +%F) PAIRS="EURUSD:1e-5,GBPUSD:1e-5,USDJPY:1e-3,AUDUSD:1e-5,XAUUSD:1e-3,USA500IDXUSD:1e-3,USATECHIDXUSD:1e-3" python3 ../scripts/ingest-dukascopy.py > ../data/micro-fx-refresh.log 2>&1 || echo "$T0 MICRO HOURLY: fx refresh FAILED"
fi
[ "$LAT" -ge 5 ] || RANGE=5d deno run --allow-net --allow-env ../scripts/refresh-fx-live.ts > ../data/micro-fx-live.log 2>&1 || echo "$T0 MICRO HOURLY: fx LIVE refresh FAILED (see data/micro-fx-live.log)"
deno run --allow-net --allow-env ../scripts/micro-sheet.ts > ../data/micro-sheet.log 2>&1 || echo "$T0 MICRO HOURLY: sheet FAILED"
echo "$T0 MICRO HOURLY done: $(grep -o '[0-9]* candidate(s); [0-9]* instrument(s) STALE' ../data/micro-sheet.log)"
