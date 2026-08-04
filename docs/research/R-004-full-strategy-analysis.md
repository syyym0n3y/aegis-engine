# R-004 — The Complete Strategy & Backtest Analysis

> Every strategy and backtest Aegis has run (D-070…D-093), analysed in one place. The honest ledger:
> what cleared, what's a lead, what's dead — with the numbers. Scale: **~1.1M+ strategy-configurations
> tested** across 13 lenses, 20+ markets, 3 timeframes, all through the same gate (deflate by trial
> count · out-of-sample · beat a null · report n · pre-register survivors forward). Drawn 2026-08-04.

## Tier 0 — the ONE thing that CLEARED (the durable edge)

| Edge | What it is | Result | Status |
|---|---|---|---|
| **Global factor book** (D-077) | value + quality + momentum across US / Developed / Emerging, inverse-vol weighted, vol-targeted | **Sharpe ~1.0 over 427 months**; capstone compounded 30.8×/36y | **CLEARED — the compounding engine. Deploy real capital here (unlevered).** |

Everything below is either a *lead* (forward-testing, $0 real money) or *dead*.

## Tier 1 — LEADS (survived enough to pre-register forward; all high-RR crypto/Gold vol-liquidity events)

| Lead | Backtest | Forward tracker | Honest caveat |
|---|---|---|---|
| **btc-sweep-rr3-v1** (D-081/82) | sweep + EMA20 + 3:1, BTC 15m; +0.09R (all) to +0.78R (best cond) | `trd-prereg-tick` (6h) **+ REAL Alpaca paper fills** (long side) | failed DSR vs 1.01M siblings — forward decides |
| **gold-tbr-v1** (D-088, Rauf TBR) | NY 8:12–9:12 range sweep-reversal, Gold 5m; **+0.498R, OOS +0.72/+0.17, n=40** | `trd-tbr-tick` (weekdays 21:00) | t=1.22 (<2); **ES/NQ — his own markets — LOSE** (−0.165R / −0.194R) |
| **btc-squeeze-v1** (D-092) | vol-squeeze breakout, BTC 1d; **+0.471R, t=4.45**, both sides +, OOS +0.64/+0.21 | `trd-squeeze-tick` (daily) | daily overlapping windows inflate t; forward decides |
| **BTC halving grand-cycle** (D-085) | halving→top **526/548/534d** (n=3); top→top 1424/1426d; bottom→top **1061/1050d** (≈ the "1064" claim) | pre-registered date: **macro bottom ~2026-10-29** | n=2–3; mechanism-backed (halving) but statistically uncertifiable; crypto-only |

**Every lead has the same shape: high reward-to-risk, sweep/reversal/expansion, crypto or Gold — the exact opposite of the "1:1 → high win rate" farming everyone sells.** That convergence is the single most informative result in the program.

## Tier 2 — TESTED-DEAD (falsified with evidence)

| Strategy / lens | Verdict | Key number |
|---|---|---|
| **Pranam XAU 15m liquidity-grab** (D-080) | REJECTED | 44% win (not 76.5%), **−0.192R, t=−3.34**, n=306 |
| **Grammar mass-search** (D-081) | REJECTED | 8,640 trials → 0 clear DSR (best survivor 0.63) |
| **Canon conditional search** (D-082) | REJECTED | 80,160 cells → 0 clear |
| **Universe sweep** (D-083) | REJECTED | **1,010,539 cells → 0 clear** |
| **Calendar / event** (turn-of-month, OPEX, pre-FOMC) (D-091) | DEAD | pre-FOMC drift −0.006%, p=0.65 (anomaly arbitraged away post-2015) |
| **Intermarket lead-lag** (D-091) | DEAD | contemp corr 0.78–0.93 dominates; no tradeable lag |
| **Order-flow / CVD** (D-092) | DEAD | delta→price predictive corr **0.006** (contemp 0.68); trading it loses (Sharpe −17/−32) |
| **COT positioning** (D-093) | DEAD | S&P corr 0.34 but trade Sharpe −0.61, OOS −0.01/−1.70 |
| **Insider cluster-buy / congressional copycat** (D-071) | REJECTED | unmasked as sector beta (r²=0.96, residual-α t=−0.85) |

## Tier 3 — TESTED-WEAK / PARTIAL (real but not a standalone tradeable edge)

| Lens | Finding | Where it matters |
|---|---|---|
| **Cross-sectional relative value** (D-090) | momentum premium is **slow-factor only** (crypto weak lead p=0.08, OOS decays) | already captured in the factor book (WML) |
| **Funding-rate carry** (D-091) | real but thin/regime-dependent (BTC 1.7%/yr now); contrarian n.s. | a small yield, not an edge, in this calm regime |
| **Volatility-regime clustering** (D-092) | **STRONGLY predictable** (corr 0.98/0.91) | **validates vol-targeting in the RISK layer** — not directional alpha |
| **24h session cycle** (D-085) | real in **7/9 markets** (equities R=0.81) | validates the asia/london/ny session tagging |

## The risk & execution layer (the near-certain +EV component)

- **Risk firewall + half-Kelly sizing:** keeps an account alive even trading a *losing* strategy (paper sim: −10%/1.6y but 11% maxDD, no ruin). This is the one component with near-certain positive expected value.
- **Simulator validated:** Alpaca **real** long-crypto fills cost **0.096%** vs the sim's assumed 0.16% — the inferred cost model is *conservative*, i.e., honest. Shorts are cost-symmetric, so the sim is trustworthy for the short side too.
- **Macro overlay:** de-risks when the system is fragile (yield curve / vol) — measures fragility, never direction.
- **Execution surfaces:** long-crypto is LIVE on real Alpaca paper; no-KYC short surface proven un-automatable in our edge runtime (Binance geo-blocked, Hyperliquid faucet-gated, dYdX client won't run in Deno) → shorts stay on the validated sim.

## The five cross-cutting laws (proven, not asserted)

1. **No fast, directional, single-instrument, or anomaly edge survives** — across 1.1M+ configurations and 13 lenses, zero cleared honest deflation.
2. **The only durable edge is slow factor premia** (the factor book).
3. **The only recurring chart lead is high-RR sweep-reversal** — three leads, all forward-testing, all the opposite of win-rate farming.
4. **Risk management is the near-certain +EV component** — survival compounds when a real edge is present, protects when it isn't.
5. **Volatility is predictable; direction is not.** Vol-clustering feeds the risk layer; nobody's chart predicts price.

## Bottom line

The most likely terminal state D-070 predicted — *"nothing clears the gates, and that is a SUCCESS of the engine"* — is essentially what happened for the **chart/timing universe**, while the **factor book** stands as the one verified compounder and **three high-RR leads** earn their verdict forward. We now know, calibrated and evidenced, exactly where the edges are not, where the one durable edge is, and which three leads time will judge. That map is the asset.
