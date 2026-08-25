-- 0092_prereg.sql (D-597) — THE MECHANISM LAW's substrate.
--
-- WHY THIS EXISTS. The one limit in the self-assessment that today's record fully confirmed is that I generate
-- plausible mechanisms faster than I verify them: seven mechanism stories proposed on 2026-08-25, seven dead — and
-- D-590 was worse than a failure, it was a false WIN reported to the operator and retracted only after decomposing
-- my own pooled number. The countermeasure that demonstrably worked was writing the decision rule BEFORE the run.
-- Every retraction from D-587 onward was automatic rather than negotiated.
--
-- But those pre-registrations were written to /tmp/prereg-*.txt. Ephemeral files that the author can ignore, lose,
-- or silently rewrite are not a control — they are a habit, and habits are exactly what this programme has proven
-- do not survive contact with a result someone wants. THE PRE-COMMITMENT LAW (D-571) already established this for
-- forward tests; this extends the same machinery to ANALYSIS claims, which is where the D-590 failure actually lived.
--
-- The table is append-only and immutable by trigger: once a rule exists you cannot edit it when the numbers arrive.
create table if not exists trd_prereg (
  id            text primary key,               -- stable key, e.g. 'D-587-liquidity-band'
  claim         text not null,                  -- what is being tested, in one sentence
  competing     text not null,                  -- the explanation that would ALSO produce a positive result
  rule          text not null,                  -- the numeric two-sided decision rule, written before the data
  kill_condition text not null,                 -- what result RETRACTS the claim. Must be non-empty: a rule with no
                                                -- way to lose is not a rule.
  registered_at timestamptz not null default now(),
  outcome       text,                           -- filled in AFTER: 'confirmed' | 'retracted' | 'inconclusive'
  outcome_note  text
);

-- Immutability: the claim, its competing explanation, the rule and the kill condition can never be edited. Only the
-- OUTCOME columns may be written once, and never rewritten — so a retraction cannot later be softened into a win.
create or replace function trd_prereg_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'trd_prereg is append-only: a pre-registration cannot be deleted (id=%)', old.id;
  end if;
  if new.claim is distinct from old.claim
     or new.competing is distinct from old.competing
     or new.rule is distinct from old.rule
     or new.kill_condition is distinct from old.kill_condition
     or new.registered_at is distinct from old.registered_at then
    raise exception 'trd_prereg: claim/competing/rule/kill_condition/registered_at are immutable (id=%)', old.id;
  end if;
  if old.outcome is not null and new.outcome is distinct from old.outcome then
    raise exception 'trd_prereg: outcome already recorded as "%" and cannot be rewritten (id=%)', old.outcome, old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_prereg_immutable on trd_prereg;
create trigger trg_prereg_immutable before update or delete on trd_prereg
  for each row execute function trd_prereg_immutable();
