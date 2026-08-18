-- 0058 — FUNDAMENTALS pipeline (free/keyless EDGAR XBRL). CIK→ticker map + point-in-time fundamentals (frames API), the
-- durable value/quality/investment factor family we couldn't test. effective_date = period_end + 75d filing lag (no look-ahead).
create table if not exists trd_cik_ticker (cik text primary key, ticker text, name text, updated_at timestamptz default now());
create index if not exists trd_cik_ticker_tk on trd_cik_ticker (ticker);
create table if not exists trd_fundamentals (
  cik text not null, ticker text, concept text not null, fy int, fp text, period_end date not null,
  effective_date date, value double precision, updated_at timestamptz not null default now(),
  primary key (cik, concept, period_end));
create index if not exists trd_fund_eff on trd_fundamentals (concept, effective_date);
alter table trd_cik_ticker enable row level security;
alter table trd_fundamentals enable row level security;
