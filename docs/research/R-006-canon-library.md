# R-006 — The Canon Library: great-traders' frameworks, classified + tested (not folklore)

> Systematic extraction of published trading frameworks into testable specs. Mechanically-testable ones
> are backtested (`scripts/trd-canon.ts`) under ANALYSIS_CONTRACT (number + N + IS/OOS). Behavioural ones
> are labelled untestable. Verdicts reference DECISIONS.md.

## Tested (mechanical)
| Framework (source) | Rule essence | Verdict (real backtest) |
|---|---|---|
| **Minervini Trend Template / SEPA** | long only: price>50/150/200MA, MAs stacked & rising, ≥30% off 52w-low, ≤25% from 52w-high, RS>index | **N=681, +0.096R OOS** (27% win), decayed from +0.33R IS. Thin; rides the equity uptrend more than adds alpha. |
| **Elder — Triple Screen + Force Index** | weekly trend up → buy daily Force-Index<0 pullback → trailing exit | **N=3867, +0.022R OOS** (53% win) ≈ breakeven. Not an edge over beta. |
| **Dalio — Economic Machine / All-Weather** | risk-parity across growth/inflation regimes | **Sharpe 0.51-0.64, maxDD 26%** (D-119) — lower-drawdown beta, not alpha. |
| **Sinclair — Volatility Trading** | sell the volatility risk premium (covered-call/put-write) | **VRP +3.6 vol-pts, 84% positive; ^PUT Sharpe 0.54 vs SPY 0.51** (D-116/118) — risk-reducer. |
| **Wyckoff** | accumulation/distribution, spring/upthrust, effort-vs-result | features built (`_shared/trd-wyckoff.ts`); no standalone deflated edge (D-087). |

## Needs data we lack (untested)
| Framework | Gap |
|---|---|
| **O'Neil — CANSLIM** | needs FUNDAMENTALS (earnings/sales growth, institutional ownership). Technical breakout leg ≈ Minervini (tested). Fundamentals = the free-tier data acquisition (FMP/AlphaVantage). |
| Sinclair active option-selling (strike/timing/tail-hedge) | needs options-chain + IV history (paid ~$100-300/mo) |

## Behavioural — real wisdom, NOT a mechanical edge (do not backtest, apply as discipline)
| Framework | The lesson → where it lives in our stack |
|---|---|
| **Livermore — Reminiscences** | cut losses, let winners run, don't overtrade, don't switch bias → enforced by deterministic rules + the risk engine (no discretion in the order path) |
| **Schwager — Market Wizards** | the ONE common thread across all wizards = **risk management + position sizing + survival**, NOT a shared setup → this IS our thesis (D-070) and the shipped ruin/Kelly engine |
| **Elder — the 3 M's (Mind/Method/Money)** | Money (risk) is the decider → the risk engine |

## The honest read (per contract, no editorial)
The mechanically-tested canon technical strategies (Minervini, Elder) are **thin-to-breakeven OOS and mostly
capture equity beta**. The canon frameworks that carry a real (if modest) edge are the STRUCTURAL ones
(Dalio risk-parity: lower-drawdown; Sinclair VRP: 84%-positive risk-reducer). The single universal lesson
across every great trader — Schwager's explicit finding — is **risk management / survival**, which is the
one component this project has repeatedly shown is +EV (D-070) and has shipped. Regime role: Minervini/Elder
are long-trend → the co-pilot (trd-regime) switches them OFF in CONTRACTION, ON in EXPANSION.
