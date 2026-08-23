-- 0077 (D-494): 13F institutional ownership aggregates, 2013q2->present. The hedge-fund/institutional complement to
-- N-PORT's registered funds (trd_nport_ownership). Only per-(cusip, report_period) aggregates are stored.
-- Amendments deduped: per (CIK, period) only the LATEST-FILED 13F-HR counts. PUT/CALL rows excluded.
-- VALUE unit change handled at ingest: $thousands before the 2023 full-dollar rule, dollars after.
-- effective_date = actual FILING_DATE aggregated per period as the LAST filing that contributed (conservative:
-- a backtest may only read the aggregate once every contributor had filed).
create table if not exists trd_13f_ownership (
  cusip        text not null,
  report_date  date not null,
  effective_date date not null,
  n_mgrs       integer not null,
  shares       double precision,
  value_usd    double precision,
  primary key (cusip, report_date)
);
create index if not exists trd_13f_own_eff on trd_13f_ownership (effective_date);
notify pgrst, 'reload schema';
