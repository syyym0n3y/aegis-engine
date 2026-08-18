-- 0062 — funding-flow signal upgraded to true % of MARKET CAP (D-361b). Now that shares outstanding are loaded
-- (dei:EntityCommonStockSharesOutstanding), market cap = shares × latest price (from trd_bars_deep). raise_to_mktcap is the
-- operator's exact ask: how large is the new capital relative to the CURRENT market value — flags emerging leverage before
-- the raise is reflected in the cap. raise_to_equity (book) kept as the fallback where price is not yet accumulated.
-- Point-in-time: shares/equity read at effective_date <= filed_date; price is latest-available (upgrade to filed-date price
-- once intraday-at-date is wired). is_debt separates leverage-proper raises.
drop view if exists trd_fundflow_signal;
create view trd_fundflow_signal as
select
  ff.ticker, ff.filed_date, ff.form_type, ff.is_debt, ff.industry,
  ff.total_offering_amount as offering, ff.total_amount_sold as sold,
  eq.value as book_equity,
  sh.value as shares_out,
  px.last_close,
  case when sh.value>0 and px.last_close>0 then round((sh.value*px.last_close)::numeric,0) end as market_cap,
  case when eq.value>0 then round((ff.total_amount_sold/eq.value)::numeric,4) end as raise_to_equity,
  case when sh.value>0 and px.last_close>0 then round((ff.total_amount_sold/(sh.value*px.last_close))::numeric,4) end as raise_to_mktcap,
  (px.last_close is not null) as has_price
from trd_fundflow ff
left join lateral (select value from trd_fundamentals f where f.ticker=ff.ticker and f.concept='StockholdersEquity' and f.effective_date<=ff.filed_date order by f.period_end desc limit 1) eq on true
left join lateral (select value from trd_fundamentals f where f.ticker=ff.ticker and f.concept='EntityCommonStockSharesOutstanding' and f.effective_date<=ff.filed_date order by f.period_end desc limit 1) sh on true
left join lateral (select (b.bars->-1->>4)::numeric as last_close from trd_bars_deep b where b.symbol=ff.ticker) px on true
where ff.total_amount_sold is not null;
