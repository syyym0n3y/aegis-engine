create table if not exists trd_discovery_log (
  id bigserial primary key,
  tested_at timestamptz default now(),
  candidate text not null,
  family text,
  oos_ic numeric, oos_sharpe numeric, calib_spread numeric,
  psr_z numeric, passes_deflation boolean,
  beats_base boolean, n_test_months int, note text
);
alter table trd_discovery_log enable row level security;
