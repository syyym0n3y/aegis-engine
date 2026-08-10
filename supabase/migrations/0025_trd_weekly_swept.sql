-- D-247: weekly-timeframe setup sweep flag. Reuses trd_global_setups (setups suffixed _wk). Weekly-calibrated params.
alter table trd_global_universe add column if not exists weekly_swept boolean not null default false;
create index if not exists trd_global_universe_weekly_unswept on trd_global_universe (weekly_swept) where weekly_swept = false;
