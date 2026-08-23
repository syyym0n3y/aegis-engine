#!/bin/bash
# ingest-cot-tff.sh (D-509) — CFTC TFF: hist 2006-2016 + annual 2017->. Idempotent.
set -uo pipefail
D=/Users/ona/aegis-data/cot; mkdir -p "$D"; cd "$D"
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
FILES="$(for y in $(seq 2010 2016); do echo fut_fin_txt_${y}.zip; done) $(for y in $(seq 2017 2026); do echo fut_fin_txt_${y}.zip; done)"
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
    printf "%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\n", a[3], a[2], a[7], a[8], a[9], a[11], a[12], a[14], a[15]
  }' > tff.tsv
  rows=$(wc -l < tff.tsv | tr -d ' ')
  { echo "create temp table stage_tf (market_code text, report_date date, oi bigint, dl_l bigint, dl_s bigint, am_l bigint, am_s bigint, lm_l bigint, lm_s bigint);
\\copy stage_tf from stdin with (format text)"
    cat tff.tsv
    echo "\\."
    echo "insert into trd_cot_tff select distinct on (market_code, report_date) * from stage_tf on conflict (market_code, report_date) do nothing;"
  } | $PSQL
  if [ $? -ne 0 ]; then echo "$z: WRITE-FAILED"; else echo "$z: $rows rows"; fi
  rm -f tff.tsv "$z"
done
$PSQL -Atc "select count(*), min(report_date), max(report_date), count(distinct market_code) from trd_cot_tff;" | xargs echo "TOTAL:"
