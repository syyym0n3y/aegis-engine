-- 0097: close the hole in THE PRE-COMMITMENT LAW's immutability guarantee (D-631).
--
-- The original trigger (migration 0092) locked claim/competing/rule/kill_condition/registered_at, and blocked
-- rewriting `outcome` once set. It did NOT protect `outcome_note` — and outcome_note is where all the substance
-- lives. The outcome label is one word ("retracted"); the note is the actual finding, the numbers, and the reason.
--
-- So the guarantee as stated in CLAUDE.md — "an outcome once recorded cannot be rewritten, so a retraction can
-- never be softened into a win" — was FALSE in exactly the way that matters. A motivated author (including a future
-- session of me) could leave the label reading "retracted" while rewriting the note into something that reads as a
-- partial success. Nothing would raise, and no guard inspected it.
--
-- Demonstrated by breaking it: an UPDATE set D-624's note to the string 'softened' and Postgres accepted it,
-- permanently destroying text that could only be partially reconstructed from a query output captured earlier in
-- the same session. The four attacks recorded as verifying this table tested DELETE, claim, rule and outcome —
-- never the note.
--
-- After this migration outcome_note is APPEND-ONLY: it may be set once when null, and afterwards only EXTENDED.
-- Extension is allowed deliberately, because supersession and correction must remain possible; what is forbidden
-- is making earlier text disappear.
create or replace function public.trd_prereg_immutable()
returns trigger language plpgsql as $function$
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
  -- D-631: the note carries the finding. Once written it may only grow.
  if old.outcome_note is not null
     and (new.outcome_note is null or position(old.outcome_note in new.outcome_note) <> 1) then
    raise exception 'trd_prereg: outcome_note is append-only — the existing text must remain as a prefix (id=%). Append a supersession instead of rewriting.', old.id;
  end if;
  return new;
end $function$;
