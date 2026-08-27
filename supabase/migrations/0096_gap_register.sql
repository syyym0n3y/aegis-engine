-- 0096_gap_register.sql (W2) — the gap register, made queryable rather than prose.
--
-- Week 2's rule: every gap is either FILLED or RECORDED WITH THE VERDICT IT BLOCKS. A gap list that lives only in a
-- document drifts out of date silently and cannot be checked by a guard. This table is the machine-readable form, so
-- "what are we currently unable to test, and what does that prevent us concluding" is a query rather than a memory.
create table if not exists trd_gap_register (
  id          text primary key,
  dataset     text not null,
  status      text not null,          -- filled | blocked-credential | blocked-paid | structural | unfetched
  blocker     text,                   -- what specifically stands in the way
  blocks      text not null,          -- the VERDICT this gap currently prevents — the point of the register
  proxy_used  text,                   -- what stands in for it today, and what that proxy contaminates
  actionable_by text not null,        -- 'operator' | 'engine' | 'nobody'
  recorded_at timestamptz not null default now()
);
