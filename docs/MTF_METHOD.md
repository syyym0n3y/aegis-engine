# MTF_METHOD — the price-action / structure lens, made falsifiable (opened 2026-09-02)

> Operator directive: *"stop looking for a single edge — our edge should be our MTF analysis and what we can
> confidently predict based on the chart. Focus on very liquid states where buy/sell volume is not cancelling out
> and a clear direction is justified; mark session / timeframe / previous highs and lows; when a candle passes those
> points it should count for something; check whether we need to wait for a reversal before entering; check inverse
> fair value gaps; account for a lot more, granularly."*

## The one thing that must not happen
Discretionary MTF price-action (SMC/ICT: sweeps, FVGs, order blocks, "structure") is the **most overfit domain in
retail trading**. "The chart clearly justified the direction" is the exact sentence behind which most of the ~97%
who lose are standing, because sweeps and gaps are trivially fit *post-hoc* to any chart. So this lens is pursued
ONLY as mechanical, pre-registered rules run through the same falsification engine as everything else. **No
chart is ever hand-read into a conclusion.** If a structure predicts, it survives lag-1 execution + cost + OOS +
the trial count; if it is the usual illusion, the engine says so with a number.

## The base rate for this exact idea (on record before we start)
D-426: crypto residual order-flow imbalance ("volume not cancelling out → direction") was measured — 20/20
instruments sign-consistent, |t| to 4.9, on a $523M/hour instrument — and it was **real but SUB-FEE (0.02–0.14×
the round-trip cost)**. So directional-volume prediction is not untested folklore here; it was true and too small
to trade. The MTF *structure* layer (levels, breaks, FVG/IFVG, MTF context) is what is genuinely new.

## Concepts → mechanical, testable definitions (each parameter is a counted TRIAL; SELECTION LAW binds)
| operator concept | mechanical rule (no look-ahead) |
|---|---|
| "very liquid, volume not cancelling out" | bar volume / trailing-median (participation), and directional proxy CLV=((c−l)−(h−c))/(h−l) × volume, z-scored. **PROXY**: no intraday taker split is held, so this is close-location, not a true buy/sell delta — stated everywhere. |
| "session / TF / previous highs & lows, marked" | PDH/PDL (prior UTC day), PWH/PWL (prior week), prior-session H/L (Asia/London/NY, approx UTC) — each known only AFTER its period closes. |
| "candle passes those points → counts for something" | a **close** beyond a marked level = a break event; measured, not assumed. |
| "wait for a reversal before entering" | the central dichotomy: after a break, **break-and-go** (continuation) vs **sweep-and-reverse** (the level was liquidity); measured as P(continuation) vs P(reversal) and whether a 1-bar reversal confirmation improves net expectancy. |
| "inverse fair value gaps" | FVG = 3-bar imbalance (bar[i−1].high < bar[i+1].low bullish); IFVG = a FVG that price closes THROUGH, which then acts as an inverse level. Measured: fill behaviour + directional prediction. |
| "MTF" | every LTF (1h) signal conditioned on HTF (daily) trend — with-trend vs counter-trend cells reported separately. |

## Data (held)
Crypto 1h OHLCV (`trd_bars_intraday` tf=1h) — primary. FX hourly OHLCV (`trd_fx_hourly`, vol=tick-count, caveat).
No intraday taker delta → directional volume is a CLV proxy. Equities: daily only, so no intraday MTF there.

## PRE-REGISTERED success criteria (written before the results — a cell is "confidently predictive" only if ALL hold)
1. **Net-of-cost expectancy** distinguishable from zero (crypto ~7bp RT, FX ~2bp RT charged) — a gross edge that
   dies on cost is not a signal (EXECUTION/COST-INFLATION LAW).
2. **Breadth**: ≥ ~50 break/gap events in the cell — fewer is UNTESTED, not evidence.
3. **Not selected in-sample**: the full parameter grid is reported; choosing the best cell is flagged in-sample
   (SELECTION LAW), and a train/test or era split is required before any cell is believed.
4. **Robust across the MTF/volume conditioning** in a coherent way (a with-trend high-volume break behaving
   differently from a counter-trend low-volume one is a *finding*; a lone significant cell in a grid of 200 is a
   trial artifact).
5. Anything that survives all four goes on a **forward clock** (PRE-COMMITMENT LAW) — it is not a live trade until
   forward-confirmed, like every other candidate.

## The honest expected outcome
Given the base rate and D-426, the most likely result is: **mostly noise, with a few conditional cells** (e.g.
a with-HTF-trend break on high directional-volume continuing; a counter-trend break into a level reversing) that
carry a small, real, net-of-cost edge. That is not a failure — it IS the "calibrated confidence per setup" the
directive asks for: the deliverable is a map of *where and how much* the chart predicts, per instrument and state,
with the risk shown — not a single edge. The edge, if any, is the map.

Build order: (1) `_shared/mtf-structure.ts` primitives + tests → (2) liquidity-break dichotomy (running) →
(3) FVG/IFVG prediction → (4) finer MTF/volume conditioning and the per-setup confidence map.
