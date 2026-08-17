-- 0045_trd_bars_deep — deep multi-cycle daily history store (keyless Yahoo, period1=0). One compact row per symbol
-- holding the full daily series as a JSONB array of [ts,o,h,l,c,v]. Foundation for HONEST era-disaggregated testing:
-- every factor/grammar test re-runs across 25-56 years spanning 1987/dot-com/GFC/COVID/2022, cut by era + deflated.
create table if not exists trd_bars_deep (
  symbol      text primary key,
  asset_class text,                    -- index|equity|sector|commodity|fx|rate|etf
  first_date  date,
  last_date   date,
  n_bars      int,
  bars        jsonb not null,          -- [[ts,o,h,l,c,v], ...] ascending; ts = unix seconds (UTC day)
  updated_at  timestamptz not null default now()
);
alter table trd_bars_deep enable row level security;
