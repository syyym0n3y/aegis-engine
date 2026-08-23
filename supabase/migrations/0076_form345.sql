-- 0076 (D-490): full insider transaction aggregates from SEC DERA Form 3/4/5 structured sets, 2006q1-2026q2.
-- Replaces the buys-only crawl as source of record and unblocks the SELLS side (open-list item).
-- effective_date = FILING_DATE (the Form 4 is public on EDGAR the day it is filed).
create table if not exists trd_form345 (
  symbol    text not null,
  filed     date not null,
  buy_usd   double precision not null default 0,   -- TRANS_CODE='P' open-market purchases
  sell_usd  double precision not null default 0,   -- TRANS_CODE='S' open-market sales
  n_buy     integer not null default 0,
  n_sell    integer not null default 0,
  primary key (symbol, filed)
);
notify pgrst, 'reload schema';
