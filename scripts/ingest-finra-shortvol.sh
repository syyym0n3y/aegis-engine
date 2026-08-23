#!/usr/bin/env bash
# ingest-finra-shortvol.sh (D-475) — FINRA consolidated daily short-sale volume, per symbol, bulk-loaded.
# One file per trading day: Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market. 404 = holiday/weekend, skipped.
# All the ingest-ftd.sh lessons applied from the start: \copy over stdin, per-file failures non-fatal, achieved span
# reported at the end and never assumed.
set -uo pipefail
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
docker exec aegis-db psql -U postgres -d postgres -q -c "create table if not exists _sv_stage(d text,sym text,sv text,sev text,tv text,mkt text);"
loaded=0; missing=0
d=$(date -j -f %Y-%m-%d "${FROM:-2011-01-03}" +%s); end=$(date +%s)
while [ "$d" -le "$end" ]; do
  ymd=$(date -j -f %s "$d" +%Y%m%d); dow=$(date -j -f %s "$d" +%u); d=$((d+86400))
  [ "$dow" -ge 6 ] && continue
  code=$(curl -s -o "$TMP/f.txt" -w "%{http_code}" --max-time 40 "https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd}.txt" || echo 000)
  if [ "$code" != "200" ]; then missing=$((missing+1)); continue; fi
  awk -F'|' 'NR>1 && NF>=5 && $1 ~ /^[0-9]{8}$/ && $2 != "" {print $1"|"$2"|"$3"|"$5}' "$TMP/f.txt" > "$TMP/c.txt"
  docker exec aegis-db psql -U postgres -d postgres -q -c "truncate _sv_stage;" || { echo "LOAD-FAILED $ymd (trunc)"; continue; }
  if ! docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
    -c "\copy _sv_stage(d,sym,sv,tv) from stdin with (format csv, delimiter '|', quote e'\x01', encoding 'LATIN1')" < "$TMP/c.txt"; then
    echo "LOAD-FAILED $ymd (copy)"; missing=$((missing+1)); continue
  fi
  docker exec aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c "
    insert into trd_short_volume (d,symbol,short_vol,total_vol)
    select to_date(d,'YYYYMMDD'), sym, sum(sv::float), sum(tv::float) from _sv_stage
    where sv ~ '^[0-9.]+$' and tv ~ '^[0-9.]+$' group by 1,2
    on conflict (d,symbol) do update set short_vol=excluded.short_vol, total_vol=excluded.total_vol;" \
    || { echo "LOAD-FAILED $ymd (insert)"; missing=$((missing+1)); continue; }
  loaded=$((loaded+1)); sleep 0.25
done
docker exec aegis-db psql -U postgres -d postgres -q -c "drop table if exists _sv_stage;"
echo "== short-volume ingest: $loaded files, $missing missing =="
docker exec aegis-db psql -U postgres -d postgres -Atc "select count(*), min(d), max(d), count(distinct symbol) from trd_short_volume;"
