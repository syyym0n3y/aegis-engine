-- 0003_trd_platform.sql — the Aegis platform persistence layer. Broker-agnostic:
-- an account is a normalized trade/return series from ANY broker; a report is the
-- unified Verify/Protect/Allocate verdict. Append-only evidence (immutable reports).

create table if not exists public.trd_platform_reports (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- account identity (opaque; a customer/firm can key their own accounts)
  account_ref   text,
  source        text not null,            -- 'metatrader' | 'generic-csv' | 'returns' | ...
  start_equity  float8,
  n_trades      int,
  span_days     int,
  win_rate      float8,
  win_loss_ratio float8,
  -- the unified verdict
  grade         text not null,            -- A..F
  headline      text,
  report        jsonb not null            -- full PlatformReport (verify/protect/benchmark/recs)
);

alter table public.trd_platform_reports enable row level security;

-- fast lookups for a firm's dashboard
create index if not exists idx_trd_platform_reports_account on public.trd_platform_reports (account_ref, created_at desc);
create index if not exists idx_trd_platform_reports_grade on public.trd_platform_reports (grade);
