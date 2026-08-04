-- D-106: latest portfolio-risk snapshot of the live account, written by trd-risk-monitor (polled hourly
-- via pg_cron). Read-only research surface; the monitor never places or closes orders.
create table if not exists public.trd_risk_state (
  id text primary key,
  snapshot jsonb not null default '{}'::jsonb,
  verdict text,
  prob_ruin numeric,
  gross_exposure numeric,
  effective_bets numeric,
  alert boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.trd_risk_state is 'D-106: live-account portfolio-risk snapshot from trd-risk-monitor. No orders.';

-- hourly poll of the live book (free, pg_cron):
-- select cron.schedule('trd-risk-monitor', '0 * * * *',
--   $$ select net.http_post(url:='https://<project>.functions.supabase.co/functions/v1/trd-risk-monitor') $$);
