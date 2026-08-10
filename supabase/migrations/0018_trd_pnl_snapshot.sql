-- D-230: P&L snapshots written by trd-position-manager (equity, cash, unrealized, total-vs-deposit, per-position).
-- (source-committed retroactively in the D-252 reconciliation audit — table pre-existed via SQL.)
create table if not exists trd_pnl_snapshot (
  id uuid primary key default gen_random_uuid(),
  equity numeric, cash numeric, unrealized_pl numeric, total_pnl numeric,
  positions integer, detail jsonb, actions jsonb, created_at timestamptz default now()
);
alter table trd_pnl_snapshot enable row level security;
create policy trd_pnl_snapshot_read on trd_pnl_snapshot for select using (true);
