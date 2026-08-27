#!/bin/bash
# ingest-yield-curve.sh (W2) — US Treasury daily yield curve, free and keyless.
#
# Closes a gap found in Week 2's coverage audit: this programme held NO rates data, and the attribution engine used
# TLT (a single long-duration ETF) as its entire RATES force. That proxy carries the fund's own duration and flow
# effects and cannot express curve shape. The real curve was free, keyless and already allowlisted.
#
# Sequential by construction — one year per request, awaited. Idempotent: ON CONFLICT DO NOTHING, so re-runs cost
# nothing and cannot duplicate.
set -uo pipefail
cd "$(dirname "$0")/.."
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
FROM=${FROM_YEAR:-1990}
TO=${TO_YEAR:-$(date +%Y)}
TMP=/tmp/yc.tsv; : > "$TMP"
for y in $(seq "$FROM" "$TO"); do
  url="https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv"
  n=$(curl -s --max-time 120 "$url" | awk -F',' '
    NR==1 { for(i=1;i<=NF;i++){h=$i; gsub(/"/,"",h); col[i]=h}; next }
    { gsub(/"/,""); split($1,d,"/"); if(length(d)!=3) next;
      printf "%s-%s-%s", d[3], d[1], d[2];
      # emit the 14 tenors in fixed order, blank where absent
      for(i=2;i<=15;i++){ v=(i<=NF)?$i:""; printf "\t%s", (v==""?"\\N":v) }
      printf "\n" }' | tee -a "$TMP" | wc -l | tr -d ' ')
  echo "  ${y}: ${n} rows"
  sleep 0.3
done
rows=$(wc -l < "$TMP" | tr -d ' ')
{ echo "create temp table stage_yc (d date, m1 float8, m1_5 float8, m2 float8, m3 float8, m4 float8, m6 float8, y1 float8, y2 float8, y3 float8, y5 float8, y7 float8, y10 float8, y20 float8, y30 float8);
\\copy stage_yc from stdin with (format text, null '\\N')"
  cat "$TMP"
  echo "\\."
  echo "insert into trd_yield_curve (d,m1,m1_5,m2,m3,m4,m6,y1,y2,y3,y5,y7,y10,y20,y30) select distinct on (d) * from stage_yc order by d on conflict (d) do nothing;"
} | $PSQL
if [ $? -ne 0 ]; then echo "WRITE-FAILED"; exit 1; fi
# Verify by RE-READING, never by trusting the write.
$PSQL -Atc "select 'IN DB: '||count(*)||' days, '||min(d)||' .. '||max(d) from trd_yield_curve;"
rm -f "$TMP"
