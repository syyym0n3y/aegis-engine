-- 0043 (D-314) — trd_cron_health_v: derive the job→function map from cron.job.command instead of a
-- hand-maintained VALUES list. Before this, only 6 of 30 trd_* crons had a completion probe and the
-- other 24 reported 'dispatch-only' forever: pg_cron said "dispatched, succeeded" while the function
-- itself could have 500'd on every run and the health view would never have said so. The 22 distinct
-- edge functions behind those jobs now each write a trd_beat() heartbeat (status + response snippet)
-- from a SERVE() wrapper around their handler, so completion is observed, not assumed.
--
-- Deriving the map by regex means a NEW trd_* cron is covered the moment it is created — the previous
-- hardcoded map was itself the reason the gap existed and would silently reopen on the next cron added.
--
-- Known limitation (stated, not hidden): the heartbeat table is keyed by FUNCTION, so several jobs
-- hitting the same function share one heartbeat row — trd_orbfollow_eod_edt / _est / _scanner_30m all
-- map to trd-orbfollow-scanner. Their verdict therefore proves "that function completed recently",
-- not "this particular schedule's invocation completed". Per-job attribution would need the dispatch
-- side to pass its jobname through; that is deliberately NOT done here because rewriting 30 live cron
-- commands risks the dispatch path itself, which is worse than the residual ambiguity.

create or replace view trd_cron_health_v as
with disp as (
  select j.jobname,
         j.active,
         max(jr.start_time) as last_dispatch,
         (array_agg(jr.status order by jr.start_time desc))[1] as last_status,
         count(*) filter (where jr.status = 'failed' and jr.start_time > now() - interval '6 hours') as fails_6h
  from cron.job j
       left join cron.job_run_details jr on jr.jobid = j.jobid
  where j.jobname like 'trd%'
  group by j.jobname, j.active
), map as (
  -- auto-derived: every trd_* cron posts to .../functions/v1/<fn>[?query]
  select j.jobname, substring(j.command from 'functions/v1/([a-zA-Z0-9_-]+)') as fn
  from cron.job j
  where j.jobname like 'trd%'
), eng (jobname, last_write) as (
  -- engine-table fallback for the two fan-out jobs whose completion is proven by their own output
  values ('trd_edge_factory_par_1m'::text, (select max(run_at) from trd_edge_queue)),
         ('trd_edge_stage2_3m'::text,      (select max(run_at) from trd_stage2_results))
)
select d.jobname,
       d.active,
       d.last_status,
       d.fails_6h,
       round(extract(epoch from now() - d.last_dispatch) / 60::numeric, 1) as dispatch_age_min,
       coalesce(hb.last_run, eng.last_write) as last_completion,
       round(extract(epoch from now() - coalesce(hb.last_run, eng.last_write)) / 60::numeric, 1) as completion_age_min,
       hb.last_outcome,
       case
         when d.last_status = 'failed' or d.fails_6h > 0 then 'DISPATCH-FAILED'
         when coalesce(hb.last_run, eng.last_write) is null then 'dispatch-only (no completion probe yet)'
         when coalesce(hb.last_run, eng.last_write) >= (d.last_dispatch - interval '5 minutes') then 'VERIFIED-COMPLETING'
         else 'SILENT-FAIL-SUSPECT (dispatched, completion stale)'
       end as verdict
from disp d
     left join map on map.jobname = d.jobname
     left join trd_cron_heartbeat hb on hb.fn = map.fn
     left join eng on eng.jobname = d.jobname
order by d.jobname;
