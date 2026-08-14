-- D-311 guard. A factory survivor (trd_edge_queue.passes=true) MUST have a scorecard row, OR a
-- trd_stage2_results row. Stage-2 reads its candidate set from trd_edge_scorecard, so absence from BOTH means
-- the promotion was never persisted and the candidate was never validated. The pre-fix factory committed
-- passes=true per-page but flushed the scorecard/dollar/lineage promotion at end-of-request behind a swallowed
-- .catch(() => {}); any failure or CPU-kill in between stranded the survivor. Measured backlog at fix time:
-- 1,005 stranded rows (vs_random_t up to 11.69), all reset to pending for atomic re-scoring.
--
-- Standing invariant: orphaned_after_fix must stay 0. The historical backlog reads BACKLOG-rescoring and drains
-- to CLEAN as the cron re-scores the reset rows through the fixed (scorecard-leads) write path.
-- Applied to remote via MCP as 0017_trd_factory_promo_integrity; committed here for reproducibility (Hard Rule 6).
create or replace view trd_factory_promo_integrity_v as
with orphans as (
  select q.spec_key, q.market, q.run_at, q.vs_random_t
  from trd_edge_queue q
  where q.passes = true
    and not exists (select 1 from trd_edge_scorecard s where s.edge = 'fac:'||q.spec_key||'@'||q.market)
    and not exists (select 1 from trd_stage2_results r where r.edge = 'fac:'||q.spec_key||'@'||q.market)
)
select
  count(*)                                                             as orphaned_total,
  count(*) filter (where run_at > timestamptz '2026-08-14 15:00:00+00')  as orphaned_after_fix,
  count(*) filter (where run_at <= timestamptz '2026-08-14 15:00:00+00') as orphaned_before_fix,
  max(vs_random_t)                                                    as worst_orphan_t,
  case when count(*) filter (where run_at > timestamptz '2026-08-14 15:00:00+00') > 0
       then 'REGRESSION-promo-lost-after-fix'
       when count(*) > 0 then 'BACKLOG-rescoring'
       else 'CLEAN' end                                               as verdict
from orphans;
