-- 0049 — per-cluster attribution. Different instrument clusters need different mechanism-backed force sets (equities on
-- market/rates/vol/commodities/size; FX on short-rate/long-rate/risk-sentiment/gold/oil — the real drivers, not a dollar
-- proxy). cluster names which force set explained the instrument.
alter table trd_attribution add column if not exists cluster text default 'equity';
