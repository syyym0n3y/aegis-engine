#!/bin/bash
# ingest-cot.sh (D-501) — CFTC COT legacy annual files (deacotYYYY.zip -> annual.txt) 1986->present. Idempotent.
set -uo pipefail
D=/Users/ona/aegis-data/cot; mkdir -p "$D"; cd "$D"
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
for y in $(seq 1986 2026); do
  z="deacot${y}.zip"
  [ -s "$z" ] || curl -s -o "$z" "https://www.cftc.gov/files/dea/history/${z}" --max-time 120
  if ! unzip -l "$z" >/dev/null 2>&1; then echo "$y: MISSING"; rm -f "$z"; continue; fi
  unzip -p "$z" | awk -F',' 'NR>1 {
    # quoted market name may itself contain commas -> parse from the RIGHT is fragile; instead strip the quoted
    # first field explicitly, then split the remainder.
    line=$0; if(substr(line,1,1)!="\"") next;
    q=index(substr(line,2),"\""); name=substr(line,2,q-1);
    rest=substr(line,q+2); sub(/^[ ]*,[ ]*/,"",rest);        # pre-2015 files put a space before the comma
    n=split(rest,a,",");
    if(n<17) next;
    gsub(/[ "]/,"",a[2]); gsub(/ /,"",a[3]);
    d=a[2]; code=a[3];
    if(d !~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ || code=="") next;
    gsub(/"/,"\"\"",name);
    printf "%s\t%s\t\"%s\"\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\n", code, d, name, a[7], a[8], a[9], a[10], a[11], a[12], a[15], a[16]
  }' > cot.tsv
  rows=$(wc -l < cot.tsv | tr -d ' ')
  { echo "create temp table stage_cot (market_code text, report_date date, market_name text, oi bigint, ncl bigint, ncs bigint, ncsp bigint, cl bigint, cs bigint, nrl bigint, nrs bigint);
\\copy stage_cot from stdin with (format csv, delimiter E'\\t')"
    cat cot.tsv
    echo "\\."
    echo "insert into trd_cot select distinct on (market_code, report_date) * from stage_cot
  on conflict (market_code, report_date) do nothing;"
  } | $PSQL
  if [ $? -ne 0 ]; then echo "$y: WRITE-FAILED"; else echo "$y: $rows rows"; fi
  rm -f cot.tsv "$z"
done
$PSQL -Atc "select count(*), min(report_date), max(report_date), count(distinct market_code) from trd_cot;" | xargs echo "TOTAL:"
