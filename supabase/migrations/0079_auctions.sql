-- 0079 (D-502): US Treasury auction results, 1979->present (api.fiscaldata.treasury.gov, Tier-B unlock).
-- Demand signals (bid-to-cover, high yield vs when-issued) for duration timing tests.
create table if not exists trd_auctions (
  cusip         text not null,
  auction_date  date not null,
  security_type text,
  security_term text,
  bid_to_cover  double precision,
  high_yield    double precision,
  offering_amt  double precision,
  primary key (cusip, auction_date)
);
notify pgrst, 'reload schema';
