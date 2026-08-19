#!/usr/bin/env bash
# Self-healing hook for the control plane: restart any unhealthy service. Cron every minute on the owned node.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! docker compose exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; then
  echo "$(date -u +%FT%TZ) db unhealthy -> restart"; docker compose restart db
fi
