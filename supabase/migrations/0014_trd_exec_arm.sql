-- D-192: arm flag for the DORMANT paper executor (trd-alpaca-paper-exec). Absent/false = executor does nothing.
-- Operator sets armed=true deliberately to enable PAPER order placement (still kill-switch + SPY>200MA regime +
-- liquid/easy-to-borrow + concurrent-heat gated). No real money; no auto-execution by Claude.
create table if not exists trd_exec_arm (
  id      text primary key,
  armed   boolean not null default false,
  note    text,
  updated_at timestamptz not null default now()
);
insert into trd_exec_arm (id, armed, note) values ('paper', false, 'DORMANT — set armed=true to enable trd-alpaca-paper-exec (paper orders only, all guards apply)')
on conflict (id) do nothing;
