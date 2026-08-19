#!/usr/bin/env bash
# OWNED backups — the data is an asset, so protect it like one: timestamped logical dump to an owned dir (+ copy offsite).
# Cron this hourly/daily. For continuous/PITR add WAL archiving (archive_command) — see RUNBOOK. Restore-drill regularly.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
OUT="${BACKUP_DIR:-./data/backups}"; mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T db pg_dump -U postgres -d postgres -Fc > "$OUT/aegis-$STAMP.dump"
echo "backup -> $OUT/aegis-$STAMP.dump ($(du -h "$OUT/aegis-$STAMP.dump" | cut -f1))"
# offsite: rsync/rclone "$OUT/aegis-$STAMP.dump" <owned-offsite>   # wire to your owned second location
ls -1t "$OUT"/aegis-*.dump | tail -n +15 | xargs -r rm    # retain last 14
