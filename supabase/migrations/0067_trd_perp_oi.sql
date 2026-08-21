-- 0067_trd_perp_oi.sql (D-427) — open-interest history for perpetual futures.
-- Rationale: D-424 established that the equity cross-section is capacity-bound. Perps are not, and they expose positioning
-- data equities have no analogue for. Open interest is the cleanest of these: OI tells you whether a price move is NEW
-- positioning or the UNWINDING of old positioning, which price alone cannot distinguish.
-- Source: Bybit v5/market/open-interest (free, keyless, already allowlisted), cursor-paginated back multiple years.
create table if not exists trd_perp_oi (
  symbol      text not null,
  venue       text not null default 'bybit',
  interval    text not null default '1d',
  ts          bigint not null,          -- unix seconds, bar open
  open_interest double precision not null,   -- in base units (contracts)
  updated_at  timestamptz not null default now(),
  primary key (symbol, venue, interval, ts)
);
create index if not exists trd_perp_oi_sym_ts on trd_perp_oi (symbol, ts);
alter table trd_perp_oi enable row level security;
-- read-only to authenticated; writes are service-role only (matches every other trd_* table after 0064).
drop policy if exists trd_perp_oi_read on trd_perp_oi;
create policy trd_perp_oi_read on trd_perp_oi for select to authenticated using (true);
