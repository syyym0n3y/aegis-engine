-- D-249: intraday (hourly) crypto/FX edge tests split by trading SESSION (Asia/London/NY) vs session-matched random.
create table if not exists trd_intraday_sessions (
  instrument text not null, asset_class text not null, setup text not null, session text not null,
  n int not null, edge_r double precision, primary key (instrument, setup, session)
);
alter table trd_intraday_sessions enable row level security;
create policy trd_intraday_sessions_read on trd_intraday_sessions for select using (true);
