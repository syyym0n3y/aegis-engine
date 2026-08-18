-- 0055 — survivorship-free UNIVERSE (fixes the last honesty caveat). Point-in-time listing status incl. DELISTED names +
-- delisting dates (AlphaVantage LISTING_STATUS). The membership survivor-only datasets drop — the root of survivorship bias.
create table if not exists trd_universe (
  ticker text primary key, name text, exchange text, asset_type text,
  ipo_date date, delisting_date date, status text, source text,
  updated_at timestamptz not null default now()
);
create index if not exists trd_universe_delisted on trd_universe (status) where status='Delisted';
alter table trd_universe enable row level security;
