-- 0048 — attribution QUALITY for the engagement gate. adj_r2 (adjusted R2, penalizes added forces — understanding must
-- survive the penalty, not accumulate regressors) + era_stability (min/max of per-era R2 — understood CONSISTENTLY across
-- cycles?) + n_factors. Feeds the folded gate: engage requires directional edge AND adj_r2×era_stability >= threshold.
alter table trd_attribution add column if not exists adj_r2 double precision;
alter table trd_attribution add column if not exists era_stability double precision;
alter table trd_attribution add column if not exists n_factors integer;
