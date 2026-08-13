-- D-279: config-driven position sizing + pre-registered tier ladder. Scaling = update the row (no redeploy).
-- Tiers unlock ONLY on met forward-generalization criteria (see the criteria column). Real money stays operator-gated.
create table if not exists trd_exec_config (
  edge text primary key, size_notional double precision not null, tier int not null default 0,
  criteria text, updated_at timestamptz not null default now()
);
alter table trd_exec_config enable row level security;
create policy trd_exec_config_read on trd_exec_config for select using (true);
-- seed: orbfollow T0 @ 2% notional (conservative first broad deploy). Ladder in the criteria column.
