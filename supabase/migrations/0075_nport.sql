-- 0075 (D-488): N-PORT monthly fund ownership, aggregated per security.
-- Source: SEC DERA form-n-port-data-sets quarterly zips (FUND_REPORTED_HOLDING, ~910MB/qtr raw — only
-- per-(cusip,report_date) aggregates are stored). effective_date = report_date + 60d: N-PORT public
-- dissemination is 60 days after the fund's fiscal quarter end, so that is when the report was legally knowable.
create table if not exists trd_nport_ownership (
  cusip        text not null,
  report_date  date not null,
  effective_date date not null,
  n_positions  integer not null,      -- fund positions holding the name that month
  shares       double precision,      -- sum of BALANCE where UNIT='NS'
  value_usd    double precision,      -- sum of CURRENCY_VALUE (USD)
  primary key (cusip, report_date)
);
create index if not exists trd_nport_own_eff on trd_nport_ownership (effective_date);
-- CUSIP->symbol bridge rebuilt from SEC fails-to-deliver files (they carry both columns).
create table if not exists trd_cusip_map (
  cusip  text primary key,
  symbol text not null
);
notify pgrst, 'reload schema';
