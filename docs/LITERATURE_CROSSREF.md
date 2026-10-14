# LITERATURE × RECORD — Financial Instruments 980N1 (L1–L3) mapped onto what we measured

> Source: Andrikopoulos, *Financial Instruments 980N1*, Topics 1, 2a/2b, 3a/3b + the L1 worked spreadsheet.
> Read 2026-10-14. The job is not to summarise the lectures — it is to find where the taught result and our
> measured record **agree, diverge, or expose something we never tested.** Disagreement is the valuable output in
> either direction.

## 1. Where the literature VALIDATES our construction

**The covariance argument is the blend.** L1's worked example (verified independently, not just read off the sheet):
three states — Expansion p=0.5, Recession 0.4, Deep Recession 0.1. Stock A returns 25/10/−15 → **E(R) 15.0%**,
σ 12.25%. Stock B returns 8/1/20 → **E(R) 6.4%**, σ 5.61%. Cov = −0.0022, **Corr = −0.3204**. Stock B earns its
place at *less than half* A's expected return purely because it is negatively correlated.
That is the exact logic of D-939: IVOL was admitted to the book not for standalone return but because its
correlation is **−0.30 to equity and 0.07–0.11 to distress**, and of D-944: the sleeves are individually
regime-specialised and only the *blend* holds Sharpe ≥1.3 across all five eras. **The textbook argument and our
measurement are the same argument.** Worth stating plainly: our best structural decision is the one the course
teaches in week one.

**"New information is not always incorporated into stock prices"** (L2-b, listed as evidence *against* efficiency)
is the single cleanest match to our deployed edge. The distress short exists because going-concern and late-filing
information prices in over a **~369-day median lead** (D-647/930/935). The lecture asserts the anomaly; our record
measures its half-life and trades it.

**L3-b opens "Financial statement analysis can be used to discover mispriced securities."** That is literally the
distress sleeve's thesis, built from filings rather than prices.

## 2. Where our record goes FURTHER than the taught version

| Taught (L2-b) | Our measurement |
|---|---|
| "Small-firm effect… seems to have diminished in recent years" | Stronger and more specific: in the **liquid tercile it is wrong-signed** (D-951), and every cross-sectional headline decomposes to liq:LOW 20–40%/yr vs liq:HIGH 0.9–5.7% (LIQUIDITY LAW, D-419/423). It did not merely fade — it was never tradable at size. |
| "January effect… institutions arbitrage it away" | Same class, killed by our own benchmark: turn-of-month is **drift wearing a calendar** — no window beats random same-size day sets in either half, on either index (D-962). |
| "Technical analysis does not beat the market" | Confirmed five ways for the usual forms — order flow sub-fee (D-816/925/921/948/949), ORB full-sample 0.90 → **OOS −0.39** (selection artifact), London 04:00–06:00 a **two-sided** cost sink (fade loses; continuation loses at t −17.6, D-958/960). |
| "Market overreaction / mean reversion" (anti-efficiency evidence) | This is the one technical family that **survived**: the fade at session levels (D-767/825/955). Note the irony — L2-b dismisses *support/resistance* while listing *mean reversion* as real. Our record reconciles them: the **levels are real as stop-magnets, the naive breakout trade is not.** Reversion *at* the level survives; continuation through it does not. |

## 3. Where we DISAGREE with the taught conclusion

- **"Fundamental analysis does not beat the market" (L2-b) vs L3-b's own premise.** The lectures contain both claims.
  Our record sides with L3-b: the deployed edge *is* filing-based fundamental analysis. The reconciliation is that
  generic ratio-screening is arbitraged (our D-423 fundamentals work found value-type factors capacity-bound in
  liquid names), while **constraint-linked** fundamentals — distress, short-sale limits, borrow — are not.
- **CAPM says only systematic risk is priced (L2-a).** Our deployed IVOL sleeve is a direct violation: *idiosyncratic*
  volatility predicts returns with the wrong sign for CAPM, clearing the deflation ceiling at t 3.17–3.77 (D-939).
  The literature knows this as the IVOL puzzle; the lecture's CAPM section does not mention it.
- **Explanatory power.** L2-a cites FF5 explaining **71–94%** of excess-return variability. Our own decomposition
  (D-920, 90 instruments × 9 drivers) found **median adj-R² 32.8%**, with the macro block worth only +0.9pp over
  market-only. Different universe and different right-hand side, so not a contradiction — but a caution that the
  high R² figure does not transfer to the instruments we actually trade.

## 4. What the lectures expose that we have NEVER tested

- **Dividend discount / PVGO valuation (L3-a).** We have never run a DDM-based intrinsic-vs-market signal. The
  lecture's own trading rule (IV > MV ⇒ buy) is testable on data we hold (prices + fundamentals), and the honest
  prior from our record is that it will be capacity-bound in liquid names — but that is a prediction, not a result.
- **The DuPont decomposition of ROE (L3-b)** as a *conditioner* rather than a signal: our surviving edges are all
  constraint-linked, and leverage/interest-burden components are constraint-adjacent. Untested.
- **Preferred stock and depositary receipts (L2-a)** — instrument classes entirely absent from our universe.

## 5. The honest verdict on "where and when is the market inefficient"

The lectures' anti-efficiency list (small-firm, January, overreaction, excess volatility, mean reversion, slow
information) is, after our measurements, **three-quarters dead and one-quarter deployed**: the calendar and size
effects do not survive costs or liquidity; overreaction/mean-reversion and slow information absorption survive and
are exactly what the deployed book trades. EMH is not wrong here — it is *approximately right wherever the
constraint is absent*, which is why our only survivors sit where a constraint (short-sale limits, borrow, forced
index flow, dealer hedging, stop clustering) prevents the arbitrage the lectures assume will happen.
