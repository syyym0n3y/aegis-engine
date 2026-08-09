-- D-239: the ENTIRE global equity universe (Adanos free-ticker-database → Yahoo-mapped). ~46k names / 47 exchanges /
-- 76 countries. Populated by trd-global-enum; swept by trd-global-sweep (resumable). Verdict cols filled by the sweep.
create table if not exists trd_global_universe (
  yahoo_sym    text primary key,
  ticker       text not null,
  exchange     text not null,
  country      text,
  country_code text,
  swept        boolean not null default false,
  has_data     boolean,
  n_bars       int,
  currency     text,
  last_close_usd double precision,
  ret_252      double precision,
  ripshort_fires int,
  edge_r       double precision,
  verdict      text,
  swept_at     timestamptz
);
create index if not exists trd_global_universe_unswept on trd_global_universe (swept) where swept = false;
alter table trd_global_universe enable row level security;
create policy trd_global_universe_read on trd_global_universe for select using (true);
