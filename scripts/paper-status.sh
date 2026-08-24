#!/bin/bash
# paper-status.sh (D-521) — the operator's one-command view of the paper rung. No Claude required.
cd "$(dirname "$0")/.."
echo "== PAPER RUNG: book-p2-volmanaged (armed 2026-08-24, \$100k paper, kill-switch honored) =="
docker exec aegis-db psql -U postgres -d postgres -F' | ' -Atc \
 "select mo, round((book_ret*100)::numeric,2)||'%' as book, round(vm_weight::numeric,2) as w, round((managed_ret*100)::numeric,2)||'%' as managed, '\$'||round(equity::numeric) as equity from trd_paper_book order by mo;"
n=$(docker exec aegis-db psql -U postgres -d postgres -Atc "select count(*) from trd_paper_book;")
echo "-- months marked: $n / 30 required for the MICRO gate (DSR>0@95, PBO<0.5, maxDD<6%, net>0)"
docker exec aegis-db psql -U postgres -d postgres -Atc "select 'kill-switch: '||account||' = '||state from trd_kill_switch;"
echo "-- latest attribution (top 5 by adj-R2):"
docker exec aegis-db psql -U postgres -d postgres -F' | ' -Atc \
 "select symbol, round(adj_r2::numeric,2), round((residual*100)::numeric,2)||'%' from trd_attribution where asof=(select max(asof) from trd_attribution) order by adj_r2 desc limit 5;"
