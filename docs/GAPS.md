# GAPS.md — what we don't have, ranked by honest impact (the path to a better engine)

> The operator asked "what would make this 1,000,000× better." Honest answer first: **no single thing does.** Markets are
> mostly efficient — that is why every directional candidate we've tested (price-grammar, momentum, funding, imbalance,
> GEX-directional, DIX, VIX-TS, insider — even opportunistic) is null or tiny. The base rate caps the upside. The real
> levers are, in order: **data completeness → feature richness → methodology → execution.** The one component with
> near-certain positive EV is risk/sizing (D-070), and GEX→vol (IC −0.49) is the proof. This file is the honest map of what
> is missing and what each would realistically buy — so we invest where the ROI is, not where the hype is.

## 1. DATA — the biggest lever (most edges die for lack of the right data, not the right idea)

| Gap | What it unlocks | Free path? | Honest impact |
|---|---|---|---|
| **Survivorship-free PRICES** (we have delisted *membership*, not their price history) | Removes the last bias on EVERY equity backtest; the dead names (Enron/Lehman/SVB) that inflate survivor-only results | Partial: FMP/EODHD free tiers give *some* delisted prices but day-throttled (~250/day); full multi-decade = CRSP/Sharadar/Norgate (paid) | **High** — it's a correctness fix, not new alpha; without it, every equity Sharpe is optimistic |
| **Point-in-time FUNDAMENTALS** (EDGAR XBRL: earnings, book, assets, shares) | Value, quality, profitability, investment, accruals, net-issuance, PEAD — a whole factor family we CANNOT test today | **Yes, free** via EDGAR XBRL — but a heavy point-in-time pipeline (45-day lag baked into effectiveDate) | **High** — quality/investment are the most *durable* documented factors; this is the biggest free-but-unbuilt opportunity |
| **Deep intraday history** (minute bars over years, all names) | Backtest microstructure + per-name GEX historically instead of accumulating forward | Databento OPRA/equities (paid, ~$0.30/mo/symbol) | **Medium** — but the Epps effect (D-346) showed below-daily is mostly noise; low ROI for causal attribution |
| **Options history** (per-name OI+IV time series) | Historical per-name GEX/vanna/charm backtest (we compute it live-free now, but can't backtest) | Live free (Nasdaq chain); historical = paid | **Medium** — GEX is a proven *regime/sizing* signal, not directional; historical would confirm the vol relationship per-name |
| **Alt-data** (satellite, credit-card, web-traffic, app-downloads, shipping, sentiment/NLP) | The genuine remaining edge frontier — non-price information not yet in prices | Mostly gated/expensive; some free (Google Trends, Reddit/news via API) | **High-but-hard** — where real uncrowded alpha plausibly still lives; also where capacity + cost are worst |
| **COT / positioning / short-interest history** | Crowding/positioning forces (the funding edge's family) for futures + equities | Free (CFTC COT, FINRA short-interest) but low-cadence | **Medium** — real but slow/lagged signals |
| **Consolidated real-time tape + DMA** | Live execution below seconds | Broker-dealer/colocation (capital+regulatory wall) | **Refuse** — the HFT tier we deliberately don't compete in (D-070) |

## 2. FEATURES — causal forces not yet built (cheap to add once data exists)
- Dealer **vanna/charm** (from the options chain we already pull free) — mechanical flows beyond gamma.
- Proper **cross-asset lead-lag** (futures→spot, big→small) with an execution-latency-honest horizon.
- **Credit spreads** (HYG/LQD vs Treasuries) as a risk-regime force.
- **Cross-sectional** factor construction — our sweep tests *time-series* per-instrument signals; the documented anomalies
  are mostly *cross-sectional* (rank all names, long-short deciles). This is a methodology gap as much as a feature gap.

## 3. METHODOLOGY — how we test (correctness, not new data)
- **Effective-N / Newey-West for overlapping windows** — our sweep t-stats are inflated (512k overlapping obs); the IC
  *magnitudes* are honest but the significance is overstated. Non-overlapping or HAC standard errors fix it.
- **Cross-sectional decile long-short** — the canonical way to test value/momentum/low-vol; different from our time-series IC.
- **Factor COMBINING** — orthogonalize the small surviving signals + regime-condition; IC×√breadth only pays if signals are
  decorrelated. (Currently every signal is null/tiny, so nothing to combine — but the harness should exist.)
- **Walk-forward + DSR on any survivor** — already the discipline; extend to the sweep survivors if any clear.

## 4. EXECUTION — realism (before any real capital)
- Calibrated **slippage/impact** per instrument (we use pessimistic bps, not measured fills).
- Real broker path — deliberately gated behind the staged rungs (no real money before the gates).

## The honest verdict on "1,000,000× better"
The single highest-ROI *free* build is **the EDGAR XBRL fundamentals pipeline** — it unlocks the most durable documented
factor family (quality/investment/profitability) that we literally cannot test today. Second is **survivorship-free prices**
(a correctness fix — throttled-free via FMP/EODHD, or paid for depth). Everything else is incremental. And the honest frame
stays: this engine's proven value is **understanding + risk/sizing**, not a directional edge that the evidence says isn't
freely there. We invest in the fundamentals pipeline and the price-correctness next — measured, deflated, and honest about
what each returns. See [[STACK.md]] for how any of these plug into the layered architecture without losing context.
