-- 0060 — FUNDING-FLOW tracker (D-361). Operator directive: "track which stocks are receiving large sums of funding which
-- shows signs of emerging leverage way before it becomes a large sum of the market cap." The best FREE/KEYLESS early-capital
-- signal for public tickers is SEC Form D (Reg D exempt offerings — PIPEs/private placements): filed within 15 days of first
-- sale, carries a STRUCTURED dollar amount (offeringData.totalOfferingAmount / totalAmountSold) in primary_doc.xml. Sized
-- against market cap (shares×price from trd_fundamentals/trd_bars_deep), raise/mktcap flags emerging leverage BEFORE it is a
-- large fraction of the cap. Point-in-time: effective_date = filed_date (the day it was legally knowable). Idempotent.
create table if not exists trd_fundflow (
  ticker                text not null,
  cik                   text not null,
  accession             text not null,
  form_type             text not null,               -- 'D' | 'D/A'
  filed_date            date,
  effective_date        date,                         -- = filed_date (publicly knowable that day); the asOf() gate reads this
  total_offering_amount numeric,                      -- USD; 0 or null when "indefinite"
  total_amount_sold     numeric,                      -- USD sold to date
  is_debt               boolean default false,        -- offering includes a debt/leverage security type
  industry              text,
  updated_at            timestamptz default now(),
  primary key (ticker, accession)
);
create index if not exists trd_fundflow_ticker_idx on trd_fundflow (ticker, filed_date desc);
create index if not exists trd_fundflow_filed_idx  on trd_fundflow (filed_date desc);
