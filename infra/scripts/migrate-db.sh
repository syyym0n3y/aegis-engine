#!/usr/bin/env bash
# migrate-db.sh (D-370) — migrate a rented Supabase project's DATA onto the OWNED box. Works for Aegis's rented project AND
# for YGS (592 tables, ~1.25 GB, 74 crons). Dumps the source with pg_dump, restores into a named DB on the owned box, verifies
# table + row parity, and prints the de-risked cutover checklist. Read-only on the source until the very end (staged, reversible).
#
#   Prereq: the box is provisioned (deploy-to-box.sh); pg_dump installed locally; the SOURCE connection string WITH password
#           (Supabase dashboard → Project Settings → Database → Connection string). Usage:
#   migrate-db.sh "postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" user@box ygs
set -euo pipefail
SRC="${1:?source connection string (postgres://...:pw@db.<ref>.supabase.co:5432/postgres)}"
BOX="${2:?user@box}"
DBNAME="${3:-migrated}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; DUMP="/tmp/${DBNAME}-${STAMP}.dump"

echo "==> 1/5  dump SOURCE (read-only; source untouched) → $DUMP"
pg_dump "$SRC" -Fc --no-owner --no-privileges -f "$DUMP"
echo "    dump size: $(du -h "$DUMP" | cut -f1)"
SRC_TABLES=$(psql "$SRC" -tAc "select count(*) from information_schema.tables where table_schema='public'")

echo "==> 2/5  create the '$DBNAME' database on the owned box"
ssh "$BOX" "docker exec aegis-db psql -U postgres -c \"create database ${DBNAME}\" 2>/dev/null || true"

echo "==> 3/5  restore into the owned box"
scp "$DUMP" "$BOX:/tmp/$(basename "$DUMP")"
ssh "$BOX" "docker exec -i aegis-db pg_restore -U postgres -d ${DBNAME} --no-owner --clean --if-exists < /tmp/$(basename "$DUMP") 2>&1 | tail -3 || true"

echo "==> 4/5  verify parity"
DST_TABLES=$(ssh "$BOX" "docker exec aegis-db psql -U postgres -d ${DBNAME} -tAc \"select count(*) from information_schema.tables where table_schema='public'\"")
echo "    source public tables: $SRC_TABLES   |   owned box: $DST_TABLES"
[ "$SRC_TABLES" = "$DST_TABLES" ] && echo "    ✓ table parity" || echo "    ⚠ table count differs — investigate before cutover"

cat <<CHECKLIST

==> 5/5  DATA restored on the owned box (source still live + untouched — nothing is cut over yet).

    CUTOVER CHECKLIST (do in a scheduled window with rollback ready — for YGS this touches revenue):
      [ ] Recreate pg_cron jobs on the box (they don't travel with pg_dump) — export from source:
            psql "\$SRC" -tAc "select 'select cron.schedule('||quote_literal(jobname)||','||quote_literal(schedule)||','||quote_literal(command)||');' from cron.job where active"
          then run the output on the box.
      [ ] Deploy the domain's EDGE FUNCTIONS to a Deno runtime on the box (from that domain's repo — e.g. command-centre/YGS).
      [ ] Move SECRETS (Vault / function env) — set them on the box; Claude never holds these.
      [ ] Re-point the FRONTEND (Vercel → owned Caddy) + any webhooks/OAuth callback URLs to the box's domain.
      [ ] Smoke-test the box end-to-end against a copy of production traffic.
      [ ] Freeze source writes → final incremental re-dump/restore → flip DNS/endpoints to the box.
      [ ] Watch for one cycle; ROLLBACK = flip endpoints back to the still-intact rented project.
      [ ] Only after a clean day: decommission + stop paying for the rented project.
CHECKLIST
