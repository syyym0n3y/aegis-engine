-- D-272: trd_lineage — the provenance ledger. One row per lead/hypothesis through the falsification engine:
-- what was proposed, how it was tested, the decisive metric, the verdict, what killed or validated it, the
-- DECISIONS.md trail, and lineage forks (parent/superseded_by). Makes "track the entire development" queryable.
-- CONVENTION: every new edge decision appends/updates a row here alongside its DECISIONS.md entry.
create table if not exists trd_lineage (
  id text primary key,
  name text not null,
  family text,                 -- mean-reversion | momentum | stat-arb | vol-carry | breakout
  hypothesis text,
  test_method text,
  key_metric text,
  verdict text,
  status text not null,        -- validated | near-miss | rejected | demoted | unproven | data-blocked
  regime_gate text,
  killed_by text,
  parent text,                 -- lineage fork (this lead descends from parent)
  superseded_by text,
  decision_refs text[],
  resolved_at date,
  updated_at timestamptz not null default now()
);
alter table trd_lineage enable row level security;
create policy trd_lineage_read on trd_lineage for select using (true);

create or replace view trd_lineage_roster as
  select status, id, name, family, key_metric, verdict, regime_gate, decision_refs
  from trd_lineage
  order by case status when 'validated' then 1 when 'near-miss' then 2 when 'unproven' then 3
    when 'data-blocked' then 4 when 'demoted' then 5 when 'rejected' then 6 else 7 end, id;
