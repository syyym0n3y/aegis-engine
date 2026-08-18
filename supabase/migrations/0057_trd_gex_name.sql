-- 0057 — per-name dealer GEX (free/keyless Nasdaq chain + BS-implied-vol). Daily snapshots accumulate the series to
-- backtest per-name GEX (chain is a live snapshot; we build the history ourselves — no OPRA spend).
create table if not exists trd_gex_name (
  symbol text not null, date date not null, spot double precision, net_gex double precision, sign text,
  updated_at timestamptz not null default now(), primary key (symbol, date)
);
alter table trd_gex_name enable row level security;
