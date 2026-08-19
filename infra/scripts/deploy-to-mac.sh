#!/usr/bin/env bash
# deploy-to-mac.sh (D-371) — turn a Mac Mini (or any always-on Mac) into the owned node, in one command over SSH. This is the
# SAME stack proven on this Mac this session (colima + Postgres + PostgREST + launchd autopilot) — so a Mac Mini is the
# lowest-risk owned box: nothing new to prove, just move it to a machine that's always on and isn't your primary. Owned metal,
# ~7-30W, silent, arm64-native. Idempotent.
#
#   Prereq: SSH enabled on the Mini (System Settings → General → Sharing → Remote Login), an admin user. Usage:
#   deploy-to-mac.sh user@mac-mini.local
set -euo pipefail
TARGET="${1:?usage: deploy-to-mac.sh user@mac-mini.local}"
cd "$(dirname "$0")/../.."
echo "==> 0/6  check SSH to $TARGET"; ssh -o ConnectTimeout=8 "$TARGET" 'echo ok' | grep -q ok

echo "==> 1/6  install colima + docker + deno (Homebrew; idempotent)"
ssh "$TARGET" 'bash -lc "command -v brew >/dev/null || /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"; \
  for p in colima docker deno; do command -v \$p >/dev/null || brew install \$p; done; mkdir -p ~/aegis"'

echo "==> 2/6  keep the Mini awake 24/7 (a server must not sleep)"
ssh "$TARGET" 'sudo pmset -a sleep 0 disksleep 0 womp 1 autorestart 1 2>/dev/null || pmset -a sleep 0 2>/dev/null || true'

echo "==> 3/6  sync the repo (code only; data re-derived, secrets excluded)"
rsync -az --delete --exclude '.git' --exclude 'infra/data' --exclude 'infra/.env' ./ "$TARGET:aegis/"

echo "==> 4/6  provision the owned node on the Mini (production Postgres image for full parity)"
ssh "$TARGET" 'bash -lc "cd ~/aegis/infra && colima status >/dev/null 2>&1 || colima start --cpu 2 --memory 4; \
  [ -f .env ] || printf \"POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nDB_PORT=54329\nREST_PORT=33000\nHTTP_PORT=8080\n\" \$(openssl rand -hex 16) \$(openssl rand -hex 32) > .env; \
  sed -i \"\" \"s#postgres:16#supabase/postgres:15.8.1.060#g\" scripts/provision-owned.sh 2>/dev/null || true; \
  bash scripts/provision-owned.sh"'

echo "==> 5/6  install the autopilot as a launchd agent (24/7 autonomy, keep-alive)"
ssh "$TARGET" 'bash -lc "cd ~/aegis && sed \"s#\$(pwd)#\$HOME/aegis#g\" infra/launchd/io.aegis.autopilot.plist > ~/Library/LaunchAgents/io.aegis.autopilot.plist 2>/dev/null || cp infra/launchd/io.aegis.autopilot.plist ~/Library/LaunchAgents/; \
  launchctl unload ~/Library/LaunchAgents/io.aegis.autopilot.plist 2>/dev/null; launchctl load ~/Library/LaunchAgents/io.aegis.autopilot.plist"'

echo "==> 6/6  migrate this Mac's owned data to the Mini (if a dump exists)"
[ -f infra/data/backups/aegis-pilot.dump ] && { scp infra/data/backups/aegis-pilot.dump "$TARGET:/tmp/aegis.dump"; ssh "$TARGET" 'docker exec -i aegis-db pg_restore -U postgres -d postgres --clean --if-exists < /tmp/aegis.dump || true'; }

cat <<DONE

==> THE MINI IS THE OWNED NODE (owned metal, always-on, autonomous).
    Retire this Mac's agent:  launchctl unload ~/Library/LaunchAgents/io.aegis.autopilot.plist
    Migrate a rented DB onto it (Aegis project / YGS):  infra/scripts/migrate-db.sh "<conn>" $TARGET <dbname>
    Add a 2nd cheap box later as replica (cheap+redundant) — a single Mini is a great start, not the final HA shape.
DONE
