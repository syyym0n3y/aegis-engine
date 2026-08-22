-- 0071 (D-470) — THE STRATEGY FACTORY ledger. One row per spec run through the full gate battery. Append-only.
-- The factory is how "thousands of strategies" stays honest: every run increments trd_trial_counter (raising the
-- deflation ceiling for everyone), and a spec can only be marked SURVIVOR if every gate column is true.
create table if not exists trd_factory (
  id            uuid primary key default gen_random_uuid(),
  run_at        timestamptz not null default now(),
  spec_key      text not null,            -- deterministic hash of the spec, for dedup/resume
  family        text not null,            -- signal family (momentum, value, flow, ftd, carry, ...)
  spec          jsonb not null,           -- full parameterisation
  universe      text not null,            -- equity_liquid | perps_sf | multi_asset | ...
  n_names       integer,                  -- BREADTH LAW: mean names per rebalance (null for single-instrument)
  n_periods     integer,                  -- portfolio observations (the honest n)
  gross_ann     double precision,
  net_ann       double precision,         -- after the family's stated cost model
  sharpe_net    double precision,
  portfolio_t   double precision,         -- PSEUDO-REPLICATION LAW: n = rebalances, never name-days
  maxdd_pct     double precision,
  ruined        boolean not null default false,
  -- the gates (all must pass for survivor status; each maps to a law)
  g_breadth     boolean,                  -- n_names >= 50 or single-instrument-exempt
  g_effect      boolean,                  -- |edge| >= 1x its round-trip cost
  g_benchmark   boolean,                  -- beats the stated null (buy-and-hold / cash) where applicable
  g_liquid      boolean,                  -- edge present ranked INSIDE the tradable universe
  g_era         boolean,                  -- sign-consistent in >= 3 of 4 eras (no calendar luck)
  g_deflation   boolean,                  -- portfolio_t > sqrt(2*ln(live trial count))
  survivor      boolean generated always as
    (coalesce(g_breadth,false) and coalesce(g_effect,false) and coalesce(g_benchmark,false)
     and coalesce(g_liquid,false) and coalesce(g_era,false) and coalesce(g_deflation,false) and not ruined) stored,
  note          text
);
create unique index if not exists trd_factory_spec on trd_factory (spec_key);
create index if not exists trd_factory_surv on trd_factory (survivor, portfolio_t desc);
alter table trd_factory enable row level security;
drop policy if exists trd_factory_read on trd_factory;
create policy trd_factory_read on trd_factory for select to authenticated using (true);
