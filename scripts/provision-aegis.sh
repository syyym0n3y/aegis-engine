#!/usr/bin/env bash
# provision-aegis.sh — stand up Aegis on its OWN Supabase project in one command (D-367). Run after the project exists
# (create it once billing is settled: Supabase dashboard, or `supabase projects create aegis-engine --region us-east-1`).
# Idempotent: re-running re-pushes migrations + redeploys functions. Owned by the operator — no service-role key in Claude's head.
#
#   Usage:  scripts/provision-aegis.sh <NEW_PROJECT_REF>
#   Then:   set the vault/function secrets listed at the end (Claude never holds them).
set -euo pipefail
REF="${1:?usage: provision-aegis.sh <PROJECT_REF>}"
cd "$(dirname "$0")/.."

echo "==> 1/3  Push all migrations (schema) to $REF"
# db push applies every supabase/migrations/*.sql in order. Needs the DB password once (prompted / SUPABASE_DB_PASSWORD).
supabase db push --project-ref "$REF" ${SUPABASE_DB_PASSWORD:+--password "$SUPABASE_DB_PASSWORD"}

echo "==> 2/3  Deploy every edge function to $REF"
# trd-compute stays credential-free for the worker (no JWT); everything else keeps JWT verification.
for d in supabase/functions/*/; do
  name="$(basename "$d")"
  [ "$name" = "_shared" ] && continue
  if [ "$name" = "trd-compute" ]; then
    supabase functions deploy "$name" --project-ref "$REF" --no-verify-jwt
  else
    supabase functions deploy "$name" --project-ref "$REF"
  fi
done

echo "==> 3/3  Point the worker at the new broker"
echo "    export AEGIS_BROKER=https://$REF.supabase.co/functions/v1/trd-compute"

cat <<NOTE

==> DONE (schema + functions live on $REF). Remaining MANUAL steps (secrets — Claude never holds these):
  • Function secrets:  supabase secrets set --project-ref $REF \\
        APCA_API_KEY_ID=... APCA_API_SECRET_KEY=... OPERATOR_TOKEN=...
  • trd_secrets rows (research keys): databento_key, alphavantage_key, fmp_key, eodhd_key
  • Re-seed data via the loaders (no data was migrated — it's all re-derivable):
        trd-fundamentals-load (ciks + concepts), trd-kenfrench-load, trd-fundflow-load ?back=90,
        trd-insider-bulk (quarters), then enqueue price_accumulate + the deflated gates on the worker.
  • Cron jobs: re-create pg_cron schedules on $REF (they don't migrate with the schema).
  • Update CLAUDE.md / STATE.md: Aegis project ref = $REF (was command-centre glzzoomuhnugsiichnub).
Isolation achieved: a research load on Aegis can no longer wedge the command-centre production DB.
NOTE
