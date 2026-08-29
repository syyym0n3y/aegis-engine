#!/usr/bin/env bash
# refresh-breadth.sh (D-717) — recompute equity breadth from the panel into trd_macro_series. Idempotent
# (ON CONFLICT DO UPDATE), so a daily run overwrites the touched keys and never duplicates. Cheap on the daily
# cadence because the panel only grows by one bar per name per day; the recompute is a full pass but the table is
# already in cache. Owns the five breadth_* series that the continuity guard watches.
set -euo pipefail
cd "$(dirname "$0")/../infra"
set -a; . ./.env; set +a
docker start aegis-db >/dev/null 2>&1 || true
docker exec -i aegis-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ../scripts/build-breadth.sql
echo "$(date -u +%FT%TZ) breadth refreshed"
