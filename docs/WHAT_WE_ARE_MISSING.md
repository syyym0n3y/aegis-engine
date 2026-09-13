# WHAT WE ARE MISSING — the deep answer, written after the adaptive programme ran at full scale (D-861, 2026-09-13)

> Operator: "analyse what we are missing deeply … build an automated bot … an algorithm that stays favourable in all
> conditions across all instruments … a lot more trials … when a set-up doesn't work, adapt it with another set-up
> that won in that category." All of that was done, inside the laws, and this page is what it showed.

## What was done, in numbers
| | gold (D-859) | gold walk-forward (D-859b) | 24-instrument panel (D-861) |
|---|---|---|---|
| set-up cells (7 families × 6 exits) | 132 | 132 | 132 |
| categories | 60 | 9 | 21 |
| counted fits | 5,976 | 4,645 | 15,684 |
| OOS net per trade | −1.0bp | −2.7bp | **−6.6bp** |
| OOS years positive | — | 4/8 | 1/8 |
| **gross (before cost)** | +5.0bp | ~+3bp | **crypto +0.4 · fx −0.9 · idx +1.8bp** |

**The gross is zero.** That is the measurement. Adaptive category-conditioned technical set-ups on hourly bars earn
nothing before cost across 24 liquid instruments, and any retail cost turns zero into a loss whose significance is
manufactured by the flat cost (D-661). The paper bot (`scripts/gold-paper-bot.ts`) exists and runs hourly with no
broker path; it will score whatever the market gives its one clock.

## What is genuinely missing — not "more of the same"
1. **A gross edge in price-only hourly rules does not appear to exist at this resolution.** Three designs and 26,305
   fits say so with coverage stated (24 instruments, 2016–2026, first-hit events). More set-ups of the same kind is
   the neighbourhood search D-848 measured at 64% of everything this programme has ever done.
2. **Execution-side money has never been measured, only assumed away.** THE EXECUTION LAW says a maker fill is a
   hypothesis until the *fill-conditional* return is measured; D-447 measured it once and it reversed the sign. Every
   hourly result here is priced at taker. A maker/limit engine with measured fills is an open question, not a null.
3. **Events are not in the data.** Scheduled releases (CPI, NFP, FOMC, inventories), listings/delistings, funding
   settlements as *timestamps* — the panel has funding and OI for perps but no macro calendar. A calendar is free.
4. **Cross-instrument lead–lag at hourly resolution has not been asked** — the map has D1/D2 cells for every
   instrument on its own and nothing that conditions one instrument on another's move.
5. **The placeable classes are the weak ones.** FX and index CFDs at 4–6bp show gross ≈ 0; the only class with any
   gross is crypto perps at 9bp, which a UK retail account cannot hold. Access, not signal, is the binding constraint
   (INSTRUMENT LAW).
6. **The money that is measured real is per head, not per pound** (D-834/851): sign-up subsidies £150–£400 once,
   odd-lot tenders gated on one broker yes/no. Nothing on the price side approaches it at this account's scale.

## What this page does not say
It does not say markets are efficient; it says *these questions*, asked at full scale, returned zero gross. The
search-space map (`docs/SEARCH_SPACE.md`) is the list of what has and has not been asked; items 2–4 above are the
cells worth a fourth design, and each needs data the panel does not yet hold.
