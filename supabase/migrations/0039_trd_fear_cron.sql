-- D-277: forward-tracker for the consolidated VRP/fear candidate (trd-fear-exec). NOT a validated edge — deployed
-- to paper to accumulate INDEPENDENT FORWARD trades toward an honest verdict (in-sample t=2.23 clears the naive bar
-- but not Bonferroni/DSR). Trades IVV (distinct from orbfollow's SPY to avoid Alpaca position-merge). Daily, armed.
-- select cron.schedule('trd_fear_daily','40 14 * * 1-5', $$ select net.http_post(
--   url:='https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-fear-exec',
--   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(_cc_cron_bearer(),'')),
--   body:='{}'::jsonb, timeout_milliseconds:=120000) $$);
select 1;
