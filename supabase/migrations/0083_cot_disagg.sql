-- 0083 (D-507): CFTC disaggregated COT (2006->): producer/merchant vs managed-money split — the informed-cohort
-- refinement the legacy report cannot see.
create table if not exists trd_cot_disagg (
  market_code text not null,
  report_date date not null,
  oi bigint, pm_l bigint, pm_s bigint, mm_l bigint, mm_s bigint,
  primary key (market_code, report_date)
);
notify pgrst, 'reload schema';
