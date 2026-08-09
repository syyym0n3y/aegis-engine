-- D-243: comprehensive setup-library sweep. Long format: one row per (name, setup) firing >= min. edge_r =
-- meanR(setup) - meanR(own random control), currency-neutral capped-stop. 24 setups across every family.
alter table trd_global_universe add column if not exists setups_swept boolean not null default false;
create index if not exists trd_global_universe_setups_unswept on trd_global_universe (setups_swept) where setups_swept = false;
create table if not exists trd_global_setups (
  yahoo_sym text not null, exchange text not null, setup text not null,
  n int not null, edge_r double precision, primary key (yahoo_sym, setup)
);
create index if not exists trd_global_setups_setup on trd_global_setups (setup);
create index if not exists trd_global_setups_exch on trd_global_setups (exchange, setup);
alter table trd_global_setups enable row level security;
create policy trd_global_setups_read on trd_global_setups for select using (true);
