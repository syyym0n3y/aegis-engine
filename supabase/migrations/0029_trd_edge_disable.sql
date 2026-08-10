-- D-252: per-edge disable control (risk mitigation). Executor skips if its edge is disabled here, independent of the
-- shared paper-arm. Lets a single failing edge be paused without disarming the fleet.
create table if not exists trd_edge_disable (
  edge text primary key, disabled boolean not null default true, reason text, set_at timestamptz default now()
);
alter table trd_edge_disable enable row level security;
create policy trd_edge_disable_svc on trd_edge_disable for all using (true) with check (true);
