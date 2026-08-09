-- D-223: nightly full-universe rip-short scan. A cursor-driven chunker (trd-ripshort-scan fn) walks the whole SEC US
-- universe (~9,850) after US close, in 200-name chunks, writing names currently firing rip-short (RSI>70 & close<200MA
-- in bull regime), flagged actionable only where the edge lives (liquid large-caps, D-220). Prunable telemetry.
create table if not exists trd_scan_cursor (
  id text primary key, scan_date date, idx int not null default 0, total int not null default 0,
  firing_total int not null default 0, status text, updated_at timestamptz not null default now()
);
create table if not exists trd_ripshort_scan (
  id uuid primary key default gen_random_uuid(),
  scan_date date not null, ticker text not null, px numeric, tier text, rsi numeric, ma200 numeric,
  actionable boolean not null default false, created_at timestamptz not null default now(),
  unique (scan_date, ticker)
);
create index if not exists idx_ripshort_scan_date on trd_ripshort_scan(scan_date desc, actionable desc);

-- pg_cron: applied via cron.schedule('trd_ripshort_scan_nightly', '*/3 23,0,1,2 * * *', ...) — jobid 26. Fires the
-- scanner every 3 min during 23:00-02:59 UTC (after US close); the fn's session-date logic completes one full-universe
-- pass per night (crossing midnight without resetting) then idles. Read: select * from trd_ripshort_scan
-- where scan_date=(select max(scan_date) from trd_ripshort_scan) and actionable order by rsi desc;
