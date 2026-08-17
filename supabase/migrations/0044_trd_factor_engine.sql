-- 0044_trd_factor_engine.sql — the MODULAR CAUSAL-FACTOR ENGINE (D-331). The pivot out of candle-grammar space.
-- The grammar mined candle GEOMETRY (effects): ~1.47M specs, 988 in-sample survivors, 1 forward-clean. This engine
-- mines FORCES (causes): any hypothesized causal force plugs in as a first-class factor, is measured by its marginal
-- Information Coefficient (rank-corr of factor vs forward return), deflated by trial count, conditioned on regime, and
-- promoted into the SAME honest gate (trd_edge_scorecard/trd_lineage) so factors and candle-edges compete in one ledger.
-- The single design element that makes this CAUSAL not fishing: hypothesized_sign is PRE-REGISTERED before the IC test.
-- Look-ahead becomes STRUCTURALLY impossible: effective_date (knowable date) is a NOT-NULL column with a CHECK, the
-- DB twin of the TS assertHasEffectiveDate() discipline — the trd_features store CLAUDE.md always assumed but never had.

-- (A) FACTOR REGISTRY — one row per hypothesized causal force. Pre-registered: mechanism + sign declared before testing.
create table if not exists trd_factor (
  id                  text primary key,               -- 'funding_carry', 'form4_opportunistic', 'db_ofi_es', 'moc_imbalance'
  name                text not null,
  force_class         text not null,                  -- order_flow|dealer_flow|positioning|information|cross_asset|regime|carry
  mechanism           text not null,                  -- the WHY (the cause, not the shape) — one sentence
  observable          text not null,                  -- what is literally measured
  hypothesized_sign   smallint not null,              -- +1/-1 expected IC sign, DECLARED BEFORE TESTING (kills hindsight fitting)
  data_source         text not null,                  -- 'binance:funding' | 'sec:form4' | 'databento:GLBX.MDP3:mbp-10' | 'alphavantage:EARNINGS'
  effective_date_rule text not null,                  -- how knowable-date is derived ('t+0 close','disclosure_date','filing+45d')
  cost_per_pull_usd   numeric not null default 0,     -- metered sources (Databento) > 0; free/keyless = 0
  status              text not null default 'proposed', -- proposed|measuring|live|rejected|decayed
  decision_ref        text,
  created_at          timestamptz not null default now(),
  constraint sign_is_unit check (hypothesized_sign in (-1, 1))
);

-- (B) POINT-IN-TIME FACTOR VALUES — the materialized feature store. effective_date = when the value was LEGALLY KNOWABLE;
-- a backtest asOf(D) reads ONLY effective_date <= D. The CHECK makes leakage impossible at the storage layer.
create table if not exists trd_factor_value (
  factor_id      text not null references trd_factor(id),
  symbol         text not null,
  ts             timestamptz not null,               -- the observation timestamp the value describes
  effective_date timestamptz not null,               -- knowable date (>= ts by the source's lag) — FAIL-CLOSED NOT NULL
  value          double precision not null,
  raw            jsonb,                               -- provenance / intermediates (append-only)
  ingested_at    timestamptz not null default now(),
  primary key (factor_id, symbol, ts),
  constraint pit_no_leak check (effective_date >= ts)  -- knowable-date can NEVER precede the event it describes
);
create index if not exists trd_factor_value_asof on trd_factor_value (factor_id, symbol, effective_date);

-- (C) IC TEST HARNESS — append-only evidence, one row per (factor × universe × horizon × regime × run). Deflation-honest:
-- every run bumps trd_trial_counter; ic_t is always reported next to its N.
create table if not exists trd_factor_ic (
  id         bigint generated always as identity primary key,
  factor_id  text not null references trd_factor(id),
  symbol_set text not null,                           -- 'crypto16' | 'us_liquid_500' | 'es_nq'
  horizon    text not null,                           -- forward-return horizon: '15m'|'1h'|'1d'|'5d'
  ic         double precision not null,               -- rank-IC (Spearman) of factor_value vs forward return
  ic_t       double precision not null,               -- t-stat of the IC (its N is mandatory, alongside)
  n          integer not null,
  regime     text,                                    -- 'vol_hi'|'trend_up'|null=all — regime-conditional IC
  n_trials   integer not null default 1,              -- feeds DSR deflation; NEVER omit
  decayed    boolean not null default false,          -- true when a live factor's IC crosses zero OOS
  detail     text,
  run_at     timestamptz not null default now()
);
create index if not exists trd_factor_ic_lookup on trd_factor_ic (factor_id, symbol_set, horizon, run_at desc);

alter table trd_factor enable row level security;
alter table trd_factor_value enable row level security;
alter table trd_factor_ic enable row level security;
