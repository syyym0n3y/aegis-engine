-- D-194/197: register bbfade_lo/BEAR (buy the lower 2σ Bollinger band while SPY<200MA) into forward paper as a
-- per-symbol basket. This is the augmentation program's one genuinely NEW, survivorship-CHECKED conditional edge
-- (D-197: edge GROWS +0.054→+0.091R t=5.73 on a battered/near-death universe; both-time-halves stable — the OPPOSITE
-- of the dip-buy survivorship mirage, because the 1R-capped 2×ATR stop neutralises the delisted-tail blow-up).
--
-- It is the LONG complement to rip-short's bull-regime short: one edge per regime. The setup carries entry:"band"
-- (Bollinger fade, D-194/197 detector path) + regime:"bear" — the tracker gates it on SPY<200MA per date and, being
-- a bear-regime long, it will fire ZERO trades in the current bull regime. That is CORRECT and intended: registered_at
-- starts the immutable forward clock NOW so the forward sample is legitimate the moment the bear regime arrives. No
-- borrow (long side); spread-only cost via fee_bps_side. $0, NO order path — virtual R on Yahoo, kill-switch gated.
insert into trd_forward (candidate, symbol, timeframe, direction, setup, fee_bps_side, yahoo_range, in_sample_evidence)
select 'bbfadelo-bear-1d-'||sym||'-v1', sym, '1d', 'long',
  '{"entry":"band","bandLen":20,"bandK":2,"rsiLen":14,"rsiThresh":70,"maLen":200,"atrLen":14,"stopAtr":2,"tpMult":3,"maxBars":20,"dir":1,"regime":"bear"}'::jsonb,
  5, '2y',
  '{"universe_evidence":"D-194 bbfade_lo/bear edge +0.078R t=3.69 n=7230; D-197 survivorship-checked: ROUGH universe +0.091R t=5.73, both-halves +","note":"bear-regime LONG; fires only SPY<200MA (0 fires in bull = intended); spread-only cost, no borrow"}'::jsonb
from unnest(array['SPY','QQQ','IWM','DIA','AAPL','NVDA','AMD','TSLA']) as sym
on conflict (candidate) do nothing;

insert into trd_forward_state (candidate) select candidate from trd_forward where candidate like 'bbfadelo-bear-1d-%' on conflict do nothing;
