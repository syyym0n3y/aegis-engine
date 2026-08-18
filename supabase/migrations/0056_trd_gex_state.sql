-- 0056 — current GEX vol-regime state for the engagement gate. GEX→vol is proven (IC −0.49, every era) so it drives
-- SIZING (vol-target/expected-vol), NOT strategy selection (momentum measured not regime-dependent, D-352). Cron-refreshed.
create table if not exists trd_gex_state (
  id text primary key default 'current',
  asof date, gex_percentile double precision, regime text, expected_vol_pct double precision,
  size_mult double precision, updated_at timestamptz not null default now()
);
alter table trd_gex_state enable row level security;
insert into trd_gex_state (id) values ('current') on conflict (id) do nothing;
