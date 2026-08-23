-- 0087 (D-514): 8-K Item 5.02 + "resignation" events (executive resignations), 2004->present.
create table if not exists trd_events_502r (
  accession text primary key,
  symbol    text not null,
  filed     date not null
);
create index if not exists trd_e502r_sym on trd_events_502r (symbol, filed);
notify pgrst, 'reload schema';
