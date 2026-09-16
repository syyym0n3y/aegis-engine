# Current opportunities — 2026-09-16

> What the validated 4-sleeve book (D-932, Sharpe 1.60) says to trade NOW, both directions, across the global panel.
> Signal = blended 21/63/126/252d trend, vol-normalised. Target/stop are volatility-scaled (2σ/1σ over ~21 trading days).
> This is the systematic entry/exit for "one trade at a time" — the edge is the DIRECTION + diversification, not the timing.
> DORMANT / paper only. Claude never executes; the operator arms and fills manually.

## LONG (trend up)
| symbol | class | dir | signal | px | vol | profit-target | stop |
|---|---|---|---|---|---|---|---|
| USDTRY=X | fx | LONG | 5.67 | 48.586449 | 2% | 49.06 | 48.35 |
| PBP | etf | LONG | 1.66 | 23.299999 | 6% | 24.13 | 22.88 |
| SVXY | etf | LONG | 1.60 | 62.610001 | 21% | 70.34 | 58.74 |
| ^TNX | rate | LONG | 1.15 | 4.961 | 14% | 5.35 | 4.77 |
| SB=F | commodity | LONG | 1.07 | 19.059999 | 31% | 22.42 | 17.38 |
| ZEC-USD | crypto | LONG | 1.05 | 1146.199951 | 100% | 1810.97 | 813.81 |
| CT=F | commodity | LONG | 1.02 | 85.040001 | 29% | 99.09 | 78.01 |
| XBI | etf | LONG | 1.02 | 157.600006 | 29% | 183.97 | 144.41 |

## SHORT (trend down)
| symbol | class | dir | signal | px | vol | profit-target | stop |
|---|---|---|---|---|---|---|---|
| USDCNY=X | fx | SHORT | 2.19 | 6.7075 | 1% | 6.66 | 6.73 |
| ZF=F | rate | SHORT | 1.31 | 104.398438 | 3% | 102.65 | 105.27 |
| ZT=F | rate | SHORT | 1.23 | 102.042969 | 1% | 101.23 | 102.45 |
| ZN=F | rate | SHORT | 1.17 | 105.984375 | 4% | 103.38 | 107.29 |
| VXX | etf | SHORT | 1.13 | 18.23 | 43% | 13.75 | 20.47 |
| USDKRW=X | fx | SHORT | 1.06 | 1344.150024 | 9% | 1272.85 | 1379.8 |
| SAND-USD | crypto | SHORT | 0.99 | 0.0353 | 57% | 0.02 | 0.04 |
| SNX-USD | crypto | SHORT | 0.89 | 0.21142 | 46% | 0.16 | 0.24 |

## SHORT — going-concern distress (the persistent edge, D-930/931)
164 going-concern 10-Ks filed in the last 90 days. Short the borrowable liquid names (days-to-cover < 5), long IWM,
hold ~126 days or to a profit target; net ~40%/yr on the borrowable subset. Run `goingconcern-borrow.ts` for the current list.

## How to use (the operator's loop)
1. Pick the highest-|signal| trade with favourable conditions, long or short.
2. Enter at market; set the volatility-scaled profit-target and stop above.
3. On target or stop, exit and rotate to the next highest-signal setup.
4. Size each trade small (the wallet grows across many trades, not one bet) — the 4-sleeve book's edge is diversification.
