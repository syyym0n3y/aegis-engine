#!/bin/bash
# ingest-nport.sh (D-488) — SEC DERA N-PORT quarterly data sets -> per-(cusip,month) fund-ownership aggregates.
# Stage 0: rebuild trd_cusip_map from sparse FTD files (they carry CUSIP+SYMBOL; raw FTDs were deleted post-ingest).
# Stage 1: per quarter — download zip, stream-aggregate FUND_REPORTED_HOLDING (equity/NS rows only) with awk keyed
# by accession->report_date from SUBMISSION.tsv, \copy the aggregate, delete the raw. Idempotent (ON CONFLICT).
set -uo pipefail
D=/Users/ona/aegis-data/nport; mkdir -p "$D"; cd "$D"
UA="aegis-research ona@revitalise.io"
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"

echo "== stage 0: cusip bridge from sparse FTD files"
for ym in 201803 201809 201903 201909 202003 202009 202103 202109 202203 202209 202303 202309 202403 202409 202503 202509 202603; do
  for half in a b; do
    f="cnsfails${ym}${half}.zip"
    [ -s "$f" ] || curl -s -o "$f" "https://www.sec.gov/files/data/fails-deliver-data/${f}" -H "User-Agent: $UA" --max-time 120
    unzip -p "$f" 2>/dev/null | awk -F'|' 'NR>1 && $2 ~ /^[0-9A-Z]{9}$/ && $3 != "" {print $2 "\t" $3}'
    break   # one half-file per stamp is enough for the map
  done
done | sort -u | awk -F'\t' '!seen[$1]++' > cusip_map.tsv
wc -l cusip_map.tsv
{ echo "create temp table stage_map (cusip text, symbol text);
\\copy stage_map from stdin with (format text)"
  cat cusip_map.tsv
  echo "\\."
  echo "insert into trd_cusip_map select distinct on (cusip) cusip, symbol from stage_map
  on conflict (cusip) do update set symbol=excluded.symbol;"
} | $PSQL
$PSQL -Atc "select count(*) from trd_cusip_map;" | xargs echo "bridge rows:"

echo "== stage 1: quarters"
QUARTERS="${QUARTERS:-2019q4 2020q1 2020q2 2020q3 2020q4 2021q1 2021q2 2021q3 2021q4 2022q1 2022q2 2022q3 2022q4 2023q1 2023q2 2023q3 2023q4 2024q1 2024q2 2024q3 2024q4 2025q1 2025q2 2025q3 2025q4 2026q1 2026q2}"
for q in $QUARTERS; do
  z="${q}_nport.zip"
  if [ ! -s "$z" ]; then
    curl -s -o "$z" "https://www.sec.gov/files/dera/data/form-n-port-data-sets/${z}" -H "User-Agent: $UA" --max-time 900
  fi
  if ! unzip -l "$z" >/dev/null 2>&1; then echo "$q: MISSING/corrupt (size $(stat -f%z "$z" 2>/dev/null))"; rm -f "$z"; continue; fi
  unzip -p "$z" SUBMISSION.tsv > sub.tsv
  # accession -> report_date (DD-MON-YYYY -> ISO)
  unzip -p "$z" FUND_REPORTED_HOLDING.tsv | awk -F'\t' -v SUB=sub.tsv '
    BEGIN{ split("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC",mn," "); for(i=1;i<=12;i++) M[mn[i]]=sprintf("%02d",i);
      while((getline line < SUB)>0){ nf=split(line,a,"\t"); if(a[1]=="ACCESSION_NUMBER") continue;
        split(a[6],d,"-"); if(d[3]!="") RD[a[1]]=d[3]"-"M[d[2]]"-"d[1]; } }
    NR>1 && $15=="EC" && $8=="NS" && $6 ~ /^[0-9A-Z]{9}$/ && $6!="999999999" && ($1 in RD) {
      k=$6 SUBSEP RD[$1]; n[k]++; sh[k]+=$7; v[k]+=$11 }
    END{ for(k in n){ split(k,p,SUBSEP); printf "%s\t%s\t%d\t%.1f\t%.1f\n", p[1], p[2], n[k], sh[k], v[k] } }' > agg.tsv
  rows=$(wc -l < agg.tsv | tr -d ' ')
  { echo "create temp table stage_np (cusip text, report_date date, n_positions int, shares float8, value_usd float8);
\\copy stage_np from stdin with (format text)"
    cat agg.tsv
    echo "\\."
    echo "insert into trd_nport_ownership (cusip, report_date, effective_date, n_positions, shares, value_usd)
  select cusip, report_date, report_date + 60, n_positions, shares, value_usd from stage_np
  on conflict (cusip, report_date) do update
    set n_positions=excluded.n_positions, shares=excluded.shares, value_usd=excluded.value_usd,
        effective_date=excluded.effective_date;"
  } | $PSQL
  if [ $? -ne 0 ]; then echo "$q: WRITE-FAILED"; else echo "$q: $rows cusip-months"; fi
  rm -f agg.tsv sub.tsv "$z"
done
$PSQL -Atc "select count(*), min(report_date), max(report_date), count(distinct cusip) from trd_nport_ownership;" | xargs echo "TOTAL:"
