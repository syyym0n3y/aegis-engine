-- 0091 (D-571): forward decision registry — promote/kill rules written before the data exists. Append-only.
create table if not exists trd_forward_rules (
  id text primary key, spec text not null, clock_started date not null, horizon_desc text not null,
  promote_if text not null, kill_if text not null, inconclusive_if text not null, written_at timestamptz default now());
create or replace function trd_block_fwd_rules() returns trigger as $$
begin raise exception 'append-only table trd_forward_rules: UPDATE/DELETE forbidden (trd doctrine)'; end;
$$ language plpgsql;
drop trigger if exists trg_fwd_rules_immutable on trd_forward_rules;
create trigger trg_fwd_rules_immutable before update or delete on trd_forward_rules
  for each row execute function trd_block_fwd_rules();
notify pgrst, 'reload schema';
