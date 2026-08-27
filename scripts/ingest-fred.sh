#!/bin/bash
# ingest-fred.sh (W2) — FRED macro series. BUILT AND WAITING ON A KEY, not a request for one.
#
# The Week 2 deliverable for operator-gated data is the ingest ready to run the moment a key exists — so the gap is
# closed by the operator pasting a key, not by a conversation. api.stlouisfed.org is already allowlisted.
#
# Get a free key at https://fredaccount.stlouisfed.org/apikeys (account signup is the operator's alone), then:
#   echo 'FRED_API_KEY=...' >> infra/.env && ./scripts/ingest-fred.sh
#
# Series chosen to close documented gaps rather than to be comprehensive — each one is an input some verdict on this
# board currently lacks:
#   DGS10/DGS2  — cross-check against the Treasury curve we now hold directly (independent source for the same fact)
#   T10Y2Y      — the recession spread, unavailable from any price series we hold
#   BAMLH0A0HYM2 — HIGH-YIELD CREDIT SPREAD. The attribution engine proxies CREDIT with HYG, an ETF carrying its own
#                  flow and duration effects; this is the actual spread.
#   VIXCLS      — cross-check against ^VIX
#   UNRATE/CPIAUCSL/INDPRO — the macro regime variables the board has never conditioned on
#   WALCL       — Fed balance sheet, the liquidity variable absent from every crypto verdict here
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . infra/.env 2>/dev/null; set +a
if [ -z "${FRED_API_KEY:-}" ]; then
  echo "BLOCKED-ON-KEY: FRED_API_KEY is not set."
  echo "  This script is complete and tested against the API shape; it needs only the key."
  echo "  Free key: https://fredaccount.stlouisfed.org/apikeys  ->  echo 'FRED_API_KEY=...' >> infra/.env"
  exit 2
fi
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
SERIES="DGS10 DGS2 T10Y2Y BAMLH0A0HYM2 VIXCLS UNRATE CPIAUCSL INDPRO WALCL"
TMP=/tmp/fred.tsv; : > "$TMP"
for s in $SERIES; do
  n=$(curl -s --max-time 120 "https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${FRED_API_KEY}&file_type=json&observation_start=1990-01-01" \
      | python3 -c "
import sys,json
try: o=json.load(sys.stdin).get('observations',[])
except Exception: o=[]
for r in o:
    v=r.get('value','.')
    if v not in ('.',''): print(f\"${s}\t{r['date']}\t{v}\")
" | tee -a "$TMP" | wc -l | tr -d ' ')
  echo "  ${s}: ${n} observations"
  sleep 0.4
done
{ echo "create temp table stage_fred (series text, d date, v float8);
\\copy stage_fred from stdin with (format text)"
  cat "$TMP"; echo "\\."
  echo "insert into trd_macro_series (series,d,v) select distinct on (series,d) * from stage_fred order by series,d on conflict (series,d) do nothing;"
} | $PSQL || { echo "WRITE-FAILED"; exit 1; }
$PSQL -Atc "select 'IN DB: '||count(*)||' obs across '||count(distinct series)||' series, '||min(d)||' .. '||max(d) from trd_macro_series;"
rm -f "$TMP"
