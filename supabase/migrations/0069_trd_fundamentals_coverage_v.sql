-- 0069 (D-467c) — coverage aggregation server-side. The coverage guard was paginating 1.2M rows client-side to count
-- distinct tickers per concept; adding the ORDER BY that correctness requires (D-467) made that >2 minutes. The guard
-- only ever needed three numbers per concept — so compute them where the data lives. One indexed scan, milliseconds,
-- and no pagination to get wrong.
create or replace view trd_fundamentals_coverage_v as
  select concept,
         count(distinct ticker) filter (where ticker is not null) as tickers,
         max(period_end) as newest_period_end,
         count(*) as facts
  from trd_fundamentals
  group by concept;
