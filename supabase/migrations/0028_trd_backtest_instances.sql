-- D-251: per-INSTANCE backtests over max history (not pooled). Exact executor geometry (2ATR stop / 3R target bracket,
-- 20-bar max hold). Full trade accounting per (instrument, edge).
create table if not exists trd_backtest_instances (
  instrument text not null, edge text not null, years double precision, trades int,
  win_pct double precision, expectancy_r double precision, total_r double precision,
  avg_win_r double precision, avg_loss_r double precision, profit_factor double precision, max_dd_r double precision,
  primary key (instrument, edge)
);
alter table trd_backtest_instances enable row level security;
create policy trd_backtest_instances_read on trd_backtest_instances for select using (true);
