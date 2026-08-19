-- 0065 — AUTOPILOT log (D-369). The autonomous control loop writes one row per cycle: the deflated verdict on the latest
-- data + whether the statistical position improved vs the prior cycle. This is the "are we in a better position?" ledger the
-- operator asked for — the engine grading itself over time, honestly. DORMANT invariant: `armed` is always false here; the
-- autopilot NEVER trades or spends — it researches, verifies, records, and SURFACES anything that clears for the operator to
-- arm. Autonomy without capital risk (RISK_POLICY / D-070).
create table if not exists trd_autopilot_log (
  id            bigserial primary key,
  cycle_at      timestamptz not null default now(),
  cycle_n       int,
  data_rows     int,                    -- rows of evidence this cycle saw
  best_factor   text,                   -- the single strongest factor this cycle
  best_psr_z    numeric,                -- its deflation-adjusted z (vs the noise ceiling)
  noise_ceiling numeric,
  n_clearing    int,                    -- how many factors cleared deflation (the honest count; usually 0-1)
  position_score numeric,               -- best_psr_z − noise_ceiling: >0 means something genuinely clears
  delta_vs_prev numeric,                -- change in position_score vs the last cycle (are we improving?)
  armed         boolean not null default false,   -- ALWAYS false — autopilot is research-only; arming is the operator's act
  surfaced      text,                   -- non-null = "operator, look: X cleared" (still not auto-armed)
  verdict       jsonb,
  updated_at    timestamptz default now()
);
alter table trd_autopilot_log enable row level security;
create index if not exists trd_autopilot_log_cyc on trd_autopilot_log (cycle_at desc);
