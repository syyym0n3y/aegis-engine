-- D-278: broad ORB-follow scanner cron — deploys the validated edge across ~50 liquid ETFs every 30m in RTH.
-- Collapses the 30-trade gate from weeks to ~1 day and applies the edge at scale for real paper P&L. Armed-gated.
-- select cron.schedule('trd_orbfollow_scanner_30m','*/30 14-20 * * 1-5', $$ select net.http_post(
--   url:='https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-orbfollow-scanner',
--   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(_cc_cron_bearer(),'')),
--   body:='{}'::jsonb, timeout_milliseconds:=150000) $$);
select 1;
