#!/usr/bin/env bash
# deploy-to-box.sh (D-370) — stand up the FULL owned stack on a dedicated box in one command, over SSH. This is the move off
# the Mac onto owned metal (buy a machine + colocate/home-host = true ownership; a rented bare-metal box is the interim where
# you own the stack + data and rent only the metal). Idempotent: re-run to update. After this the box IS the owned node —
# Postgres (supabase image → all migrations + pg_cron/vault), PostgREST, the autopilot under systemd, nightly backups.
#
#   Prereq: SSH access to a fresh Ubuntu/Debian box (root or sudo). Usage: deploy-to-box.sh user@host
set -euo pipefail
TARGET="${1:?usage: deploy-to-box.sh user@host}"
cd "$(dirname "$0")/../.."   # repo root
echo "==> 0/5  check SSH to $TARGET"; ssh -o ConnectTimeout=8 "$TARGET" 'echo ok' | grep -q ok

echo "==> 1/5  install docker + deno on the box (idempotent)"
ssh "$TARGET" 'bash -s' <<'REMOTE'
set -e
command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh; }
command -v deno   >/dev/null || { curl -fsSL https://deno.land/install.sh | sh -s -- -y >/dev/null 2>&1 || true; }
sudo mkdir -p /opt/aegis && sudo chown "$USER" /opt/aegis
REMOTE

echo "==> 2/5  sync the repo to /opt/aegis (code only — data re-derived, secrets excluded)"
rsync -az --delete --exclude '.git' --exclude 'infra/data' --exclude 'infra/.env' --exclude 'node_modules' ./ "$TARGET:/opt/aegis/"

echo "==> 3/5  provision the owned node on the box (production Postgres image = full parity)"
# use the supabase/postgres image on a server so pg_cron/vault/pg_net work + all 56 migrations apply
ssh "$TARGET" 'bash -s' <<'REMOTE'
set -e; cd /opt/aegis/infra
[ -f .env ] || { PW=$(openssl rand -hex 16); JWT=$(openssl rand -hex 32);
  printf "POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nDB_PORT=5432\nREST_PORT=3000\nHTTP_PORT=8080\n" "$PW" "$JWT" > .env; }
# swap to the supabase image for full extension parity, then provision
sed -i 's#postgres:16#supabase/postgres:15.8.1.060#g' scripts/provision-owned.sh 2>/dev/null || true
bash scripts/provision-owned.sh
REMOTE

echo "==> 4/5  install the autopilot under systemd (24/7 autonomy, restart-always)"
ssh "$TARGET" 'bash -s' <<'REMOTE'
set -e
sudo cp /opt/aegis/infra/launchd/aegis-autopilot.service /etc/systemd/system/aegis-autopilot.service
sudo systemctl daemon-reload && sudo systemctl enable --now aegis-autopilot
# nightly owned backup
( crontab -l 2>/dev/null; echo "0 3 * * * /opt/aegis/infra/scripts/backup.sh" ) | crontab -
REMOTE

echo "==> 5/5  migrate the Mac's owned data to the box (if a local dump exists)"
if [ -f infra/data/backups/aegis-pilot.dump ]; then
  scp infra/data/backups/aegis-pilot.dump "$TARGET:/tmp/aegis.dump"
  ssh "$TARGET" 'docker exec -i aegis-db pg_restore -U postgres -d postgres --clean --if-exists < /tmp/aegis.dump || true'
fi
cat <<DONE

==> BOX IS THE OWNED NODE.  Point the worker + autopilot at it:  export AEGIS_BROKER=https://<box>/rest
    Then retire the Mac's launchd agent:  launchctl unload ~/Library/LaunchAgents/io.aegis.autopilot.plist
    TLS + domain: edit infra/caddy/Caddyfile, run the 'full' compose profile on the box.
    YGS migration: scripts/migrate-db.sh (dump the rented YGS project into a ygs DB on this same box).
DONE
