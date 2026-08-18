-- 0047 — the causal ATTRIBUTION store (layer 1). Each instrument's return decomposed onto ALL causal forces at once
-- (multi-factor OLS): explained R2 + honest residual (1-R2) + per-force loadings (the "why") + per-era context (how the
-- drivers change across market cycles). This is the machine that knows WHY each instrument moves — ignorance measured.
create table if not exists trd_attribution (
  symbol     text primary key,
  asof       date not null,
  r2         double precision not null,
  residual   double precision not null,
  n          integer not null,
  betas      jsonb,
  per_era    jsonb,
  updated_at timestamptz not null default now()
);
alter table trd_attribution enable row level security;
