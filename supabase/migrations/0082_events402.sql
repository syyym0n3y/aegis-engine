-- 0082 (D-506): 8-K Item 4.02 (non-reliance on previously issued financials) events from EDGAR full-text search,
-- 2004->present. The classic accounting red flag; filed date = public date (EDGAR same-day).
create table if not exists trd_events_402 (
  accession text primary key,
  symbol    text not null,
  filed     date not null
);
create index if not exists trd_e402_sym on trd_events_402 (symbol, filed);
notify pgrst, 'reload schema';
