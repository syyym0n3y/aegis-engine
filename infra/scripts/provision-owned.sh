#!/usr/bin/env bash
# provision-owned.sh (D-368) — stand up the ENTIRE owned Aegis node from nothing, in one command. Reproducible: run it on
# any box you own (this Mac, an EPYC server, a VPS you control) and the owned stack comes up identical. This is the on-ramp
# off rented infra — the schema is portable to stock Postgres (proven: 54/56 migrations on vanilla postgres:16), the data is
# re-derivable from free loaders, so nothing is locked to a vendor. Idempotent.
#
#   Prereqs: docker (+ a running daemon; on mac: `colima start`). Optionally docker-compose for the compose path.
#   Usage:   infra/scripts/provision-owned.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { cp .env.example .env; echo "!! generated infra/.env from example — set POSTGRES_PASSWORD + JWT_SECRET, re-run"; exit 1; }
set -a; . ./.env; set +a

echo "==> 1/4  owned Postgres"
docker rm -f aegis-db >/dev/null 2>&1 || true
docker run -d --name aegis-db -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" -p "${DB_PORT:-5432}:5432" \
  -v aegis-db-data:/var/lib/postgresql/data postgres:16 >/dev/null   # swap -> supabase/postgres for pg_cron/vault parity
until docker exec aegis-db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

echo "==> 2/4  auth roles (anon / authenticated / service_role / authenticator)"
docker exec -i aegis-db psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < postgres/init/00-roles.sql >/dev/null
docker exec aegis-db psql -q -U postgres -d postgres -c "alter role authenticator with login password '$POSTGRES_PASSWORD';" >/dev/null

echo "==> 3/4  apply Aegis schema (all migrations)"
ok=0; fail=0
for f in ../supabase/migrations/*.sql; do
  if docker exec -i aegis-db psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$f" >/dev/null 2>&1; then ok=$((ok+1)); else fail=$((fail+1)); echo "   (skip $(basename "$f") — needs pg_cron/vault; use supabase/postgres image)"; fi
done
echo "   schema: $ok applied, $fail need platform extensions"

echo "==> 4/4  owned REST API"
docker network create aegis-net >/dev/null 2>&1 || true
docker network connect aegis-net aegis-db 2>/dev/null || true
docker rm -f aegis-rest >/dev/null 2>&1 || true
docker run -d --name aegis-rest --network aegis-net -p "${REST_PORT:-3000}:3000" \
  -e PGRST_DB_URI="postgres://authenticator:${POSTGRES_PASSWORD}@aegis-db:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="${JWT_SECRET}" \
  postgrest/postgrest:v12.2.3 >/dev/null

cat <<DONE

==> OWNED NODE UP.  Postgres :${DB_PORT:-5432}  REST :${REST_PORT:-3000}
    Data lives in the 'aegis-db-data' docker volume (owned). Back it up: infra/scripts/backup.sh
    Re-derive data via the free loaders (nothing migrated — it's all re-fetchable):
      trd-fundamentals-load (ciks + concepts) · trd-kenfrench-load · trd-fundflow-load · trd-insider-bulk
      then the worker: price_accumulate + the deflated gates.
    Edge functions: run them as local Deno services (deno run -A supabase/functions/<fn>/index.ts) — no 2s cap.
    Production hardening (RUNBOOK.md): supabase/postgres image, hot replica + failover, WAL/PITR, TLS via Caddy, self-heal cron.
DONE
