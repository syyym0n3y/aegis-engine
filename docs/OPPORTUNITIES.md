# Current opportunities — 2026-09-16

> What the validated 4-sleeve book (D-932, Sharpe 1.60) says to trade NOW, both directions, across the global panel.
> Signal = blended 21/63/126/252d trend, vol-normalised. Target and stop are **2xATR** (D-934: the exit that wins on capital-velocity — caps the tail, frees capital fastest).
> This is the systematic entry/exit for "one trade at a time" — the edge is the DIRECTION + diversification, not the timing.
> DORMANT / paper only. Claude never executes; the operator arms and fills manually.

## LONG (trend up)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDTRY=X | fx | LONG | 5.67 | 48.586449 | £2000 | 41.1637 | 48.78 | 48.39 |
| PBP | etf | LONG | 1.66 | 23.299999 | £2000 | 85.8369 | 23.58 | 23.02 |
| SVXY | etf | LONG | 1.60 | 62.610001 | £2000 | 31.9438 | 64.33 | 60.89 |
| ^TNX | rate | LONG | 1.15 | 4.961 | £2000 | 403.1445 | 5.09 | 4.84 |
| SB=F | commodity | LONG | 1.07 | 19.059999 | £1613 | 84.6275 | 20.53 | 17.59 |
| ZEC-USD | crypto | LONG | 1.05 | 1146.199951 | £500 | 0.4362 | 1365.63 | 926.77 |
| CT=F | commodity | LONG | 1.02 | 85.040001 | £1724 | 20.2728 | 89.81 | 80.27 |
| XBI | etf | LONG | 1.02 | 157.600006 | £1724 | 10.9391 | 165.02 | 150.18 |

## SHORT (trend down)
| symbol | class | dir | signal | px | £size | units | profit-target | stop |
|---|---|---|---|---|---|---|---|---|
| USDCNY=X | fx | SHORT | 2.19 | 6.7075 | £2000 | 298.1737 | 6.7 | 6.71 |
| ZF=F | rate | SHORT | 1.31 | 104.398438 | £2000 | 19.1574 | 103.77 | 105.03 |
| ZT=F | rate | SHORT | 1.23 | 102.042969 | £2000 | 19.5996 | 101.75 | 102.34 |
| ZN=F | rate | SHORT | 1.17 | 105.984375 | £2000 | 18.8707 | 105.03 | 106.94 |
| VXX | etf | SHORT | 1.13 | 18.23 | £1163 | 63.7959 | 17.22 | 19.24 |
| USDKRW=X | fx | SHORT | 1.06 | 1344.150024 | £2000 | 1.4879 | 1318.05 | 1370.25 |
| SAND-USD | crypto | SHORT | 0.99 | 0.0353 | £877 | 24844.1926 | 0.03 | 0.04 |
| SNX-USD | crypto | SHORT | 0.89 | 0.21142 | £1087 | 5141.4247 | 0.19 | 0.23 |

## SHORT — going-concern distress (the persistent edge, D-930/931)
164 going-concern 10-Ks filed in the last 90 days. Short the borrowable liquid names (days-to-cover < 5), long IWM,
hold ~126 days or to a profit target; net ~40%/yr on the borrowable subset. Run `goingconcern-borrow.ts` for the current list.

## How to use (the operator's loop)
1. Pick the highest-|signal| trade with favourable conditions, long or short.
2. Enter at market; set the 2xATR profit-target and stop above (the D-934 validated exit).
3. On target or stop, exit and rotate to the next highest-signal setup.
4. Size each trade small (the wallet grows across many trades, not one bet) — the 4-sleeve book's edge is diversification.
