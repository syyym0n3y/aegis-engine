-- D-171: forward PAPER tracking for RSI mean-reversion survivors of the D-170 full sweep.
-- General by design: the registry holds ANY (symbol, timeframe, direction) so "all other instruments and
-- timeframes are considered" is a one-row insert, not a code change. Seeded with the ONE survivor
-- (BTC/5m/short) plus its two near-miss controls (ETH/5m/short, BTC/5m/long) so we watch whether they too
-- hold out of sample. $0, paper-only, NO order path exists — this is Stage-1 evidence, not execution.

-- REGISTRY: one row per pre-registered forward hypothesis. registered_at is the immutable clock start;
-- only trades entered strictly after it count as the un-deflated forward trial.
create table if not exists trd_forward (
  candidate        text primary key,
  symbol           text not null,             -- Yahoo symbol (edge-runtime-reachable feed; Binance geo-blocks datacenters)
  timeframe        text not null,             -- '5m','15m',...
  direction        text not null check (direction in ('long','short')),
  setup            jsonb not null,            -- {rsiLen,rsiThresh,maLen,atrLen,stopAtr,tpMult,maxBars,dir}
  fee_bps_side     numeric not null default 5,-- survival gate from D-170: real only at <=5bp/side
  yahoo_range      text not null default '60d',
  in_sample_evidence jsonb,                   -- {n,grossR,netR5bp,tFull,h1,h2,oos} from D-170
  baseline_oos_net_r numeric,
  registered_at    timestamptz not null default now(),
  active           boolean not null default true,
  updated_at       timestamptz not null default now()
);
comment on table trd_forward is 'D-171: pre-registered RSI mean-reversion forward-paper hypotheses. registered_at = immutable forward clock.';

-- APPEND-ONLY evidence ledger: every resolved paper trade. Idempotent on (candidate, entry_ts).
create table if not exists trd_forward_trade (
  id           uuid primary key default gen_random_uuid(),
  candidate    text not null references trd_forward(candidate),
  entry_ts     timestamptz not null,
  exit_ts      timestamptz not null,
  side         text not null,
  entry        numeric not null,
  stop         numeric not null,
  target       numeric not null,
  exit_price   numeric not null,
  gross_r      numeric not null,
  cost_r       numeric not null,
  net_r        numeric not null,
  outcome      text not null check (outcome in ('target','stop','timeout')),
  recorded_at  timestamptz not null default now(),
  unique (candidate, entry_ts)
);
comment on table trd_forward_trade is 'D-171: append-only forward paper fills. UPDATE/DELETE blocked; re-runs are no-ops via the unique key.';

create or replace function trd_forward_trade_immutable() returns trigger language plpgsql as $$
begin raise exception 'trd_forward_trade is append-only (attempted %)', tg_op; end $$;
drop trigger if exists trg_forward_trade_no_update on trd_forward_trade;
drop trigger if exists trg_forward_trade_no_delete on trd_forward_trade;
create trigger trg_forward_trade_no_update before update on trd_forward_trade for each row execute function trd_forward_trade_immutable();
create trigger trg_forward_trade_no_delete before delete on trd_forward_trade for each row execute function trd_forward_trade_immutable();

-- ROLLUP: current forward verdict per candidate (mutable — a running summary, not evidence).
create table if not exists trd_forward_state (
  candidate       text primary key references trd_forward(candidate),
  fwd_n           int not null default 0,
  fwd_wins        int not null default 0,
  fwd_net_r_total numeric not null default 0,
  fwd_net_r_mean  numeric,
  last_entry_ts   timestamptz,
  verdict         text,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_forward_trade_candidate on trd_forward_trade(candidate, entry_ts);

-- SEED: the D-170 survivor + two near-miss controls. registered_at defaults to now() → the clock starts on apply.
insert into trd_forward (candidate, symbol, timeframe, direction, setup, fee_bps_side, in_sample_evidence, baseline_oos_net_r) values
  ('btc-5m-short-v1','BTC-USD','5m','short',
   '{"rsiLen":14,"rsiThresh":70,"maLen":200,"atrLen":14,"stopAtr":2,"tpMult":3,"maxBars":144,"dir":-1}'::jsonb,
   5, '{"n":1182,"grossR":0.471,"netR5bp":0.143,"tFull":8.07,"h1":"+0.60/t5.9","h2":"+0.27/t3.6","oos":"+0.29/t4.7","source":"Binance 1m→5m 8.9y"}'::jsonb, 0.290),
  ('eth-5m-short-v1','ETH-USD','5m','short',
   '{"rsiLen":14,"rsiThresh":70,"maLen":200,"atrLen":14,"stopAtr":2,"tpMult":3,"maxBars":144,"dir":-1}'::jsonb,
   5, '{"n":1584,"note":"near-miss control: full t=3.86 but H2 t=1.9 (one half noise) — watched to see if forward holds"}'::jsonb, null),
  ('btc-5m-long-v1','BTC-USD','5m','long',
   '{"rsiLen":14,"rsiThresh":70,"lowThresh":30,"maLen":200,"atrLen":14,"stopAtr":2,"tpMult":3,"maxBars":144,"dir":1}'::jsonb,
   5, '{"n":1535,"note":"near-miss control: full t=2.82, fails deflation (H2 flips negative) — watched as a falsification check"}'::jsonb, null)
on conflict (candidate) do nothing;

insert into trd_forward_state (candidate) select candidate from trd_forward on conflict (candidate) do nothing;

-- D-172: 5R-target variant of the survivor, registered to forward-test 3R vs 5R head-to-head (exit study
-- found 5R lifts in-sample net edge +0.145R->+0.212R; the live forward test decides which target holds).
insert into trd_forward (candidate, symbol, timeframe, direction, setup, fee_bps_side, in_sample_evidence) values
  ('btc-5m-short-5R-v1','BTC-USD','5m','short',
   '{"rsiLen":14,"rsiThresh":70,"maLen":200,"atrLen":14,"stopAtr":2,"tpMult":5,"maxBars":144,"dir":-1}'::jsonb,
   5, '{"n":1182,"netR5bp":0.212,"vsRandT":6.33,"totalR":250,"note":"D-172 exit study"}'::jsonb)
on conflict (candidate) do nothing;
insert into trd_forward_state (candidate) values ('btc-5m-short-5R-v1') on conflict do nothing;

-- D-182: rip-short DAILY equities (D-179 universe survivor, t=7.23) registered to forward paper as a per-symbol
-- basket (the cross-sectional edge decomposed into single-symbol legs so the (candidate,entry_ts) ledger dedup
-- holds). Tracker charges spread only (fee_bps_side=10 as a spread+partial-borrow proxy); it does NOT model
-- per-day borrow, so forward net is OPTIMISTIC vs the D-179 borrow-charged +0.064R. dir=-1, RSI>70 & <200MA.
insert into trd_forward (candidate, symbol, timeframe, direction, setup, fee_bps_side, yahoo_range, in_sample_evidence)
select 'ripshort-1d-'||sym||'-v1', sym, '1d', 'short',
  '{"rsiLen":14,"rsiThresh":70,"maLen":200,"atrLen":14,"stopAtr":2,"tpMult":3,"maxBars":20,"dir":-1}'::jsonb,
  10, '2y',
  '{"universe_evidence":"D-179 rip-short daily: edge +0.316R vs random, t=7.23, H1 5.49 H2 4.43","note":"per-symbol leg; spread-only cost, borrow not modeled -> optimistic vs D-179"}'::jsonb
from unnest(array['SPY','QQQ','IWM','XLE','XLF','SMH','AAPL','NVDA','TSLA','AMD']) as sym
on conflict (candidate) do nothing;
insert into trd_forward_state (candidate) select candidate from trd_forward where candidate like 'ripshort-1d-%' on conflict do nothing;
