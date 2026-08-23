-- 0074 (D-479) — real earnings events with ACTUAL EPS, consensus, and % surprise (Nasdaq calendar, 2017->).
-- D-393's PEAD null was measured WITHOUT real surprise data; this is the input it should have had.
create table if not exists trd_earnings (
  report_date  date not null,
  symbol       text not null,
  eps          double precision,
  eps_forecast double precision,
  surprise_pct double precision,
  n_ests       integer,
  when_        text,                -- pre-market / after-hours / time-not-supplied
  fiscal_q     text,
  primary key (report_date, symbol)
);
create index if not exists trd_earn_sym on trd_earnings (symbol, report_date);
alter table trd_earnings enable row level security;
drop policy if exists e_r on trd_earnings; create policy e_r on trd_earnings for select to authenticated using (true);
