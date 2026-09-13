# RETAIL PLAYBOOK — what the measurements say a small UK account should actually do (D-869, 2026-09-13)

> Written after the big-picture pass (D-863–868). Every number here is a pre-registered, out-of-sample measurement on
> this record; the ones that fail the operator's tenfold target are stated as failing it. Nothing here is advice to
> open, fund or trade an account; those acts are the operator's.

## 1. The money that is measured real is per head, not per pound
Venue sign-up subsidies (D-851): roughly **£150–£400 once** on ~£1,000 of deposits, one per person, non-compounding —
5–15% of a few-thousand-pound account in a year, larger than any edge measured here. Odd-lot tender priority (D-751/840):
~$230 per event at ~5 events a year, gated on **one broker yes/no**. Class-action notices (D-852): file every one.

## 2. The only supported book a UK ISA can hold: long-only ETFs with a trend switch (D-868)
| OOS 2015–26, 51 ISA-holdable ETFs | Sharpe | %/yr (10% asset vol) | maxDD | underwater |
|---|---|---|---|---|
| buy-and-hold, vol-matched | 0.47 | 3.5 | **−31%** | 3.0y |
| **trend-timed** (hold when 1/3/6/12-month trend positive, else cash) | **0.62** | 2.9 | **−11%** | 2.4y |

Reproduced in-sample 1993–2014 (Sharpe 1.06 vs 0.82, maxDD −10% vs −28%). **It is a drawdown result: it gives up ~0.6%/yr
of return to cut the worst drawdown by two thirds.** Weekly rebalance, 4bp, no financing. On a forward clock from today.

**Construction (D-870):** group the timed sleeves into equity / bond / precious / commodity and weight the classes at equal
risk (inverse trailing vol) rather than equal-weighting 51 tickers: OOS **Sharpe 0.76, maxDD −7%, 1.6 years underwater**
(in-sample 1.19), above equal weight in both eras. This is the book the paper record carries forward.

**Spot crypto (D-871), if you choose the exposure:** the same long-only trend switch on 27 spot coins with 8+ years gave
Sharpe 0.69 with a −6% drawdown over 2018–26, while holding them at matched vol made nothing (−24% drawdown). On the most
volatile asset you can hold, the switch is nearly all of the risk-adjusted return.

**Insurance-priced overlay (D-872):** halving positions the day after VIX closes above its trailing-year 80th percentile
lifts the book to **Sharpe 0.83 with a −5% drawdown** out of sample (in-sample 1.23, −8%). Best holdable number on the
record; NULL by one registered clause, so it rides the D-868 clock rather than its own.

**The pair (D-873):** the ISA book and the timed spot-crypto book (D-871) at risk parity, correlation 0.15, OOS 2018–26
**Sharpe 1.29 with the survivor-free crypto leg** (D-874: 469 contracts incl. 138 dead; 1.40 on survivors), t above the
ceiling, 12.9%/yr at 10% vol, positive in all seven years 2020–26; **at 20% vol ~26%/yr, −33%, 9.7 years to 10×** — the
first book here for which tenfold inside a decade is arithmetic at a drawdown some people survive. NULL by its drawdown
clause; on a forward clock from today; nothing forward-tested yet. **Without 2020–21 (the crypto bull) the pair is 0.90, not 1.29** — a third of the headline is two years. Across 36 parameter
cells it ranges 0.92–1.45 with the registered cell mid-grid (D-875): not a knife-edge, not a pick; monthly rebalancing is worst. If you choose it, size it
at 20% vol at most and expect the −33%.

## 3. What NOT to hold, measured
- **CFDs with overnight financing** (D-866): 6.5%/yr on notional turns the trend book from +0.26 to **−0.32** Sharpe.
- **Hourly technical set-ups** (D-859–862): gross **zero** across 24 instruments and 26,349 counted fits.
- **FX carry and 5-year value** (D-865): dead since 2015 (Sharpe −0.47 and −0.14).

## 4. Sizing, and the tenfold arithmetic (D-864)
Tenfold in ~7 years needs ~39%/yr, i.e. a sustained net Sharpe near **1.5** at a survivable drawdown. The best single
holdable book is 0.83 (timed ISA, class parity, VIX overlay): at 20% vol ~16%/yr, −30%, 12–13 years. The pair with timed
spot crypto (D-873b, survivor-free leg) is 1.29: **at 20% vol ~26%/yr, −33%, 9.7 years to 10×.** That is the honest frontier: tenfold in under a
decade is arithmetic only with the crypto leg, only at a −33% drawdown, and only if the forward record confirms a Sharpe
that has so far been measured only backward. Never lever past 20% vol; at 30% the drawdown is −50%. Position size so
the book's vol is 10–20%; never lever a Sharpe below 1 past 20% vol.

## 5. The limitation that binds (D-878)
The pair's native vol is ~3%; every "20% vol" figure above is 6.7× leverage. **An ISA cannot be levered. CFD financing kills the
trend book. Crypto spot levers only through perps at funding cost.** At 1× each leg a UK account gets ~4–5% vol and ~5–6%/yr —
about a tenth of a percent a week. Risk is controlled by a machine (`pair20g`, D-878); return is capped by access, not by risk.

## 6. What would change this page
Only a new *source* of return, not a better signal: execution-side fills (unmeasured), event timestamps (BLS calendar,
blocked on one allowlist line), or a broker answer on odd lots. Everything price-only at hourly resolution has been asked.
