-- D-233: durable state for the pairs/stat-arb executor (which pair is open, its direction, hedge β, entry z/date,
-- and per-leg qty) so exits can be managed on the computed SPREAD z-score (Alpaca has no native stop on a spread).
-- Rows persist; `open` flips false on exit. Survives daemon restarts (invariant: durable state).
create table if not exists trd_pairs_pos (
  pair       text primary key,          -- "KO/PEP"
  leg_a      text not null,
  leg_b      text not null,
  dir        int  not null,             -- +1 = long spread (long A / short B); -1 = short spread (short A / long B)
  beta       double precision not null,
  entry_z    double precision not null,
  qty_a      double precision not null,
  qty_b      double precision not null,
  open       boolean not null default true,
  entry_date timestamptz not null default now(),
  exit_date  timestamptz,
  exit_z     double precision,
  exit_reason text
);
alter table trd_pairs_pos enable row level security;
create policy trd_pairs_pos_svc on trd_pairs_pos for all using (true) with check (true);
