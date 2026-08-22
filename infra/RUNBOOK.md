# infra/RUNBOOK.md — running Aegis on OWNED infrastructure

Owned node = owned data (an asset), no vendor limits (no 2s function cap, no connection ceiling, no rate caps), reproducible
from this directory. Proven pilot (D-368): 54/56 migrations applied on **stock postgres:16**, all 59 tables RLS-enforced,
owned PostgREST API returned HTTP 200, anon HTTP read → **401 permission denied**, owned backup dumped to owned disk. The
schema is portable to any Postgres you own — not locked to a vendor.

## Bring it up (this Mac, or any owned box)
```bash
colima start                       # start the Docker daemon (mac). On a linux server: dockerd is already running.
cp infra/.env.example infra/.env   # then set a strong POSTGRES_PASSWORD + a 32+ char JWT_SECRET
infra/scripts/provision-owned.sh   # owned Postgres + roles + full schema + owned REST API, one command
```
Data lives in the `aegis-db-data` docker volume (owned). The compose path (`docker compose up`) needs the compose plugin;
`provision-owned.sh` uses plain `docker run` so it works without it.

## Daily operations (the excellence layer — owned must beat rented reliability)
- **Backup** (cron hourly/daily): `infra/scripts/backup.sh` → timestamped `pg_dump -Fc` to `infra/data/backups` (retains 14).
  Wire the commented `rsync/rclone` line to an owned offsite location. **Restore-drill monthly** — an untested backup is not
  a backup: `infra/scripts/restore.sh <dump>`.
- **Self-heal** (cron every minute): `infra/scripts/healthcheck.sh` restarts an unhealthy DB. Hook it to the control plane.
- **Re-derive data** (nothing is migrated — it is all re-fetchable free, which is the point): run the loaders
  `trd-fundamentals-load` (ciks + concepts), `trd-kenfrench-load`, `trd-fundflow-load ?back=90`, `trd-insider-bulk` per
  quarter; then the worker jobs `price_accumulate` + the deflated gates.
- **Edge functions**: run each as a local Deno service (`deno run -A supabase/functions/<fn>/index.ts`) pointed at the owned
  Postgres/REST — no 2s cap, no cold starts, our box.

## Production hardening (the path to owned excellence)
1. **Postgres image**: swap `postgres:16` → `supabase/postgres:15.8.1.060` in `docker-compose.yml` / `provision-owned.sh` to
   get `pg_cron`, `pgsodium`/vault, `pg_net`, `pgjwt` — the 2 skipped migrations then apply and DB-side cron/secrets work.
2. **Hot replica + failover** (Google's cheap+redundant): a second commodity box streaming-replicates the primary; a single
   machine is disposable, the system is not. Promote on failure via the control plane.
3. **WAL / PITR**: set `archive_mode=on` + `archive_command` to ship WAL to owned storage → point-in-time restore, not just
   daily dumps. Data loss becomes structurally impossible.
4. **TLS + owned edge**: `docker compose --profile full up` brings up Caddy; point a domain at it for automatic Let's Encrypt
   TLS and serve the REST API + static frontends from your box (retire Vercel).
5. **IaC the whole node**: this directory IS the IaC. For a fleet, lift it to NixOS or Ansible so a bare box → full owned node
   is one converge. The infrastructure itself becomes an owned, auditable asset (a diligence differentiator).

## Migrating each domain off rented Supabase (de-risked order)
- **Aegis** (done here — zero production risk): the pilot above IS the migration; re-derive data, cut the worker's
  `AEGIS_BROKER` to the owned REST, retire the rented project.
- **YGS** (production/revenue — via staging first): stand the owned node, restore a YGS dump into it, run staging against it,
  verify, schedule a cutover window with rollback, then decommission the rented project.
- **Frontends**: build the Vercel bundles, serve from Caddy on the owned node, kill the Vercel subscription.
- **Become your own cloud**: `provision-owned.sh` templatises per project — every new vertical is born owning its stack.

## Tear down / restart the pilot
```bash
docker rm -f aegis-rest aegis-db      # stop containers (data volume 'aegis-db-data' persists)
docker volume rm aegis-db-data        # ONLY to wipe the owned data
colima stop                           # stop the daemon (mac)
```

## Autonomous operation (autopilot — D-369)
The engine runs itself, dormant on capital: each cycle it self-heals, refreshes free evidence, re-computes the DEFLATED
verdict, scores the statistical position + delta vs last cycle, records to `trd_autopilot_log`, and SURFACES anything that
clears — but **never arms, trades, or spends** (arming is your act alone). "Autonomously succeeding" within the safety law.
- **Run it**: `infra/scripts/autopilot-up.sh` (ensures the owned node + runs the daemon; `CYCLE_SEC` sets cadence, default 6h).
- **Persistent (mac)**: `cp infra/launchd/io.aegis.autopilot.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/io.aegis.autopilot.plist` — runs at login, keep-alive, logs to `infra/data/autopilot.log`.
- **Persistent (dedicated linux box — the reliable home)**: install `infra/launchd/aegis-autopilot.service` under systemd; `systemctl enable --now aegis-autopilot`.
- **Watch it**: `select * from trd_autopilot_log order by cycle_at desc;` — the engine grading its own position over time.
- **Arming stays manual**: when a surfaced factor is genuinely worth capital, YOU flip the arm (trd_exec_arm) after the staged gates — the autopilot will never do it.

## Move to a dedicated box + migrate a domain (D-370)
One command each, the moment you have a box + SSH:
- **Provision the box** (fresh Ubuntu/Debian, root/sudo): `infra/scripts/deploy-to-box.sh user@host` — installs docker+deno,
  syncs the repo, brings up the owned node with the **supabase/postgres image** (all 56 migrations + pg_cron/vault), installs
  the autopilot under systemd (24/7), wires nightly backups, migrates the Mac's data. The box becomes the owned node.
- **Migrate a rented DB onto the box** (Aegis's project or YGS): `infra/scripts/migrate-db.sh "<source-conn-with-pw>" user@box <dbname>`
  — pg_dump (source read-only) → restore on the box → verify table parity → prints the cutover checklist (crons, functions,
  secrets, frontend, rollback). YGS is 592 tables / ~1.25 GB / 74 crons → stage it: dump+restore+verify, then a scheduled
  cutover window with rollback, because it is revenue.
- **Prerequisites only you can provide**: (1) a box + SSH (buy metal for true ownership, or a rented bare-metal interim);
  (2) each source project's DB connection string WITH password (Supabase dashboard); (3) for YGS, that project's edge-function
  repo (command-centre) + a cutover window. Claude never holds the passwords.

## Watching the agents — two traps hit on 2026-08-22

**1. `pgrep -f` matches the watcher itself.** A wait loop written as
`until ! pgrep -f 'aegis-positioning'; do sleep 20; done` never exits: the shell running that loop has the string
`aegis-positioning` in its OWN command line, so pgrep finds itself and the condition is permanently true. Hit twice in one
session (first on `ingest-perp-flow`). Two fixes, both used here:
- narrow the pattern so it only matches the real process: `pgrep -f 'deno run.*aegis-positioning'`
- or use the bracket trick: `pgrep -f '[a]egis-positioning'` — the watcher's own cmdline contains the literal `[a]egis-...`
  which the regex does not match.

**2. `pkill -f "until ! pgrep"` kills every watcher, not the stuck one.** Used to clear one wedged loop, it terminated nine
background monitors at once. No work was lost — every underlying job had already finished and been recorded, and that was
VERIFIED afterwards by checking each log for its completion marker rather than assumed. Kill by PID (`pkill` prints
nothing; use `pgrep -f ... ` first and inspect) rather than by a pattern that matches a whole class of shells.

**3. Restarting an agent mid-edit gives a mixed binary.** `aegis-positioning` was restarted between two source edits and
logged the OLD header with the NEW footer — the run had loaded the module after the first edit and before the second.
When verifying a fix, confirm the banner AND the closing line come from the same version, or restart once more after all
edits land.
