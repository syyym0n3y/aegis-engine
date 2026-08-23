-- 0073 (D-475) — the short-side data I ruled "underpowered" WITHOUT FETCHING WHAT WAS FREE AND ALLOWLISTED.
-- D-391 said "short interest: 26 settlements, underpowered" while FINRA's daily short-sale volume (per symbol, ~2010->)
-- and its consolidated semi-monthly short-interest API sat reachable the entire time. That verdict was a Coverage-Law
-- violation by the program's own author. These tables fix the input; the verdict gets re-earned after.
create table if not exists trd_short_volume (
  d           date not null,
  symbol      text not null,
  short_vol   double precision not null,
  total_vol   double precision not null,
  primary key (d, symbol)
);
create index if not exists trd_shortvol_sym on trd_short_volume (symbol, d);
create table if not exists trd_short_interest (
  settlement  date not null,
  symbol      text not null,
  short_qty   bigint not null,
  adv_qty     bigint,
  days_cover  double precision,
  primary key (settlement, symbol)
);
alter table trd_short_volume enable row level security;
alter table trd_short_interest enable row level security;
drop policy if exists sv_r on trd_short_volume; create policy sv_r on trd_short_volume for select to authenticated using (true);
drop policy if exists si_r on trd_short_interest; create policy si_r on trd_short_interest for select to authenticated using (true);
