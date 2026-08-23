#!/bin/bash
# ingest-cot-disagg.sh (D-507) — CFTC disaggregated COT: hist 2006-2016 zip + annual 2017->. Idempotent.
set -uo pipefail
D=/Users/ona/aegis-data/cot; mkdir -p "$D"; cd "$D"
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
FILES="fut_disagg_txt_hist_2006_2016.zip $(for y in $(seq 2017 2026); do echo fut_disagg_txt_${y}.zip; done)"
for z in $FILES; do
  [ -s "$z" ] || curl -s -o "$z" "https://www.cftc.gov/files/dea/history/${z}" --max-time 300
  if ! unzip -l "$z" >/dev/null 2>&1; then echo "$z: MISSING"; rm -f "$z"; continue; fi
  unzip -p "$z" | awk -F',' 'NR>1 {
    line=$0; if(substr(line,1,1)!="\"") next;
    q=index(substr(line,2),"\""); rest=substr(line,q+2); sub(/^[ ]*,[ ]*/,"",rest);
    n=split(rest,a,",");
    if(n<16) next;
    gsub(/[ "]/,"",a[2]); gsub(/[ "]/,"",a[3]);
    if(a[2] !~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ || a[3]=="") next;
    printf "%s\t%s\t%d\t%d\t%d\t%d\t%d\n", a[3], a[2], a[7], a[8], a[9], a[13], a[14]
  }' > disagg.tsv
  rows=$(wc -l < disagg.tsv | tr -d ' ')
  { echo "create temp table stage_dg (market_code text, report_date date, oi bigint, pm_l bigint, pm_s bigint, mm_l bigint, mm_s bigint);
\\copy stage_dg from stdin with (format text)"
    cat disagg.tsv
    echo "\\."
    echo "insert into trd_cot_disagg select distinct on (market_code, report_date) * from stage_dg on conflict (market_code, report_date) do nothing;"
  } | $PSQL
  if [ $? -ne 0 ]; then echo "$z: WRITE-FAILED"; else echo "$z: $rows rows"; fi
  rm -f disagg.tsv "$z"
done
$PSQL -Atc "select count(*), min(report_date), max(report_date), count(distinct market_code) from trd_cot_disagg;" | xargs echo "TOTAL:"
