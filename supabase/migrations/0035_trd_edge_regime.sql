-- D-269: C7 regime matrix — vs-random edge PER observable-at-entry regime bucket, per edge. Answers "WHEN is this
-- edge favourable?" Populated by trd-edge-backtest via _shared/trd-harness.ts scoreByRegime (tested).
create table if not exists trd_edge_regime (
  edge text not null, dimension text not null, bucket text not null,
  n int, abs_r double precision, net_r double precision,
  vs_random_edge double precision, vs_random_t double precision, passes boolean,
  run_at timestamptz not null default now(),
  primary key (edge, dimension, bucket)
);
alter table trd_edge_regime enable row level security;
create policy trd_edge_regime_read on trd_edge_regime for select using (true);
