# R-003 — The Edge-Lens Taxonomy

> **The knowledge map.** A strategy is one point; a *lens* is a whole dimension of looking at the
> data, and each lens spawns thousands of strategies. To "know more than the market about where
> edges live and how to find them," we enumerate the LENSES, not the strategies. This is that map —
> every distinct structural feature an edge can exploit, with our honest status on each. It answers
> the operator's question directly: *how many more are out there that we haven't validated?*
>
> Drawn 2026-08-04 (D-090). Status legend: **CLEARED** (survives our gate) · **TESTED-DEAD**
> (thoroughly falsified) · **LEAD** (promising, forward-testing) · **PARTIAL** (some tested) ·
> **UNTESTED** · **GATED** (needs paid/blocked data).

| # | Lens | Structural feature it exploits | Data | Free? | Status | Frontier priority |
|---|------|-------------------------------|------|-------|--------|-------------------|
| 1 | **Price-pattern** | chart geometry (sweep/FVG/OB/breakout/pullback/engulfing/pin/RSI/delivery) | OHLC | ✅ | **TESTED-DEAD** — 1.01M conditional cells, 0 clear DSR (D-081..83) | — |
| 2 | **Time-structure** | session/time-of-day/killzones/opening-range | intraday+ts | ✅ | **PARTIAL/LEAD** — 24h session cycle is REAL (D-085, 7/9 mkts); TBR = Gold lead forward-testing (D-088/89) | active |
| 3 | **Cross-sectional relative value** | relative strength across a basket (leaders vs laggards) | multi-asset OHLC | ✅ | **TESTED-WEAK** — sectors neg, crypto p=0.08 OOS-decays, indices nil (D-090). Momentum premium is slow-only. | low |
| 4 | **Factor / risk-premia** | value/quality/momentum/size/carry over the cross-section, slow | fundamentals+returns | ✅ (Fama-French) | **CLEARED** — the ONE edge (global book Sharpe ~1, D-077). Core of the whole thesis. | **CORE** |
| 5 | **Order-flow / microstructure** | CVD, order-book imbalance, absorption, footprint | tick / L2 | ✅ (crypto klines) | **TESTED-DEAD** (D-092) — free crypto CVD (taker-vol) is contemp (0.68-0.77) but ZERO predictive (0.006); paying for futures tick NOT justified | — |
| 6 | **Cross-asset / intermarket** | lead-lag (DXY→gold, yields→equities, ES↔NQ) | multi-asset | ✅ | **TESTED-DEAD** (D-091) — contemp corr 0.78–0.93 dominates; no tradeable lag; info priced within the bar | — |
| 7 | **Event / catalyst** | scheduled-release volatility (NFP/CPI/FOMC/earnings) | econ calendar + prices | ✅ (FRED dates) | **TESTED-DEAD** (D-091) — pre-FOMC drift arbitraged away post-2015 (−0.006%, p=0.65) | — |
| 8 | **Volatility-regime** | contraction→expansion, vol clustering, regime-switch | OHLC | ✅ | **PARTIAL-WIN** (D-092) — vol clustering STRONG (0.98/0.91, validates risk-layer vol-targeting); BTC squeeze breakout a real LEAD (forward-testing) | active |
| 9 | **Cycle / periodicity** | halving/seasonality/spectral | daily long history | ✅ | **TESTED** — only BTC halving is real (D-085); 364d + all else noise | — |
| 10 | **Flow / positioning** | COT, options gamma/GEX, 13F, Form-4, congressional | filings/options | ⚠️ partial | **PARTIAL-DEAD** — insider/congress rejected (D-071); dealer-GEX untested | med |
| 11 | **Sentiment / alt-data** | funding rates, put/call, social sentiment, AAII | exchange/alt | ✅ mostly | **TESTED-WEAK** (D-091) — funding carry real but thin/regime-dependent (BTC 1.7%/yr now); contrarian n.s.; ETH weak lead | low |
| 12 | **Calendar / structural-flow** | turn-of-month, OPEX week, index rebalancing, quarter-end | dates + prices | ✅ | **TESTED-DEAD** (D-091) — turn-of-month/OPEX/day-of-week all insignificant | — |

## What the map tells us (the honest inventory — FRONTIER NOW SWEPT, D-091)

- **CLEARED (1):** factor/risk-premia (#4) — the one durable edge (global book Sharpe ~1, D-077).
- **LEAD / forward-testing (1):** time-structure (#2) — 24h session cycle real; Gold-TBR + BTC-sweep
  pre-registered forward.
- **TESTED-DEAD or WEAK (8):** price-pattern, cross-sectional, intermarket, event, calendar,
  cycle(≈halving-only), flow/positioning, sentiment/funding(thin). Every fast/tradeable/anomaly lens
  is efficiently priced or arbitraged away.
- **GATED (1):** order-flow/microstructure (#5) — needs paid tick/L2 data (Databento/Polygon).
- **PARTIAL (1):** volatility-regime (#8) — some tested via the delivery trigger.

**The answer to "how many more are out there":** of 12 lenses, 10 are now tested — and the frontier of
free-data lenses is EXHAUSTED. The remaining upside is (a) the paid order-flow lens (#5, capital
decision), and (b) deeper isolation of the vol-regime lens (#8). Everything else is mapped and mostly dead.

## The doctrine that makes this a moat

Every lens is run through the SAME honest gate: deflate by trial count, split out-of-sample, beat a
null, report n, pre-register survivors forward. So our knowledge is *calibrated* — we don't just have
more hypotheses than the market, we know which are real and which are noise. That calibration — not a
secret setup — is the information monopoly ([[operating-principle-domination]]).

**Cross-cutting result across every lens tested so far:** the only things that survive are (a) the slow
global factor premia (#4), and (b) high-reward-to-risk liquidity-sweep-reversals as *leads* (#2, forward-
testing). Everything fast, directional, and single-instrument is efficiently arbitraged. The edge is
slow, structural, and risk-managed — never a fast chart trick.

## Next builds (prioritised frontier)

1. Calendar-flow backtester (turn-of-month / OPEX) — free, fast, likely-real.
2. Crypto funding-carry (needs a funding-data endpoint on the allowlist).
3. Event-window volatility model (FRED release dates).
4. Intermarket lead-lag scanner.

Each becomes a new corpus row with an honest verdict, and any survivor is pre-registered forward like
`btc-sweep-rr3-v1` and `gold-tbr-v1`.
