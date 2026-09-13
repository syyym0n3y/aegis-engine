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

## Update 2026-09-13 evening — the big-picture pass (D-863–872)
Trend-following across 110 assets reproduces the literature (IS 0.87) and survives OOS at 0.62 but loses to a long basket;
carry and value are dead; trend is crisis alpha. The holdable line is long-only trend-timed ISA ETFs → class risk parity
→ VIX overlay: **Sharpe 0.62 → 0.76 → 0.83, drawdown −11% → −7% → −5%**, the best measured. Tenfold: ~12–13 years at 20% vol.
Spot crypto timed: 0.69 with −6% vs a hold basket that made nothing. `docs/RETAIL_PLAYBOOK.md` is the synthesis.

## Update 2026-09-13 late — where the day ended
The holdable line ended as a PAIR on an immutable forward clock: the timed class-parity ISA basket with VIX overlay (0.83 / −5%)
and the timed spot-crypto basket, survivor-free leg (0.60 / −6%), at risk parity: **Sharpe 1.29 on 2020–26, 0.90 without the
2020–21 crypto bull, robust across 36 parameter cells, positive in all seven years; at 20% vol ~26%/yr, −33%, 9.7 years to 10×.**
Tenfold inside a decade is now arithmetic on one book, at a drawdown some people survive, measured only backward. Every
question the data could answer at the big-picture level has been asked; what remains needs data the panel does not hold.

## What is genuinely missing — not "more of the same"
1. **A gross edge in price-only hourly rules does not appear to exist at this resolution.** Three designs and 26,305
   fits say so with coverage stated (24 instruments, 2016–2026, first-hit events). More set-ups of the same kind is
   the neighbourhood search D-848 measured at 64% of everything this programme has ever done.
2. **Execution-side money has never been measured, only assumed away.** THE EXECUTION LAW says a maker fill is a
   hypothesis until the *fill-conditional* return is measured; D-447 measured it once and it reversed the sign. Every
   hourly result here is priced at taker. A maker/limit engine with measured fills is an open question, not a null.
3. **Events are not in the data — and the data path is now known.** BLS publishes its full release schedule as an
   iCalendar feed (`bls.gov/schedule/news_release/bls.ics`: 416 events, Jan-2025 to Dec-2026, CPI/NFP/PPI/JOLTS with
   times to the minute) and per-year archives for earlier years. It is keyless. **The runner cannot fetch bls.gov until it
   is on the endpoint allowlist — one line, the operator's to add** (`echo '^https?://www\.bls\.gov/' >> ~/.claude/hooks/endpoints.allowlist`).
   With that, a release-timestamp event study on the hourly panel is a day's build, and it is the first design on this
   record that would condition on something other than price.
4. ~~Cross-instrument lead–lag at hourly resolution has not been asked~~ **Measured (D-862): NULL, sign missed.** Same-hour
   correlation up to 0.92, lagged slope negative — a sub-fee reversal (−0.2 to −4.2bp per 1sd vs 9bp). Information crosses
   instruments within the hour; nothing tradable leaks across it.
5. **The placeable classes are the weak ones.** FX and index CFDs at 4–6bp show gross ≈ 0; the only class with any
   gross is crypto perps at 9bp, which a UK retail account cannot hold. Access, not signal, is the binding constraint
   (INSTRUMENT LAW).
6. **The money that is measured real is per head, not per pound** (D-834/851): sign-up subsidies £150–£400 once,
   odd-lot tenders gated on one broker yes/no. Nothing on the price side approaches it at this account's scale.

## What this page does not say
It does not say markets are efficient; it says *these questions*, asked at full scale, returned zero gross. The
search-space map (`docs/SEARCH_SPACE.md`) is the list of what has and has not been asked; items 2–4 above are the
cells worth a fourth design, and each needs data the panel does not yet hold.
