-- D-245: monthly close series for the ENTIRE universe → cross-sectional factor tests (momentum/reversal/low-vol),
-- ranked WITHIN each market in SQL. Market-neutral long-short → the spread t-stat vs 0 is the clean edge test.
alter table trd_global_universe add column if not exists xsec_swept boolean not null default false;
create index if not exists trd_global_universe_xsec_unswept on trd_global_universe (xsec_swept) where xsec_swept = false;
create table if not exists trd_monthly (
  yahoo_sym text not null, exchange text not null, month date not null,
  close double precision not null, primary key (yahoo_sym, month)
);
create index if not exists trd_monthly_exch_month on trd_monthly (exchange, month);
alter table trd_monthly enable row level security;
create policy trd_monthly_read on trd_monthly for select using (true);
