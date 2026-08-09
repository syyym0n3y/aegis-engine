-- D-222: 30-min live edge-state snapshots. The trd-edge-monitor fn writes here on each cron invocation so the cockpit
-- reads a fresh cached state (and we build an edge-state time series). Rows immutable (no UPDATE); DELETE allowed for
-- retention (this is monitoring telemetry, not evidence). Latest = order by created_at desc limit 1.
create table if not exists trd_edge_snapshot (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null,
  edges jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_edge_snap_created on trd_edge_snapshot(created_at desc);
create or replace function trd_edge_snapshot_immutable() returns trigger language plpgsql as $$ begin raise exception 'trd_edge_snapshot rows are immutable (attempted %)', tg_op; end $$;
drop trigger if exists trg_edge_snap_noupd on trd_edge_snapshot;
create trigger trg_edge_snap_noupd before update on trd_edge_snapshot for each row execute function trd_edge_snapshot_immutable();

-- pg_cron: refresh + persist every 30 minutes (applied via cron.schedule('trd_edge_monitor_30m', '*/30 * * * *', ...)).
-- The job invokes /functions/v1/trd-edge-monitor with the standard _cc_cron_bearer() auth; timeout 120s (the monitor
-- makes ~85 sequential Yahoo fetches ≈ 30-45s). Documented here; the schedule lives in cron.job (jobid 25).
