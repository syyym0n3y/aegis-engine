# Current opportunities — 2026-10-06

> TREND/momentum WATCHLIST across the global panel — one input family, NOT the deployed book. The deployed book is the
> 5-sleeve blend (leverageable excess ~1.92, D-939e pin): see DEPLOY_RUNBOOK.md / deploy-sheet.ts for what to hold.
> Signal = blended 21/63/126/252d trend, vol-normalised. Target and stop are **2xATR** (D-934: the exit that wins on capital-velocity — caps the tail, frees capital fastest).
> This is the systematic entry/exit for "one trade at a time" — the edge is the DIRECTION + diversification, not the timing.
> DORMANT / paper only. Claude never executes; the operator arms and fills manually.

## LONG (trend up)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDTRY=X | fx | LONG | 5.99 | 49.120499 | £1938 | 39.454 | 49.24 | 49 |
| SVXY | etf | LONG | 1.99 | 64.565002 | £1938 | 30.0163 | 66.29 | 62.84 |
| PBP | etf | LONG | 1.89 | 23.3932 | £1938 | 82.8446 | 23.69 | 23.09 |
| XLK | sector | LONG | 1.86 | 200.630005 | £1938 | 9.6596 | 206.69 | 194.57 |
| QUAL | etf | LONG | 1.72 | 225.210007 | £1938 | 8.6053 | 229.01 | 221.41 |
| SPY | etf | LONG | 1.63 | 772.630005 | £1938 | 2.5083 | 786.66 | 758.6 |
| ^TNX | rate | LONG | 1.62 | 5.324 | £1938 | 364.012 | 5.5 | 5.15 |
| ^TWII | intl_index | LONG | 1.62 | 49712.039063 | £1563 | 0.0314 | 51061.58 | 48362.5 |

## SHORT (trend down)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDCNY=X | fx | SHORT | 1.59 | 6.7048 | £1938 | 289.0467 | 6.7 | 6.71 |
| ZF=F | rate | SHORT | 1.50 | 103.320313 | £1938 | 18.7572 | 102.69 | 103.95 |
| ZT=F | rate | SHORT | 1.45 | 101.734375 | £1938 | 19.0496 | 101.46 | 102.01 |
| ZN=F | rate | SHORT | 1.38 | 104.09375 | £1938 | 18.6178 | 102.76 | 105.43 |
| VXX | etf | SHORT | 1.33 | 17.16 | £1309 | 76.2821 | 16.2 | 18.12 |
| ZB=F | rate | SHORT | 1.25 | 102 | £1938 | 19 | 99.61 | 104.39 |
| TLT | etf | SHORT | 0.96 | 76.904999 | £1938 | 25.1999 | 75.17 | 78.64 |
| IEF | etf | SHORT | 0.95 | 88.805 | £1938 | 21.8231 | 87.69 | 89.92 |

## SHORT — going-concern distress (the persistent edge, D-930/931)
164 going-concern 10-Ks filed in the last 90 days. Short the borrowable liquid names (days-to-cover < 5), long IWM,
hold ~126 days or to a profit target; net ~40%/yr on the borrowable subset. Run `goingconcern-borrow.ts` for the current list.

## How to use (the operator's loop)
1. Pick the highest-|signal| trade with favourable conditions, long or short.
2. Enter at market; set the 2xATR profit-target and stop above (the D-934 validated exit).
3. On target or stop, exit and rotate to the next highest-signal setup.
4. Size each trade small (the wallet grows across many trades, not one bet) — the blend's edge is diversification across sleeves, not any one trade.
