-- 0078 (D-501): CFTC Commitments of Traders, legacy futures-only format, 1986->present weekly.
-- The only multi-decade positioning dataset in existence. Report is Tuesday positions published Friday ~15:30 ET,
-- so the signal lag is +3 days minimum — enforced in the factory (effective = report_date + 5 calendar, conservative).
create table if not exists trd_cot (
  market_code text not null,
  report_date date not null,
  market_name text,
  oi          bigint,
  ncl bigint, ncs bigint, ncsp bigint,   -- noncommercial long / short / spreading
  cl  bigint, cs  bigint,                -- commercial long / short
  nrl bigint, nrs bigint,                -- nonreportable long / short
  primary key (market_code, report_date)
);
notify pgrst, 'reload schema';
