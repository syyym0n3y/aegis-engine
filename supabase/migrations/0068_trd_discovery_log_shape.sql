-- 0068 (D-467b) — the discovery agent's log write had been 400-ing silently: the agent emits ~20 fields, the table had 12.
-- Caught by the WRITE-FAILED instrumentation within ONE cycle of shipping it. The rich shape is the real record — widen
-- the table to hold it. Legacy columns stay nullable for old rows.
alter table trd_discovery_log
  add column if not exists ruined boolean,
  add column if not exists train_net_sharpe double precision,
  add column if not exists test_net_sharpe double precision,
  add column if not exists test_months integer,
  add column if not exists gross_sharpe double precision,
  add column if not exists net_sharpe double precision,
  add column if not exists net_ann_pct double precision,
  add column if not exists win_pct double precision,
  add column if not exists skew double precision,
  add column if not exists maxdd_pct double precision,
  add column if not exists psr_valid boolean,
  add column if not exists sharpe_ex_top1 double precision,
  add column if not exists sharpe_ex_top3 double precision,
  add column if not exists noise_ceiling double precision,
  add column if not exists per_era_net_sharpe jsonb,
  add column if not exists n_months integer;
