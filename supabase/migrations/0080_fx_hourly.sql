-- 0080 (D-504): FX hourly bars aggregated from Dukascopy m1 candles (bid), 2016->present, 4 majors.
-- Opens the intraday-FX family (sessions, time-of-day, intraday momentum/reversal).
create table if not exists trd_fx_hourly (
  symbol text not null,
  ts     bigint not null,            -- hour start, epoch seconds UTC
  o double precision, h double precision, l double precision, c double precision,
  vol double precision,
  primary key (symbol, ts)
);
notify pgrst, 'reload schema';
