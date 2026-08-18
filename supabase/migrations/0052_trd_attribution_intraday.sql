-- 0052 — per-instrument INTRADAY attribution ladder (min1/min5/min60 R2) alongside the daily/weekly/monthly per_tf.
alter table trd_attribution add column if not exists per_tf_intraday jsonb;
