-- D-258: historical futures range-fade results per (symbol, timeframe, window, period) from Databento 1m.
create table if not exists trd_futures_orb_results (
  symbol text not null, timeframe text not null, win text not null, period text not null,
  n int, edge_r double precision, win_pct double precision, mean_r double precision,
  primary key (symbol, timeframe, win, period)
);
alter table trd_futures_orb_results enable row level security;
create policy trd_futures_orb_results_read on trd_futures_orb_results for select using (true);
