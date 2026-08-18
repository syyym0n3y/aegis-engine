-- 0059 — price-accumulation worklist (D-360b). The binding constraint on cross-sectional momentum/value is broad price
-- coverage: trd_bars_deep held ~77 names while trd_fundamentals covers 4,300+. This RPC hands the compute-node worker the
-- next batch of fundamentals tickers that still lack deep daily bars, so the worker (own IP, uncapped, paced Yahoo
-- period1=0) can drain the backlog into trd_bars_deep. Clean equity tickers only (^[A-Z]{1,5}$) — no units/warrants/dots.
create or replace function trd_price_worklist(p_n int default 200)
returns table(ticker text) language sql stable as $$
  select distinct f.ticker
  from trd_fundamentals f
  where f.ticker is not null
    and f.ticker ~ '^[A-Z]{1,5}$'
    and not exists (select 1 from trd_bars_deep b where b.symbol = f.ticker)
  order by f.ticker
  limit p_n
$$;
