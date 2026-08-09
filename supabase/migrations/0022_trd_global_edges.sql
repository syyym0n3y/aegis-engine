-- D-241: multi-setup edge discovery across the entire global universe. Per name, each setup's edge-vs-own-random in
-- currency-neutral R (capped-stop). 5 orthogonal setups spanning mean-reversion + momentum, both directions.
alter table trd_global_universe add column if not exists edges_swept boolean not null default false;
create index if not exists trd_global_universe_edges_unswept on trd_global_universe (edges_swept) where edges_swept = false;
create table if not exists trd_global_edges (
  yahoo_sym  text primary key,
  exchange   text not null,
  mr_short_n int, mr_short_r double precision,
  mr_long_n  int, mr_long_r  double precision,
  bo_long_n  int, bo_long_r  double precision,
  bd_short_n int, bd_short_r double precision,
  hi52_n     int, hi52_r     double precision,
  swept_at   timestamptz default now()
);
alter table trd_global_edges enable row level security;
create policy trd_global_edges_read on trd_global_edges for select using (true);
