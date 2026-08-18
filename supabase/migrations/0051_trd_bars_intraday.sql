-- 0051 — INTRADAY bar store (Databento). Minute bars for US equities → attribution BELOW daily (1m/5m/hourly). One row
-- per (symbol,tf); bars=[[ts_sec,o,h,l,c,v]]. Paid Databento key (metered — every load cost-checked first). The "to the
-- very minute" frontier keyless data could not reach.
create table if not exists trd_bars_intraday (
  symbol text not null, tf text not null default '1m',
  first_ts bigint, last_ts bigint, n_bars int, bars jsonb not null, cost_usd numeric,
  updated_at timestamptz not null default now(), primary key (symbol, tf)
);
alter table trd_bars_intraday enable row level security;
