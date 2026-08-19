#!/usr/bin/env bash
# Bring up the owned node + wait until Postgres is healthy. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "!! copy .env.example -> .env and set secrets first"; exit 1; }
docker compose up -d db rest
echo -n "waiting for owned Postgres to be healthy"
until docker compose exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; do echo -n "."; sleep 1; done
echo " OK — owned node up (Postgres :$(grep -E '^DB_PORT' .env | cut -d= -f2 || echo 5432), REST :$(grep -E '^REST_PORT' .env | cut -d= -f2 || echo 3000))"
