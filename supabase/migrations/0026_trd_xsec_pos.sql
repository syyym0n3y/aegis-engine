-- D-248: durable state for the cross-sectional 12-1 momentum executor (monthly long-short quintile basket).
-- Exit = monthly rebalance, not a per-name signal. Self-reconciling.
create table if not exists trd_xsec_pos (
  sym text primary key, side text not null, mom double precision,
  open boolean not null default true, entry_date timestamptz not null default now(), exit_date timestamptz
);
alter table trd_xsec_pos enable row level security;
create policy trd_xsec_pos_svc on trd_xsec_pos for all using (true) with check (true);
