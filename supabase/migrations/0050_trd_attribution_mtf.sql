-- 0050 — per-cluster + multi-timeframe attribution. per_tf holds the same force model's R2/adj-R2 at daily/weekly/monthly
-- (non-overlapping blocks). The daily lens understates understanding when daily noise hides a strong relationship (e.g.
-- gold: daily R2 0.07 → weekly 0.26). Understanding is measured at the timeframe where the mechanism is clearest.
-- Finer than daily (hourly→minute) over history needs intraday depth → the dormant Databento key (keyless stops at daily).
alter table trd_attribution add column if not exists cluster text default 'equity';
alter table trd_attribution add column if not exists per_tf jsonb;
