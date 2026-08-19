#!/usr/bin/env bash
# Restore a dump into the owned Postgres (drill this — an untested backup is not a backup). Usage: restore.sh <dump>
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP="${1:?usage: restore.sh <dump-file>}"
docker compose exec -T db pg_restore -U postgres -d postgres --clean --if-exists < "$DUMP"
echo "restored from $DUMP"
