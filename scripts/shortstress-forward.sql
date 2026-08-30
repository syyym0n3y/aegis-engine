-- shortstress-forward.sql (D-721) — does BORROW STRESS (days-to-cover) condition forward equity returns?
--
-- THE QUESTION AND WHY IT MATTERS. The register (D-716) flags that every short-side result on this board ASSUMES a
-- borrow cost rather than observing one. We hold trd_short_interest with days_cover (short_qty / avg daily volume) —
-- the classic borrow-DEMAND proxy — semi-monthly, 2017-2026. If borrow stress conditions forward returns, short-side
-- work can CONDITION on an observed signal instead of a flat assumption. The academic prior is that high short
-- interest precedes LOW returns (short sellers are informed), so high days_cover should underperform.
--
-- THE LAWS, APPLIED IN THE CONSTRUCTION (not bolted on after):
--  BENCHMARK  every quintile return is reported beside the universe mean over the SAME settlements; the excess is the
--             claim, the raw return is drift.
--  LIQUIDITY  the whole test runs in the LIQUID universe only — top names by dollar volume — because a borrow signal
--             on names that cannot absorb size is not tradable. The illiquid half is where short anomalies usually
--             live and is exactly what must be excluded to make a placeable claim.
--  BREADTH    names-per-settlement is carried through so a thin cross-section is visible, not hidden.
--  The forward window is settlement -> next settlement (~15 calendar days), the natural cadence of the data.
--
-- The 999.99 days_cover sentinel (zero-volume names) is excluded — it is a missing-volume marker, not a real stress.

SET work_mem = '512MB';

BEGIN;
-- 1. Unnest equity closes once. (symbol, d, close, dollar_vol) for liquidity ranking and forward returns.
CREATE TEMP TABLE _px ON COMMIT DROP AS
SELECT symbol,
       (to_timestamp((e->>0)::bigint) AT TIME ZONE 'UTC')::date AS d,
       (e->>4)::double precision AS c,
       (e->>4)::double precision * (e->>5)::double precision AS dv
FROM trd_bars_deep, jsonb_array_elements(bars) e
WHERE asset_class = 'equity' AND (e->>4)::double precision > 0;
CREATE INDEX ON _px (symbol, d);

-- 2. Liquid universe: names whose median dollar volume over the sample is in the top third. This is the LIQUIDITY-LAW
--    tercile — the only universe in which a return is a claim about a tradable strategy.
CREATE TEMP TABLE _liq ON COMMIT DROP AS
WITH mdv AS (SELECT symbol, percentile_cont(0.5) WITHIN GROUP (ORDER BY dv) AS m FROM _px GROUP BY symbol)
SELECT symbol FROM mdv WHERE m >= (SELECT percentile_cont(0.667) WITHIN GROUP (ORDER BY m) FROM mdv);

-- 3. For each short-interest row in the liquid universe, the close AT settlement (last trading day <= settlement) and
--    ~15 calendar days later. Forward return = exit/entry - 1.
CREATE TEMP TABLE _obs ON COMMIT DROP AS
SELECT si.settlement, si.symbol, si.days_cover,
       (SELECT c FROM _px WHERE symbol = si.symbol AND d <= si.settlement ORDER BY d DESC LIMIT 1) AS entry,
       (SELECT c FROM _px WHERE symbol = si.symbol AND d <= si.settlement + 15 ORDER BY d DESC LIMIT 1) AS exit
FROM trd_short_interest si
JOIN _liq l USING (symbol)
WHERE si.days_cover IS NOT NULL AND si.days_cover > 0 AND si.days_cover < 999;

-- 4. Quintile days_cover WITHIN each settlement (cross-sectional), compute forward return, and the settlement's
--    universe mean for the BENCHMARK excess. Store a compact per-(settlement,quintile) aggregate.
CREATE TEMP TABLE _agg ON COMMIT DROP AS
WITH r AS (
  SELECT settlement, symbol, days_cover, exit/entry - 1 AS fwd,
         ntile(5) OVER (PARTITION BY settlement ORDER BY days_cover) AS q
  FROM _obs WHERE entry > 0 AND exit > 0
),
uni AS (SELECT settlement, avg(fwd) AS umean, count(*) AS n FROM r GROUP BY settlement)
SELECT r.settlement, r.q, avg(r.fwd) AS qmean, avg(r.fwd) - u.umean AS qexcess, count(*) AS qn, u.umean, u.n AS uni_n
FROM r JOIN uni u USING (settlement)
GROUP BY r.settlement, r.q, u.umean, u.n;

-- 5. Collapse across settlements: per quintile, mean excess, its t-stat over settlements, mean names/settlement.
SELECT q,
       round((avg(qmean)*100)::numeric, 3)   AS fwd_pct,
       round((avg(qexcess)*100)::numeric, 3)  AS excess_pct,
       round((avg(qexcess) / (stddev_samp(qexcess)/sqrt(count(*))))::numeric, 2) AS excess_t,
       round(avg(qn)::numeric, 0)             AS names_per_settlement,
       count(*)                                AS settlements
FROM _agg
GROUP BY q ORDER BY q;
COMMIT;
