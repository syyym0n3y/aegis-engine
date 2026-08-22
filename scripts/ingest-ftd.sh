#!/usr/bin/env bash
# ingest-ftd.sh (D-469) — SEC fails-to-deliver, bulk-loaded via psql \copy (row-by-row REST would take hours).
# Files: cnsfails{YYYYMM}{a|b}.zip — 'a' = 1st half of month, 'b' = 2nd half; later files can revise, so the upsert
# lets the newest load win. A symbol can appear twice in one file under different CUSIPs → aggregated by (date,symbol).
# Naming begins 2009-07 under this scheme; earlier vintages use a different path — the ACHIEVED span is reported at the
# end and recorded, never assumed (COVERAGE LAW).
set -euo pipefail
UA="aegis-research ona@revitalise.io"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
loaded=0; missing=0
docker exec aegis-db psql -U postgres -d postgres -q -c "create table if not exists _ftd_stage(sd text,cusip text,symbol text,qty text,descr text,price text);" 
for y in $(seq 2018 2026); do for m in $(seq -w 1 12); do for h in a b; do
  [ "$y$m" \> "202608" ] && break 2
  f="cnsfails${y}${m}${h}.zip"
  code=$(curl -s -o "$TMP/$f" -w "%{http_code}" -H "User-Agent: $UA" --max-time 60 "https://www.sec.gov/files/data/fails-deliver-data/$f" || echo 000)
  if [ "$code" != "200" ]; then missing=$((missing+1)); sleep 0.3; continue; fi
  unzip -p "$TMP/$f" > "$TMP/cur.txt" 2>/dev/null || { missing=$((missing+1)); continue; }
  # keep only well-formed 6-field data rows (guards against trailing disclaimers)
  awk -F'|' 'NR>1 && NF==6 && $1 ~ /^[0-9]{8}$/ && $3 != "" {print}' "$TMP/cur.txt" > "$TMP/clean.txt"
  # BUG CAUGHT LIVE (0 rows after launch): \copy from '<path>' reads the CLIENT filesystem — psql runs INSIDE the
  # container where $TMP does not exist. Every load failed and set -e swallowed nothing visible. Fix: stream the file
  # over stdin, which crosses the docker boundary.
  # ENCODING (bug #2, found by running one file by hand): DESCRIPTION carries Latin-1 bytes (0xbb) that abort a UTF8
  # COPY — and set -e then killed the whole 400-file loop on the FIRST real file. encoding 'LATIN1' converts at the
  # server; per-file failures are recorded and skipped instead of fatal.
  docker exec aegis-db psql -U postgres -d postgres -q -c "truncate _ftd_stage;"
  if ! docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
    -c "\copy _ftd_stage from stdin with (format csv, delimiter '|', quote e'\x01', encoding 'LATIN1')" < "$TMP/clean.txt"; then
    echo "LOAD-FAILED $f (copy)"; missing=$((missing+1)); continue
  fi
  docker exec aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c "
insert into trd_ftd (settle_date, symbol, qty_fails, price)
select to_date(sd,'YYYYMMDD'), symbol, sum(qty::bigint), max(nullif(price,'.')::float)
from _ftd_stage where qty ~ '^[0-9]+\$' group by 1,2
on conflict (settle_date,symbol) do update set qty_fails=excluded.qty_fails, price=excluded.price;" || { echo "LOAD-FAILED $f (insert)"; missing=$((missing+1)); continue; }
  loaded=$((loaded+1)); rm -f "$TMP/$f"
  sleep 0.4
done; done; done
docker exec aegis-db psql -U postgres -d postgres -q -c "drop table if exists _ftd_stage;"
echo "== FTD ingest: $loaded files loaded, $missing missing/404 =="
docker exec aegis-db psql -U postgres -d postgres -Atc "select count(*), min(settle_date), max(settle_date), count(distinct symbol) from trd_ftd;"
