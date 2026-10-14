# Current opportunities — 2026-10-14

> TREND/momentum WATCHLIST across the global panel — one input family, NOT the deployed book. The deployed book is the
> 5-sleeve blend (leverageable excess ~1.92, D-939e pin): see DEPLOY_RUNBOOK.md / deploy-sheet.ts for what to hold.
> Signal = blended 21/63/126/252d trend, vol-normalised. Target and stop are **2xATR** (D-934: the exit that wins on capital-velocity — caps the tail, frees capital fastest).
> This is the systematic entry/exit for "one trade at a time" — the edge is the DIRECTION + diversification, not the timing.
> DORMANT / paper only. Claude never executes; the operator arms and fills manually.

## LONG (trend up)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDTRY=X | fx | LONG | 5.95 | 49.362301 | £2000 | 40.5167 | 49.51 | 49.21 |
| AAVE-USD | crypto | LONG | 2.01 | 158.520004 | £649 | 4.0941 | 178.09 | 138.95 |
| PBP | etf | LONG | 1.75 | 23.530001 | £2000 | 84.9979 | 23.75 | 23.31 |
| SVXY | etf | LONG | 1.67 | 65.43 | £2000 | 30.567 | 67.03 | 63.83 |
| IWD | etf | LONG | 1.66 | 254.649994 | £2000 | 7.8539 | 258.41 | 250.89 |
| ^TNX | rate | LONG | 1.56 | 5.24 | £2000 | 381.6794 | 5.42 | 5.06 |
| SB=F | commodity | LONG | 1.46 | 20.76 | £1471 | 70.8574 | 22.18 | 19.34 |
| QUAL | etf | LONG | 1.44 | 227.720001 | £2000 | 8.7827 | 230.87 | 224.57 |

## SHORT (trend down)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDCNY=X | fx | SHORT | 1.83 | 6.6828 | £2000 | 299.2758 | 6.68 | 6.69 |
| ZF=F | rate | SHORT | 1.57 | 103.757813 | £2000 | 19.2757 | 103.12 | 104.4 |
| ZT=F | rate | SHORT | 1.56 | 101.871094 | £2000 | 19.6327 | 101.6 | 102.15 |
| ZN=F | rate | SHORT | 1.38 | 104.875 | £2000 | 19.0703 | 103.63 | 106.12 |
| VXX | etf | SHORT | 1.18 | 16.690001 | £1351 | 80.9467 | 15.82 | 17.56 |
| EURUSD=X | fx | SHORT | 1.13 | 1.118193 | £2000 | 1788.6 | 1.1 | 1.13 |
| ZB=F | rate | SHORT | 1.09 | 103.90625 | £2000 | 19.2481 | 101.42 | 106.39 |
| EURGBP=X | fx | SHORT | 1.04 | 0.84458 | £2000 | 2368.0409 | 0.84 | 0.85 |

## SHORT — going-concern distress (the persistent edge, D-930/931)
164 going-concern 10-Ks filed in the last 90 days. Short the borrowable liquid names (days-to-cover < 5), long IWM,
hold ~126 days or to a profit target; net ~40%/yr on the borrowable subset. Run `goingconcern-borrow.ts` for the current list.

## How to use (the operator's loop)
1. Pick the highest-|signal| trade with favourable conditions, long or short.
2. Enter at market; set the 2xATR profit-target and stop above (the D-934 validated exit).
3. On target or stop, exit and rotate to the next highest-signal setup.
4. Size each trade small (the wallet grows across many trades, not one bet) — the blend's edge is diversification across sleeves, not any one trade.
