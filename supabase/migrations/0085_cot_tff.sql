-- 0085 (D-509): CFTC TFF — dealer/asset-manager/leveraged-money cohorts on financial futures, 2006->.
create table if not exists trd_cot_tff (
  market_code text not null,
  report_date date not null,
  oi bigint, dl_l bigint, dl_s bigint, am_l bigint, am_s bigint, lm_l bigint, lm_s bigint,
  primary key (market_code, report_date)
);
notify pgrst, 'reload schema';
