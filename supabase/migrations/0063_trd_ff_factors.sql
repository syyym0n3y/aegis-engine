-- 0063 — Fama-French factor library (D-364). The operator's "double/triple the sample + deploy everything we know about
-- markets": the FF canon is the academic distillation of what drives cross-sectional stock returns, and Ken French publishes
-- the actual monthly factor RETURNS free/keyless back to 1926 (~1,190 months = 99 years, vs our 15). This is the sample size
-- at which the classic premia either survive heavy deflation or don't — no 15-year ambiguity. One row per month per factor.
create table if not exists trd_ff_factors (
  month   date not null,          -- month-end
  factor  text not null,          -- Mkt-RF | SMB | HML | RMW | CMA | Mom | RF
  ret     numeric not null,       -- monthly return in DECIMAL (source is %, /100 on load)
  updated_at timestamptz default now(),
  primary key (month, factor)
);
create index if not exists trd_ff_factors_factor_idx on trd_ff_factors (factor, month);
