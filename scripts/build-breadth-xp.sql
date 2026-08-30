-- build-breadth.sql (D-717) — equity market BREADTH, computed in-DB from the panel we already hold.
--
-- WHY IN-DB. The panel is 19.2M bars across 4,184 equities. Shipping that as jsonb over REST to compute breadth in
-- Deno would move ~1GB; the whole computation is an aggregation Postgres does natively. Everything below runs inside
-- the owned node and writes only the finished daily series.
--
-- THE SURVIVORSHIP CAVEAT, STATED IN THE DATA ITSELF. This panel holds SURVIVING names — the delisted-history hole
-- (27.3% of the equity universe, D-687/D-703) means dead companies are absent. A breadth LEVEL computed here is
-- therefore biased UP: the names that fell below their averages and delisted are not counted. The series are still
-- valid as CONDITIONING variables (their MOVES are informative), but the level is not the true market's. This is
-- recorded as a suffix on every series name so no downstream reader can forget it.
--
-- FIVE SERIES, the classic equity-index breadth conditioners (the register's 'breadth' driver):
--   breadth_pct_gt_200dma_xp   fraction of names above their own 200-day moving average
--   breadth_pct_gt_50dma_xp    fraction above their 50-day MA
--   breadth_adv_frac_xp        daily advancers / (advancers + decliners)  [net participation]
--   breadth_pct_252d_high_xp   fraction within 2% of their trailing 252-day high  (new-highs proxy)
--   breadth_pct_252d_low_xp    fraction within 2% of their trailing 252-day low   (new-lows proxy)
--
-- IDEMPOTENT: ON CONFLICT (series,d) DO UPDATE, so a re-run overwrites the same keys and never duplicates.

-- Single transaction: the temp tables below are ON COMMIT DROP, so the whole pipeline — unnest, features, aggregate,
-- insert — must live in one transaction or the tables vanish under psql's per-statement autocommit.
BEGIN;
SET LOCAL work_mem = '512MB';

-- One row per (symbol, day, close), unnested once and reused. Materialized so the window functions below don't
-- re-parse the jsonb five times.
CREATE TEMP TABLE _px ON COMMIT DROP AS
SELECT symbol,
       (to_timestamp((e->>0)::bigint) AT TIME ZONE 'UTC')::date AS d,
       (e->>4)::double precision AS c
FROM trd_bars_deep, jsonb_array_elements(bars) e
WHERE asset_class = 'equity' AND (e->>4)::double precision > 0;

CREATE INDEX ON _px (symbol, d);

-- Per-symbol rolling statistics. A moving average is only defined once enough history exists, so ma200/ma50 are
-- NULL until 200/50 bars have accrued for that symbol and those NULLs are excluded from the fraction — a name with
-- 6 months of history is not counted in the 200dma breadth, which is correct, not missing.
CREATE TEMP TABLE _feat ON COMMIT DROP AS
SELECT symbol, d, c,
       CASE WHEN count(*) OVER w200 = 200 THEN avg(c) OVER w200 END AS ma200,
       CASE WHEN count(*) OVER w50  = 50  THEN avg(c) OVER w50  END AS ma50,
       CASE WHEN count(*) OVER w252 >= 200 THEN max(c) OVER w252 END AS hi252,
       CASE WHEN count(*) OVER w252 >= 200 THEN min(c) OVER w252 END AS lo252,
       lag(c) OVER (PARTITION BY symbol ORDER BY d) AS prev_c
FROM _px
WINDOW w200 AS (PARTITION BY symbol ORDER BY d ROWS 199 PRECEDING),
       w50  AS (PARTITION BY symbol ORDER BY d ROWS 49  PRECEDING),
       w252 AS (PARTITION BY symbol ORDER BY d ROWS 251 PRECEDING);

-- Aggregate to the market level, one row per date. A date needs a floor of names to be a breadth statistic at all
-- (THE BREADTH LAW: a thin cross-section is not a factor) — 50 names with a defined 200dma, else the day is omitted.
INSERT INTO trd_macro_series (series, d, v)
SELECT s.series, s.d, s.v FROM (
  SELECT 'breadth_pct_gt_200dma_xp' AS series, d,
         avg((c > ma200)::int)::double precision AS v, count(ma200) AS n
  FROM _feat WHERE ma200 IS NOT NULL GROUP BY d HAVING count(ma200) >= 50
  UNION ALL
  SELECT 'breadth_pct_gt_50dma_xp', d, avg((c > ma50)::int)::double precision, count(ma50)
  FROM _feat WHERE ma50 IS NOT NULL GROUP BY d HAVING count(ma50) >= 50
  UNION ALL
  SELECT 'breadth_adv_frac_xp', d,
         (sum((c > prev_c)::int)::double precision
           / NULLIF(sum((c > prev_c)::int) + sum((c < prev_c)::int), 0)), count(prev_c)
  FROM _feat WHERE prev_c IS NOT NULL GROUP BY d HAVING count(prev_c) >= 50
  UNION ALL
  SELECT 'breadth_pct_252d_high_xp', d, avg((c >= 0.98 * hi252)::int)::double precision, count(hi252)
  FROM _feat WHERE hi252 IS NOT NULL GROUP BY d HAVING count(hi252) >= 50
  UNION ALL
  SELECT 'breadth_pct_252d_low_xp', d, avg((c <= 1.02 * lo252)::int)::double precision, count(lo252)
  FROM _feat WHERE lo252 IS NOT NULL GROUP BY d HAVING count(lo252) >= 50
) s
ON CONFLICT (series, d) DO UPDATE SET v = EXCLUDED.v;

COMMIT;
