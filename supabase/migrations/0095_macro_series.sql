-- 0095_macro_series.sql (W2) — destination for FRED macro series, created ahead of the key.
-- The board has never conditioned any verdict on a macro regime variable, and the attribution engine proxies CREDIT
-- with the HYG ETF rather than an actual spread. This table exists so that closing the gap is a paste-a-key action
-- rather than a build.
create table if not exists trd_macro_series (
  series text not null,
  d      date not null,
  v      double precision,
  primary key (series, d)
);
create index if not exists trd_macro_series_d_idx on trd_macro_series (series, d desc);
