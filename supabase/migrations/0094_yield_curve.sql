-- 0094_yield_curve.sql (W2) — the US Treasury yield curve, which this programme has never held.
--
-- THE GAP. Week 2's coverage audit found NO rates table of any kind. The attribution engine (aegis-attribution.ts)
-- uses TLT — a long-duration bond ETF — as its entire RATES force. That is a proxy for one point on the curve,
-- carrying the fund's own duration, expense and flow effects, and it cannot express curve SHAPE at all. Every
-- attribution result on this board therefore models "rates" as a single ETF's return.
--
-- The actual curve is free, keyless, and the endpoint was already allowlisted. Leaving it unfetched was a research
-- failure, not a data limitation — the same class of gap the COVERAGE LAW was written for, and the third such gap
-- found in two days (spot 33-of-484, ATS type split, now this).
create table if not exists trd_yield_curve (
  d          date primary key,
  m1         double precision, m1_5 double precision, m2 double precision, m3 double precision,
  m4         double precision, m6   double precision,
  y1         double precision, y2   double precision, y3 double precision, y5 double precision,
  y7         double precision, y10  double precision, y20 double precision, y30 double precision,
  ingested_at timestamptz not null default now()
);
create index if not exists trd_yield_curve_d_idx on trd_yield_curve (d desc);
