#!/usr/bin/env bash
# Apply every supabase/migrations/*.sql in order to the OWNED Postgres. Idempotent (migrations use IF NOT EXISTS / OR REPLACE).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
applied=0; failed=0
for f in ../supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$f" >/tmp/mig.log 2>&1; then
    echo "  ok   $name"; applied=$((applied+1))
  else
    echo "  FAIL $name  -> $(tail -1 /tmp/mig.log)"; failed=$((failed+1))
  fi
done
echo "applied=$applied failed=$failed"
