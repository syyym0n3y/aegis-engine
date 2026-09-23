# Current opportunities — 2026-09-23

> TREND/momentum WATCHLIST across the global panel — one input family, NOT the deployed book. The deployed book is the
> 5-sleeve blend (leverageable excess ~1.92, D-939e pin): see DEPLOY_RUNBOOK.md / deploy-sheet.ts for what to hold.
> Signal = blended 21/63/126/252d trend, vol-normalised. Target and stop are **2xATR** (D-934: the exit that wins on capital-velocity — caps the tail, frees capital fastest).
> This is the systematic entry/exit for "one trade at a time" — the edge is the DIRECTION + diversification, not the timing.
> DORMANT / paper only. Claude never executes; the operator arms and fills manually.

## LONG (trend up)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDTRY=X | fx | LONG | 5.95 | 48.835899 | £2000 | 40.9535 | 49.01 | 48.66 |
| PBP | etf | LONG | 2.12 | 23.299999 | £2000 | 85.8369 | 23.64 | 22.96 |
| NEAR-USD | crypto | LONG | 1.95 | 4.3526 | £568 | 130.4967 | 5.09 | 3.62 |
| SVXY | etf | LONG | 1.95 | 63.57 | £2000 | 31.4614 | 65.44 | 61.7 |
| ZEC-USD | crypto | LONG | 1.71 | 1614.819946 | £472 | 0.2923 | 1884.99 | 1344.65 |
| SPY | etf | LONG | 1.68 | 773.5 | £2000 | 2.5856 | 787.7 | 759.3 |
| ^GSPC | index | LONG | 1.63 | 7764.640137 | £2000 | 0.2576 | 7900.91 | 7628.37 |
| QUAL | etf | LONG | 1.59 | 222.929993 | £2000 | 8.9714 | 226.99 | 218.87 |

## SHORT (trend down)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDCNY=X | fx | SHORT | 2.53 | 6.7046 | £2000 | 298.3027 | 6.7 | 6.71 |
| ZF=F | rate | SHORT | 1.28 | 104.171875 | £2000 | 19.199 | 103.59 | 104.75 |
| VXX | etf | SHORT | 1.28 | 17.690001 | £1250 | 70.6614 | 16.59 | 18.79 |
| ZT=F | rate | SHORT | 1.27 | 101.84375 | £2000 | 19.6379 | 101.57 | 102.12 |
| USDKRW=X | fx | SHORT | 1.10 | 1351.76001 | £2000 | 1.4796 | 1316.3 | 1387.22 |
| ZN=F | rate | SHORT | 1.09 | 105.890625 | £2000 | 18.8874 | 104.97 | 106.81 |
| MATIC-USD | crypto | SHORT | 0.73 | 0.216415 | £694 | 3206.8017 | 0.2 | 0.24 |
| ZB=F | rate | SHORT | 0.65 | 107.3125 | £2000 | 18.6372 | 105.89 | 108.73 |

## SHORT — going-concern distress (the persistent edge, D-930/931)
164 going-concern 10-Ks filed in the last 90 days. Short the borrowable liquid names (days-to-cover < 5), long IWM,
hold ~126 days or to a profit target; net ~40%/yr on the borrowable subset. Run `goingconcern-borrow.ts` for the current list.

## How to use (the operator's loop)
1. Pick the highest-|signal| trade with favourable conditions, long or short.
2. Enter at market; set the 2xATR profit-target and stop above (the D-934 validated exit).
3. On target or stop, exit and rotate to the next highest-signal setup.
4. Size each trade small (the wallet grows across many trades, not one bet) — the blend's edge is diversification across sleeves, not any one trade.
