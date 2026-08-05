-- D-145: frozen pre-registration of the R-007 conditional directional candidates + forward-only tracking.
create table if not exists trd_r007_state (
  candidate text primary key, market text not null, timeframe text not null, spec jsonb not null,
  registered_at timestamptz not null, backtest_oos_net_r numeric,
  forward_trades jsonb not null default '[]'::jsonb, forward_n int not null default 0,
  forward_expectancy_r numeric, last_entry_ts timestamptz, updated_at timestamptz not null default now());
comment on table trd_r007_state is 'D-145: registered_at is the immutable clock start; only trades entered after it count as the un-deflated forward trial.';
-- cron: select cron.schedule('trd-r007-forward','17 */6 * * *', $$ select net.http_post(url:='.../trd-r007-tick', headers:='{"Content-Type":"application/json"}'::jsonb) $$);
