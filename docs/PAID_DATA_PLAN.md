# PAID DATA PLAN — the cheapest route past each remaining data barrier (D-815, 2026-09-07)

> Status 2026-09-08 (D-816/820): Databento credit **$121.58 of $125 spent** — equity L2 (SUB-FEE, 20 names) and 5 months of SPX per-strike OI (pinning SIGN MISSED, walls underpowered). Revisions are free (D-817). Theta ($40/mo) remains the only priced route to longer options history and is NOT PURCHASED. Every price below was read from the vendor's own page on 2026-09-07 unless marked;
> paying is the operator's act (I never enter payment details), and nothing that spends runs until armed. Each purchase
> is paired with the pre-registered test that would run on it, so the spend has a rule before it happens.

## 1. The barriers and the cheapest verified option for each

| barrier | what it unblocks | cheapest verified option | price | what I could NOT verify |
|---|---|---|---|---|
| **Options surface history** (per-strike OI, IV, greeks — the largest UNTESTED space, WEALTH_PATH §6) | dealer-positioning × level tests with history instead of 15 days; put/call at the strike level; VRP in the placeable instrument | **Theta Data, Options Value** — 4 years, 1-minute intervals; product page states daily open interest, IV and full greeks are part of the options data | **$40/mo** (Standard $80: 8 years, tick; Pro $160: 12 years) | which tier gates OI/greeks — the pricing page does not say; confirm on the purchase screen |
| same, at $0 | a bounded pull (e.g. SPX/SPY/QQQ EOD chains, 2 years) | **Databento OPRA** on the **$125 free historical credit** for new accounts (6-month validity), pay-per-GB after | **$0 to start**; Standard plan $199/mo only if live data is wanted | the per-GB rate is quoted only inside their batch tool after sign-up |
| **Equity L2 / tick** (footprint, depth imbalance for equities) | the equity half of D-808 (crypto was measured free) | **Databento XNAS.ITCH** (Nasdaq TotalView: MBP-10, TBBO, trades) on the same $125 credit — a bounded set (20 liquid names × 1 year of MBP-1/TBBO) is the right first pull | **$0 to start**, then per GB | exact GB cost per symbol-day |
| equity NBBO quotes only | consolidated quotes, no depth | Massive (ex-Polygon) Stocks Advanced | $199/mo | not recommended: quotes are not depth |
| equity trades only | tick trades, no quotes | Massive Stocks Developer | $79/mo | superseded by Databento credit |
| real-time OPRA + unlimited calls | live options feed | Alpaca Algo Trader Plus | $99/mo | not needed for research |
| **Earnings estimate revisions** (analyst estimates) | the licensed driver in the register | **NO LONGER PAID (D-817):** Yahoo `earningsTrend` (keyless, cookie+crumb) gives consensus now vs 7/30/60/90 days ago plus up/down revision counts per name; Nasdaq's analyst endpoint (keyless) cross-checks it. Daily snapshots for the liquid decile are in the runner. | **$0** | history before 2026-09-07 does not exist free; the forward series starts now (EODHD €59.99 remains the paid route to a backfill) |

**Minimum spend to open every barrier for research:** **$40/mo** (Theta Options Value) + **$0** (Databento credit for
equity depth and a bounded options pull) + **€59.99/mo** (EODHD fundamentals, optional) ≈ **$40–105/month**. Nothing
here requires an annual contract.

## 1b. What was found free and keyless instead (D-817, probed 2026-09-07)

- **Revisions: solved free.** Yahoo `earningsTrend` + Nasdaq analyst API (see the table). No vendor needed unless a pre-2026 backfill is wanted.
- **Options surface, forward: solved free.** CBOE's delayed chains answer for ANY underlying with per-strike open interest and IV; `collect-us-options.ts WIDE=1` now snapshots the whole liquid decile daily (P/C OI, ATM IV, skew, term, naive GEX per name).
- **Options surface, HISTORY: no free keyless source exists.** Probed: OCC daily open interest = market-wide totals only (calls/puts by equity/index, one row per day, back to 2021+); Massive/Polygon = 401 without a key, and even keyed it carries current OI only; OptionsDX = free datasets require a checkout with an email and the free set is unspecified; OptionCharts = charts, no data endpoint; HistoricalData.net = a 2013 sample. The accumulating snapshot is the free route; Theta Options Value ($40/mo) is the only priced route to 4 years of history.

## 2. Sequencing (one purchase, one measurement, then the next)

1. **Databento sign-up, $0** → pull 20 liquid names × 1 year MBP-1/TBBO + SPX/SPY EOD option chains 2 years inside the
   credit → run the equity twin of D-808 (depth imbalance, footprint) and the strike-level positioning test. If both are
   sub-fee, the equity L2 barrier is closed for free and no subscription follows.
2. **Theta Options Value, $40/mo** only if the Databento options pull shows anything at all, or if 4 years of 1-minute
   surface is needed for the VRP/positioning clocks.
3. **EODHD fundamentals, €59.99/mo** only for the revisions test (PEAD × revision, D-612's sibling), one month, cancel
   unless it clears.

## 3. The tests that would run (to be pre-registered in `trd_prereg` before the first byte)

- equity depth imbalance and footprint → next hour (mirror of D-808), mean effect ≥ 1× fee (10bp equity RT)
- strike-level index positioning (put/call at strike, naive GEX with history) × value-area edge (mirror of D-809b)
- estimate-revision drift, liquid decile, benchmark-law excess, ≥ 120 months
- crypto/index variance risk premium in the placeable instrument with a real surface (D-574's retest)

## 3b. Free keyless substitutes found afterwards (D-818)

- **Dealer positioning history:** SqueezeMetrics GEX/DIX daily since 2011 — held, tested NULL.
- **Crypto options IV history:** Deribit DVOL BTC/ETH daily since 2021 — held; BTC variance premium confirmed as a measurement.
- **Estimate revisions:** Nasdaq analyst endpoint, daily snapshot of consensus + 4-week revision counts for 150 names — held forward; EODHD is no longer needed unless history is required.
- Still paid: a per-strike US options surface with history (Theta Options Value, $40/mo).

## 4. What this does NOT change

The base rate. Every free source measured to date is sub-fee; paid data changes which questions are testable, not the
prior on the answer. The largest lever on the record is still the empty wealth ledger (D-746).
