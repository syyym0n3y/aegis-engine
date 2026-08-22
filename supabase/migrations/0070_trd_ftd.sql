-- 0070 (D-469) — SEC fails-to-deliver: settlement stress per symbol per day, 2004-2026, half-monthly files.
-- Symbol-keyed at source (no CUSIP mapping problem, unlike 13F). Never held before.
create table if not exists trd_ftd (
  settle_date date not null,
  symbol      text not null,
  qty_fails   bigint not null,
  price       double precision,
  primary key (settle_date, symbol)
);
create index if not exists trd_ftd_sym on trd_ftd (symbol, settle_date);
alter table trd_ftd enable row level security;
drop policy if exists trd_ftd_read on trd_ftd;
create policy trd_ftd_read on trd_ftd for select to authenticated using (true);
