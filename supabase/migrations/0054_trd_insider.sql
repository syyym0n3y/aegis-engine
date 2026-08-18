-- 0054 — insider open-market BUY events (SEC EDGAR Form-4, keyless) + resumable backfill cursor. disclosed_date =
-- legally-knowable filing date (45-day-style lag first-class); trade_date = transaction. Backfilled from daily-index archives.
create table if not exists trd_insider (
  ticker text not null, accession text not null, disclosed_date date, trade_date date,
  value_usd double precision, shares double precision, price double precision, owner text, is_officer boolean,
  updated_at timestamptz not null default now(), primary key (ticker, accession)
);
create index if not exists trd_insider_disc on trd_insider (disclosed_date);
create table if not exists trd_insider_cursor (id text primary key default 'default', last_date date, last_offset int default 0, updated_at timestamptz default now());
insert into trd_insider_cursor (id, last_date, last_offset) values ('default', current_date, 0) on conflict (id) do nothing;
alter table trd_insider enable row level security;
