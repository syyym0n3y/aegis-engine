-- D-262: cron for the ORB-follow ETF-proxy executor (edge #7). Every 30m across RTH (14:00–20:30 UTC weekdays,
-- covers 10:30–15:30 ET across DST). The fn self-guards timing/dedup and only ACTS when trd_exec_arm='paper' is
-- armed — so this schedule is DORMANT until the operator arms. Applied via cron.schedule (jobid 37).
-- select cron.schedule('trd_orbfollow_30m','*/30 14-20 * * 1-5', $$ select net.http_post(
--   url:='https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-orbfollow-exec',
--   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(_cc_cron_bearer(),'')),
--   body:='{}'::jsonb, timeout_milliseconds:=120000) $$);
select 1;
