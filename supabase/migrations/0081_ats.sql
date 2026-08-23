-- 0081 (D-505): FINRA ATS/OTC weekly per-symbol off-exchange volume (api.finra.org, ~2022->, boundary measured).
-- published = initialPublishedDate (FINRA's own +2-4wk dissemination lag, point-in-time by construction).
create table if not exists trd_ats_weekly (
  symbol     text not null,
  week_start date not null,
  type       text not null,             -- ATS_W_SMBL (dark pools) | OTC_W_SMBL (internalizers)
  published  date,
  shares     double precision,
  trades     double precision,
  primary key (symbol, week_start, type)
);
notify pgrst, 'reload schema';
