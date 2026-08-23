-- 0088 (D-516): 8-K Item 3.01 delisting-notice events, 2004->present.
create table if not exists trd_events_301 (
  accession text primary key,
  symbol    text not null,
  filed     date not null
);
create index if not exists trd_e301_sym on trd_events_301 (symbol, filed);
notify pgrst, 'reload schema';
