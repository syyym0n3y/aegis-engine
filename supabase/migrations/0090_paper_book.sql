-- 0090 (D-521): paper-rung ledger for the frozen P2 managed book. $0 at risk; marks-to-month on the same data the
-- spec was frozen on, with the vol-management weight computed point-in-time and the kill-switch honored.
create table if not exists trd_paper_book (
  mo         text primary key,           -- YYYY-MM being marked
  book_ret   double precision not null,  -- P1 core month return (frozen construction)
  vm_weight  double precision not null,  -- Moreira-Muir weight from trailing 6m (0 if kill-switch tripped)
  managed_ret double precision not null,
  equity     double precision not null,  -- cumulative on $100k paper notional
  marked_at  timestamptz default now()
);
notify pgrst, 'reload schema';
