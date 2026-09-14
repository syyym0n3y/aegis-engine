# GROWTH TO TARGET — $10 to $1,000,000, computed (D-892)

> The question is "turn a coffee into a million". It is a two-barrier first-passage problem and every input below is
> a Sharpe already measured on this record. Target 100,000x = 11.51 nats.
> The attempt is declared over at a 50% drawdown. Risk-free 4%.

## 1. At the leverage that is actually purchasable

| book | ledger | route | net Sharpe | leverage | growth/yr | P(reach target) | median time |
|---|---|---|---|---|---|---|---|
| the pair: timed ISA basket x survivor-free crypto timed | D-873b/875 | ISA/cash | 1.29 | 1x | 16.4% | 100.00% | 70y |
| the pair: timed ISA basket x survivor-free crypto timed | D-873b/875 | D-880 perp 1x | 0.96 | 1x | 13.1% | 100.00% | 88y |
| the pair: timed ISA basket x survivor-free crypto timed | D-873b/875 | D-880 perp 2x | 0.53 | 2x | 12.5% | 98.69% | 91y |
| the pair: timed ISA basket x survivor-free crypto timed | D-873b/875 | D-880 perp 3x | 0.38 | 3x | 11.0% | 81.53% | 101y |
| timed ISA, class parity, VIX overlay | D-872 | ISA/cash | 0.83 | 1x | 11.8% | 100.00% | 97y |
| timed ISA, class risk parity | D-870 | ISA/cash | 0.76 | 1x | 11.1% | 100.00% | 103y |
| spot crypto timed, long-only | D-871 | ISA/cash | 0.69 | 1x | 15.8% | 99.58% | 72y |
| spot crypto timed, long-only | D-871 | D-880 perp 1x | 0.51 | 1x | 12.2% | 98.55% | 93y |
| spot crypto timed, long-only | D-871 | D-880 perp 2x | 0.28 | 2x | 7.2% | 46.62% | 145y |
| spot crypto timed, long-only | D-871 | D-880 perp 3x | 0.20 | 3x | -1.7% | 3.08% | never |
| diversified TSMOM, 110 assets, OOS | D-863 | ISA/cash | 0.62 | 1x | 9.7% | 100.00% | 118y |
| combined factor book, modern era | D-527/558 | ISA/cash | 0.40 | 1x | 7.5% | 100.00% | 153y |

## 2. At the growth-optimal leverage — the leverage nobody can buy

Full Kelly is `L* = S/sigma`, and substituting it into the growth rate makes the volatility **cancel**:
`g(L*) = rf + S^2/2`. The achievable growth rate is therefore a function of the **Sharpe ratio alone**.

| book | Sharpe | Kelly leverage | g at full Kelly | median time | g at half Kelly | median time |
|---|---|---|---|---|---|---|
| the pair: timed ISA basket x survivor-free crypto timed | 1.29 | 12.9x | 87% | 12.2y | 66% | 16.9y |
| timed ISA, class parity, VIX overlay | 0.83 | 8.3x | 38% | 27.8y | 30% | 37.6y |
| timed ISA, class risk parity | 0.76 | 7.6x | 33% | 32.6y | 26% | 43.8y |
| spot crypto timed, long-only | 0.69 | 3.4x | 28% | 38.6y | 22% | 51.5y |
| diversified TSMOM, 110 assets, OOS | 0.62 | 6.2x | 23% | 46.3y | 18% | 61.1y |
| combined factor book, modern era | 0.40 | 4.0x | 12% | 90.7y | 10% | 113.1y |

## 3. Inverted: the Sharpe required to do it in N years

Since `g(L*) = rf + S^2/2`, the Sharpe needed to reach the target in median time T is `S = sqrt(2*(M/T - rf))`.
This is the floor at **unlimited free leverage**. Any real leverage cap makes it strictly worse.

| target in | growth/yr needed | Sharpe needed (free leverage) | Kelly leverage that implies at 10% vol | on this record? |
|---|---|---|---|---|
| 1 year | 1151% | **4.79** | 48x | no — best measured is 1.29 |
| 3 years | 384% | **2.76** | 28x | no — best measured is 1.29 |
| 5 years | 230% | **2.13** | 21x | no — best measured is 1.29 |
| 10 years | 115% | **1.49** | 15x | no — best measured is 1.29 |
| 20 years | 58% | **1.04** | 10x | **yes — 1.29 measured** |
| 40 years | 29% | **0.70** | 7x | **yes — 1.29 measured** |

## 4. The operator's own targets, inverted

Stated targets become required Sharpes by the same identity. These are floors at unlimited free leverage.

| stated target | growth/yr it implies | Sharpe required | for scale |
|---|---|---|---|
| 100% profit every week | 3604% | **8.49** | beyond the best documented funds (Medallion ~2.5 net) |
| 100% every month | 832% | **4.07** | beyond the best documented funds (Medallion ~2.5 net) |
| 10x in a year | 230% | **2.13** | above any book on this record |
| doubling once a year | 69% | **1.14** | **inside what this record has measured** |

## 5. What this model assumes, stated so it is visible rather than buried

The 70-year and 100-year figures in section 1 assume **the measured edge persists for 70 years**. It will not, and
nothing on this record supports that: the Sharpes above are measured over roughly 6 years, several are era-dependent
(D-873b's pair drops from 1.40 to 0.90 excluding 2020-21), and this programme has retracted results for era
sensitivity before. Read the long horizons as **a statement that the target is out of reach at 1x**, not as a
forecast of the year it arrives. The short horizons in section 2 are the more meaningful ones because they assume
less persistence — and they are the ones that need leverage nobody sells.

The P(reach target) column is high at 1x for the same reason it is uninformative there: with 10% volatility against
a 16% drift, the 50% floor is simply far away. The column earns its keep in the levered rows, where it falls to
3% — and that fall is the whole point: **the leverage that shortens the median also makes the attempt fail outright.**

Sensitivity to where the floor is put, on the best book taken to the highest MEASURED leverage (the pair at 3x perp):

| the attempt is over at | P(reach target) |
|---|---|
| a 10% drawdown — a typical prop-firm rule | 22.6% |
| a 30% drawdown | 58.1% |
| a 50% drawdown | 81.5% |
| a 90% drawdown | 99.6% |

A prop account's ~10% drawdown rule is not a detail — on the SAME strategy it moves the chance of ever getting there
from 82% to 23%. That is the cost of the drawdown rule, and D-807's clock carries the live version of it.

## 6. What binds

At the best Sharpe on this record (**1.29**, D-873b/875) the growth-optimal leverage is **12.9x** and the
resulting growth rate is **87%/yr**, giving a median **12.2 years** to the target.
Every leverage route measured on this record caps out at **3x**, and at 3x the perp route does not deliver 3x the
Sharpe — it delivers **0.16/0.54 = 30%** of it (D-880), because funding scales with notional while edge does not.

So the binding constraint is **not** access to leverage, and chasing leverage is chasing the wrong variable: past
Kelly, more leverage **lowers** the growth rate and raises the chance of hitting the floor first. The binding
constraint is the **Sharpe ratio**, and the gap between 1.29 and the ~1.49 needed for a ten-year run is the mission,
stated as one number.
