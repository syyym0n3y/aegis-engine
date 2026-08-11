-- D-271: orbfollow regime matrix — per-day cash_open (09:30-10:30 ET) FOLLOW trade tagged by direction /
-- opening-range width (vs trailing median) / trend-alignment, vs matched random control, per symbol & period.
-- Populated by trd-futures-backtest-hist. Aggregate across periods with an OOS split for the favourable-regime gate.
create table if not exists trd_futures_regime (
  symbol text not null, dim text not null, bucket text not null, period text not null,
  n int, follow_mean double precision, rand_mean double precision, edge double precision,
  primary key (symbol, dim, bucket, period)
);
alter table trd_futures_regime enable row level security;
create policy trd_futures_regime_read on trd_futures_regime for select using (true);
