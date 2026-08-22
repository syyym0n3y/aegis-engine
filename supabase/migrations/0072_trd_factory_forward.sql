-- 0072 (D-474) — FORWARD CONFIRMATION for factory leads: the trial-free test. A lead registered here is scored only on
-- months AFTER registered_at; the deflation N for forward evidence is the count of REGISTERED leads (a handful), not the
-- program's 1.53M-trial history. This is the only path left from t~3.5 to promotable.
create table if not exists trd_factory_forward (
  spec_key      text primary key references trd_factory(spec_key),
  registered_at date not null default current_date,
  note          text
);
create table if not exists trd_factory_forward_returns (
  spec_key   text not null references trd_factory_forward(spec_key),
  month      date not null,             -- month scored (its last day)
  ls_return  double precision not null, -- realized long-short net return for that month
  scored_at  timestamptz not null default now(),
  primary key (spec_key, month)
);
alter table trd_factory_forward enable row level security;
alter table trd_factory_forward_returns enable row level security;
drop policy if exists f1 on trd_factory_forward; create policy f1 on trd_factory_forward for select to authenticated using (true);
drop policy if exists f2 on trd_factory_forward_returns; create policy f2 on trd_factory_forward_returns for select to authenticated using (true);
