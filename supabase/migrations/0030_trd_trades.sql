-- D-253: per-edge trade log for the weekly scorecard — every entry tagged with its edge; reconciled from Alpaca fills.
create table if not exists trd_trades (
  id uuid primary key default gen_random_uuid(),
  edge text not null, sym text not null, side text not null, qty double precision,
  entry_px double precision, entry_at timestamptz default now(),
  exit_px double precision, exit_at timestamptz, realized_pnl double precision,
  status text not null default 'open'
);
create index if not exists trd_trades_open on trd_trades (status) where status='open';
create index if not exists trd_trades_edge on trd_trades (edge);
alter table trd_trades enable row level security;
create policy trd_trades_read on trd_trades for select using (true);
create policy trd_trades_svc on trd_trades for all using (true) with check (true);
