-- 0093_forward_marks.sql (D-613) — the missing half of the PRE-COMMITMENT LAW.
--
-- D-571 established that a forward test without a written promote/kill rule is not a test but an option to
-- rationalise later, and built trd_forward_rules with an immutability trigger. Five clocks now run against it.
-- NOTHING SCORES THEM. `forward-rules-guard.ts` verifies a rule is two-sided and numeric; it never asks what the
-- data has since done. A registered rule that is never evaluated is decorative — it produces the FEELING of
-- discipline while leaving the same discretion in place, because whoever reads the numbers years later still gets
-- to decide what they meant.
--
-- This table is where the clock's readings accumulate: append-only marks, one per rule per scoring run, so the
-- forward record is a time series that existed BEFORE anyone knew how it would end.
create table if not exists trd_forward_marks (
  id            bigserial primary key,
  rule_id       text not null references trd_forward_rules(id),
  marked_at     timestamptz not null default now(),
  elapsed_days  integer not null,
  metric_name   text not null,          -- what was measured, e.g. 'portfolio_t'
  metric_value  double precision,       -- null when not yet computable, with why in note
  n_obs         integer,
  note          text,
  matured       boolean not null default false,   -- has the pre-registered horizon been reached
  verdict       text                    -- 'promote' | 'kill' | 'inconclusive' | null while pending
);
create index if not exists trd_forward_marks_rule_idx on trd_forward_marks (rule_id, marked_at desc);

-- Marks are observations, not opinions: they may never be edited or deleted, exactly like the rules they score.
create or replace function trd_forward_marks_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'trd_forward_marks is append-only: a forward reading cannot be % (rule=%)',
    lower(tg_op), coalesce(old.rule_id, '?');
end $$;

drop trigger if exists trg_forward_marks_immutable on trd_forward_marks;
create trigger trg_forward_marks_immutable before update or delete on trd_forward_marks
  for each row execute function trd_forward_marks_immutable();
