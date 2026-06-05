-- 0001_trd_substrate.sql — Stage-1 schema for the trading falsification engine.
-- Governed by CC (D-070). NO real money touched by anything this migration creates.
-- Conventions inherited from command-centre: idempotent (IF NOT EXISTS), RLS on
-- every table, append-only where the doctrine demands an immutable evidence trail,
-- service-role-only by default (the CC oversight panel reads via a service-role
-- bridge over the HTTP boundary — never direct DB access from a browser).

-- ---------- append-only guard (immutable evidence trail) ----------
create or replace function trd_block_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception 'append-only table %: UPDATE/DELETE forbidden (trd doctrine)', tg_table_name;
end $$;

-- ============================================================
-- INGESTION (append-only, legally-public free sources only)
-- ============================================================

-- Every congressional PTR + SEC EDGAR filing. trade_date vs disclosed_date are
-- BOTH first-class so the 45-day STOCK Act lag can never be engineered away.
create table if not exists trd_raw_filings (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('house','senate','edgar')),
  source_id       text not null,                 -- filing_id / accession_no (idempotency)
  filing_type     text,                          -- PTR / Form4 / 13F-HR / ...
  ticker          text,
  person          text,                          -- member / insider
  trade_date      date,
  disclosed_date  date,                          -- the LEGALLY-knowable date
  amount_low      numeric,                       -- PTRs disclose ranges, not exacts
  amount_high     numeric,
  raw             jsonb not null default '{}'::jsonb,
  ingested_at     timestamptz not null default now(),
  unique (source, source_id)
);

-- OHLCV. PRICE-REVISION BITEMPORALITY (adversarial-pass fix): split/dividend
-- re-adjustments create NEW rows (distinct as_of), never overwrites — so a
-- backtest as-of date D reads the bar as it was knowable on D, not as later
-- retroactively adjusted. Delisting-inclusive (survivorship-safe) by policy.
create table if not exists trd_price_bars (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null,
  timeframe   text not null,                     -- 1Day / 1Hour / ...
  ts          timestamptz not null,              -- bar timestamp
  as_of       timestamptz not null default now(),-- when THIS version was knowable
  open        numeric, high numeric, low numeric, close numeric,
  volume      numeric,
  adjusted    boolean not null default false,
  is_delisted boolean not null default false,
  source      text not null default 'alpaca',
  ingested_at timestamptz not null default now(),
  unique (symbol, timeframe, ts, as_of)
);
create index if not exists idx_trd_bars_sym_tf_ts on trd_price_bars (symbol, timeframe, ts);

-- ============================================================
-- POINT-IN-TIME FEATURE STORE (the structural anti-look-ahead)
-- ============================================================
-- Congressional/Form-4/13F land here as ONE column family among price/vol/regime
-- features, each carrying its disclosure-lagged effective_date. Folklore inputs
-- (options flow, short interest) carry requires_oos_proof=true.
create table if not exists trd_features (
  id                 uuid primary key default gen_random_uuid(),
  feature_key        text not null,
  symbol             text,
  effective_date     timestamptz not null,       -- legally knowable as-of
  value              numeric,
  value_json         jsonb,
  requires_oos_proof boolean not null default false,
  source_filing      uuid references trd_raw_filings(id),
  created_at         timestamptz not null default now()
);
create index if not exists idx_trd_features_key_sym_eff
  on trd_features (feature_key, symbol, effective_date);

-- ============================================================
-- STRATEGY / BACKTEST / TRIALS
-- ============================================================
create table if not exists trd_strategy_specs (
  id         uuid primary key default gen_random_uuid(),
  family     text not null,
  name       text not null,
  version    int  not null default 1,
  spec       jsonb not null,                     -- declarative: universe/entry/exit/sizing
  created_at timestamptz not null default now(),
  unique (family, name, version)
);

-- Every backtest run increments this — INCLUDING failed/iterated runs, not just
-- promoted specs (adversarial-pass fix: under-counting trials silently inflates DSR).
create table if not exists trd_trial_counter (
  id         uuid primary key default gen_random_uuid(),
  family     text not null,
  run_key    text not null unique,               -- idempotency
  counted_at timestamptz not null default now()
);

create table if not exists trd_backtest_runs (
  id            uuid primary key default gen_random_uuid(),
  spec_id       uuid references trd_strategy_specs(id),
  run_key       text not null unique,             -- idempotency
  n_trials      int  not null default 1,          -- N this Sharpe is reported next to
  stats         jsonb not null,                   -- DSR/PBO/sortino/maxDD/calmar/turnover/capacity/hit/payoff/minTRL/netReturn
  decomposition jsonb,                            -- {sector_beta,size,residual_alpha} vs SPY AND NANC
  passed        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- SIGNALS (proposals, never orders) + LADDER + RISK + KILL-SWITCH
-- ============================================================
-- EXFILTRATION INVARIANT (adversarial-pass fix): signals are single-operator and
-- never published — sharing a specific buy/sell rec for value likely triggers
-- Investment-Adviser registration. single_operator defaults true and the table
-- is service-role-only; there is no browser read path.
create table if not exists trd_signals (
  id              uuid primary key default gen_random_uuid(),
  spec_id         uuid references trd_strategy_specs(id),
  symbol          text not null,
  side            text not null check (side in ('buy','sell','flat')),
  confidence      text not null check (confidence in ('certain','likely','guessing')),
  as_of           timestamptz not null default now(),
  rationale       text,
  single_operator boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists trd_ladder_state (
  id         uuid primary key default gen_random_uuid(),
  spec_id    uuid references trd_strategy_specs(id),
  rung       text not null check (rung in ('RESEARCH','PAPER','MICRO','SMALL','SCALED','REJECTED','DEMOTED')),
  evidence   jsonb not null default '{}'::jsonb,  -- the proof that justified the move
  decided_by text not null default 'architect-gate',
  created_at timestamptz not null default now()
);
create index if not exists idx_trd_ladder_spec on trd_ladder_state (spec_id, created_at desc);

create table if not exists trd_risk_ledger (
  id           uuid primary key default gen_random_uuid(),
  decision_key text not null unique,              -- idempotency (no duplicate fills)
  kind         text not null check (kind in ('sized','vetoed','scaled','fill')),
  spec_id      uuid references trd_strategy_specs(id),
  symbol       text,
  intended     jsonb,
  actual       jsonb,
  per_lot      jsonb,                              -- basis + holding period (wash-sale / 475(f))
  created_at   timestamptz not null default now()
);

-- Durable singleton per account — survives daemon restarts so a crash can NEVER
-- silently re-enable trading. (Updatable: this is live state, not evidence.)
create table if not exists trd_kill_switch (
  account      text primary key,
  state        text not null default 'armed' check (state in ('armed','tripped','locked')),
  equity_high  numeric,                            -- for the trailing-drawdown ratchet
  tripped_at   timestamptz,
  locked_until timestamptz,
  reason       text,
  updated_at   timestamptz not null default now()
);

-- The operator's MANUAL-TRADE LOG (adversarial-pass fix: was missing from Stage 1).
-- No broker needed. Captures intended-vs-actual fill → the REAL post-cost success
-- rate, which calibrates the cost model and is the ground truth the whole engine
-- is measured against.
create table if not exists trd_manual_trades (
  id                uuid primary key default gen_random_uuid(),
  symbol            text not null,
  side              text not null check (side in ('buy','sell')),
  intended_price    numeric,
  actual_fill_price numeric,
  shares            numeric,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  exit_price        numeric,
  gross_pnl         numeric,
  fees              numeric,
  slippage_bps      numeric,                       -- (actual-intended)/intended * 1e4
  strategy_family   text,
  confidence        text check (confidence in ('certain','likely','guessing')),
  note              text,
  created_at        timestamptz not null default now()
);

-- DECISION-LOCKED gate thresholds (adversarial-pass fix: a motivated operator
-- must not be able to quietly loosen DSR>0.95 to force a promotion). Append-only;
-- changing a threshold = inserting a NEW row that names the DECISIONS.md entry
-- (decision_ref) authorizing the change. Latest row per key wins.
create table if not exists trd_gate_thresholds (
  id           uuid primary key default gen_random_uuid(),
  key          text not null,
  value        jsonb not null,
  decision_ref text not null,                      -- e.g. 'D-070' — Architect-veto trail
  set_at       timestamptz not null default now()
);
create index if not exists idx_trd_gate_key on trd_gate_thresholds (key, set_at desc);

-- ---------- append-only triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'trd_raw_filings','trd_price_bars','trd_features','trd_strategy_specs',
    'trd_trial_counter','trd_backtest_runs','trd_signals','trd_ladder_state',
    'trd_risk_ledger','trd_gate_thresholds'
  ] loop
    execute format('drop trigger if exists %I on %I', 'noupd_'||t, t);
    execute format('create trigger %I before update or delete on %I for each row execute function trd_block_mutation()', 'noupd_'||t, t);
  end loop;
end $$;
-- NOTE: trd_kill_switch and trd_manual_trades are intentionally mutable (live
-- state / operator edits a closing trade), so they get no append-only trigger.

-- ---------- RLS: service-role-only by default (deny anon/authenticated) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'trd_raw_filings','trd_price_bars','trd_features','trd_strategy_specs',
    'trd_trial_counter','trd_backtest_runs','trd_signals','trd_ladder_state',
    'trd_risk_ledger','trd_kill_switch','trd_manual_trades','trd_gate_thresholds'
  ] loop
    execute format('alter table %I enable row level security', t);
    -- no permissive policy → anon/authenticated denied; service_role bypasses RLS.
  end loop;
end $$;

-- ---------- seed the gate thresholds (authorized by D-070) ----------
insert into trd_gate_thresholds (key, value, decision_ref)
select * from (values
  ('stats_gate',        '{"dsr_min":0.95,"pbo_max":0.5,"require_net_of_cost_positive":true,"require_mintrl_satisfied":true,"dsr_benchmark_sharpe":"SPY"}'::jsonb, 'D-070'),
  ('sample_floors',     '{"paper_to_micro":30,"micro_to_small":50,"small_to_scaled":100}'::jsonb, 'D-070'),
  ('risk_policy',       '{"per_trade_risk_pct":0.5,"per_trade_risk_cap_pct":1.0,"max_concurrent_risk_pct":1.5,"daily_loss_kill_pct":2.0,"weekly_trailing_kill_pct":6.0,"max_trades_per_day":8,"max_concurrent_positions":5,"correlation_budget_threshold":0.6,"kelly_fraction":0.25}'::jsonb, 'D-070'),
  ('project_kill',      '{"shelve_after_families":25,"shelve_after_compute_hours":200,"required_promotions_past_paper":1,"null_result_is_success":true}'::jsonb, 'D-070')
) as v(key,value,decision_ref)
where not exists (select 1 from trd_gate_thresholds g where g.key = v.key);

comment on table trd_gate_thresholds is 'Decision-locked. Changing a threshold requires a NEW row naming the authorizing DECISIONS.md entry (decision_ref). Never UPDATE.';
comment on table trd_signals is 'Single-operator. Never published/exfiltrated — sharing specific buy/sell recs for value triggers Investment-Adviser registration.';
