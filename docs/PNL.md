# P&L — owned node only (no rented infra, no LLM)

> Generated 2026-10-14T19:34:57.479Z by `pnl-report.ts` from the local database. The predecessor routine
> read the rented CC oversight project, which is dead (HTTP 000). Nothing here depends on any subscription.

## REAL capital

**No real fills on record.** 0 rows in `trd_manual_trades`. Realized P&L: **$0.00** — because nothing has been placed, not because something lost.
Kill switches: `paper`=armed, `micro`=armed. Arming them does not place anything; fills are the operator's, by invariant.

## PAPER book — `fwd-distress-ivol-blend-5` (DORMANT, $0 at risk)

- marks on record: **61**, latest **2026-10-14** (elapsed 28d)
- clock: **not yet computable**

> This is a PAPER number on a book nobody has funded. It is not proof the edge works, and a forward Sharpe on
> a few dozen observations moves a long way as n grows — treat the trend, not the level. Promote/kill floors
> live in `trd_forward_rules` and were written before this data existed.

## Regime these numbers were produced in

| series | latest | as of |
|---|---|---|
| spy_vs200_pct | 7.967 | 2026-10-13 |
| spy_rvol20_pct | 9.5469 | 2026-10-13 |
| spy_dd1y_pct | -0.1386 | 2026-10-13 |
| breadth_above50_pct | 29.4521 | 2026-10-12 |

## Wealth ledger (ballast)

- **Empty** (0 rows). The certain money (deposits × wrapper) is still unlogged — named at D-823 as the programme's real failure, and still true.

## Dependencies of this report

- owned Postgres `aegis-db` (localhost) · owned `ballast-db` (localhost)
- **no** rented Supabase, **no** LLM call, **no** scheduled Claude session, **no** paid vendor.
