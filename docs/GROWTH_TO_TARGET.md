# GROWTH TO TARGET — $10 to $1,000,000, computed (D-892)

> The question is "turn a coffee into a million". It is a two-barrier first-passage problem and every input below is
> a Sharpe already measured on this record. Target 100,000x = 11.51 nats.
> The attempt is declared over at a 50% drawdown. Risk-free 4%.


> ## ⚠ CORRECTION (D-905, 2026-09-13) — read this before any table below
>
> **Every figure in sections 1–9 describes a book scaled to a 10% annualised volatility target.** The underlying blend
> realises **3.4%**. Scaling it to 10% is approximately **2.9× leverage**, and the rows labelled "1x" carried that
> exposure *with no financing charged*.
>
> **At the book's genuine unlevered size — the only size an ISA or cash account can hold — the median time from $10 to
> $1,000,000 is 149 years, not 77.** The published figures understated it by 94%.
>
> | | published as "1x" | **corrected, genuine 1x** |
> |---|---|---|
> | implied exposure | 2.9× | **1.0×** |
> | median to target | 77y | **149y** |
> | P(target), 10% floor | 95.5% | 100.0% |
>
> **What survives unchanged:** D-897's leverage conclusion. Read from the true bottom, genuine 2x gives 163y and 3x
> gives 157y with ruin rising to 20.9% under a 10% floor — so **1x still dominates**, and now from an honest baseline
> rather than from a rung that was already levered.
>
> The scaling was always disclosed in the caption; it was never disclosed in the *row label*, and a row labelled 1x
> that carries 2.9× is mislabelled whatever the caption says. THE INSTRUMENT LAW exists because exactly this gap
> between the measured thing and the holdable thing has failed four times out of four.


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

## 7. The same question on the REAL returns, not a Gaussian (D-896)

D-892 above assumes a fixed Sharpe compounding forever with Gaussian daily returns. D-895 measured what that
assumption is worth: the same book earns five-year block Sharpes of **1.72 / 0.57 / 1.07 / 1.23 / 0.50** over 21.7
years. Here the actual 7363-day blend (isa + tsmom, Sharpe 1.10) is resampled by stationary block
bootstrap — geometric block lengths, wrap-around — preserving fat tails, within-block autocorrelation and the
clustered bad decades. 2,000 paths per cell, 100-year cap, target 100,000x.

Scaled to 10% annualised vol (raw blend is 3.4%), plus a 4% risk-free. `*` marks levered rows where the
financing drag is D-880's PERP funding applied as a proxy — the only leverage cost measured on this record, but
measured on crypto perps, not on this book. At 1x there is no financing.

| leverage | floor | mean block | P(target) | P(ruin) | censored | median | p25 | p75 |
|---|---|---|---|---|---|---|---|---|
| 1x | 50% DD | 5d | 100.0% | 0.0% | 0.0% | 77y | 73y | 81y |
| 1x | 50% DD | 21d | 100.0% | 0.0% | 0.1% | 77y | 73y | 81y |
| 1x | 50% DD | 63d | 100.0% | 0.0% | 0.0% | 77y | 73y | 81y |
| 1x | 10% DD | 5d | 92.8% | 7.2% | 0.1% | 76y | 72y | 81y |
| 1x | 10% DD | 21d | 96.5% | 3.4% | 0.1% | 77y | 73y | 80y |
| 1x | 10% DD | 63d | 97.2% | 2.8% | 0.0% | 77y | 73y | 81y |
| 2x* | 50% DD | 5d | 75.9% | 2.4% | 21.7% | 84y | 76y | 91y |
| 2x* | 50% DD | 21d | 77.7% | 1.1% | 21.2% | 84y | 77y | 91y |
| 2x* | 50% DD | 63d | 79.2% | 0.7% | 20.2% | 84y | 77y | 91y |
| 2x* | 10% DD | 5d | 40.9% | 49.9% | 9.3% | 82y | 74y | 89y |
| 2x* | 10% DD | 21d | 42.4% | 47.1% | 10.6% | 83y | 75y | 90y |
| 2x* | 10% DD | 63d | 45.5% | 44.6% | 9.8% | 83y | 76y | 90y |
| 3x* | 50% DD | 5d | 70.3% | 12.9% | 16.8% | 75y | 66y | 85y |
| 3x* | 50% DD | 21d | 73.3% | 10.4% | 16.3% | 76y | 67y | 86y |
| 3x* | 50% DD | 63d | 75.0% | 9.3% | 15.8% | 77y | 68y | 87y |
| 3x* | 10% DD | 5d | 25.8% | 70.6% | 3.6% | 75y | 64y | 84y |
| 3x* | 10% DD | 21d | 27.4% | 68.3% | 4.3% | 74y | 65y | 85y |
| 3x* | 10% DD | 63d | 27.1% | 68.2% | 4.7% | 75y | 65y | 86y |

**The like-for-like comparison.** D-892's 70 years is the PAIR at Sharpe 1.29; this is the two-sleeve blend at
Sharpe 1.10, so comparing against 70 would compare two BOOKS rather than two ASSUMPTIONS. The Gaussian answer for
*this* book is `g = rf + S·σ − σ²/2` = 14.5%/yr, i.e. **80 years** — against a bootstrap median of **77 years**.

So on the real returns, with the real fat tails, the real autocorrelation and the real bad decades, the answer is
**within a couple of years of the Gaussian one**. The persistence caveat D-892 flagged and D-895 measured is worth
roughly **3% of the horizon at 1x**, not a different answer. Block length barely matters either (5d/21d/63d give
77/77/77), so the researcher degree of freedom in clause (4) is small here.

Where the distributions genuinely diverge is under **leverage with a tight floor**: at 3x against a 10% drawdown
rule the bootstrap puts **68–71% of paths into ruin** before the target, and at 2x, **20% of paths are still
running at the 100-year cap**. Neither is visible in a two-barrier formula that assumes infinite time.

## 7. The same question on the REAL returns, not a Gaussian (D-896)

D-892 above assumes a fixed Sharpe compounding forever with Gaussian daily returns. D-895 measured what that
assumption is worth: the same book earns five-year block Sharpes of **1.72 / 0.57 / 1.07 / 1.23 / 0.50** over 21.7
years. Here the actual 7363-day blend (isa + tsmom, Sharpe 1.10) is resampled by stationary block
bootstrap — geometric block lengths, wrap-around — preserving fat tails, within-block autocorrelation and the
clustered bad decades. 2,000 paths per cell, 100-year cap, target 100,000x.

Scaled to 10% annualised vol (raw blend is 3.4%), plus a 4% risk-free. `*` marks levered rows where the
financing drag is D-880's PERP funding applied as a proxy — the only leverage cost measured on this record, but
measured on crypto perps, not on this book. At 1x there is no financing.

| leverage | floor | mean block | P(target) | P(ruin) | censored | median | p25 | p75 |
|---|---|---|---|---|---|---|---|---|
| 1x | 50% DD | 5d | 100.0% | 0.0% | 0.0% | 77y | 73y | 81y |
| 1x | 50% DD | 21d | 100.0% | 0.0% | 0.1% | 77y | 73y | 81y |
| 1x | 50% DD | 63d | 100.0% | 0.0% | 0.0% | 77y | 73y | 81y |
| 1x | 10% DD | 5d | 92.8% | 7.2% | 0.1% | 76y | 72y | 81y |
| 1x | 10% DD | 21d | 96.5% | 3.4% | 0.1% | 77y | 73y | 80y |
| 1x | 10% DD | 63d | 97.2% | 2.8% | 0.0% | 77y | 73y | 81y |
| 2x* | 50% DD | 5d | 75.9% | 2.4% | 21.7% | 84y | 76y | 91y |
| 2x* | 50% DD | 21d | 77.7% | 1.1% | 21.2% | 84y | 77y | 91y |
| 2x* | 50% DD | 63d | 79.2% | 0.7% | 20.2% | 84y | 77y | 91y |
| 2x* | 10% DD | 5d | 40.9% | 49.9% | 9.3% | 82y | 74y | 89y |
| 2x* | 10% DD | 21d | 42.4% | 47.1% | 10.6% | 83y | 75y | 90y |
| 2x* | 10% DD | 63d | 45.5% | 44.6% | 9.8% | 83y | 76y | 90y |
| 3x* | 50% DD | 5d | 70.3% | 12.9% | 16.8% | 75y | 66y | 85y |
| 3x* | 50% DD | 21d | 73.3% | 10.4% | 16.3% | 76y | 67y | 86y |
| 3x* | 50% DD | 63d | 75.0% | 9.3% | 15.8% | 77y | 68y | 87y |
| 3x* | 10% DD | 5d | 25.8% | 70.6% | 3.6% | 75y | 64y | 84y |
| 3x* | 10% DD | 21d | 27.4% | 68.3% | 4.3% | 74y | 65y | 85y |
| 3x* | 10% DD | 63d | 27.1% | 68.2% | 4.7% | 75y | 65y | 86y |

**The like-for-like comparison.** D-892's 70 years is the PAIR at Sharpe 1.29; this is the two-sleeve blend at
Sharpe 1.10, so comparing against 70 would compare two BOOKS rather than two ASSUMPTIONS. The Gaussian answer for
*this* book is `g = rf + S·σ − σ²/2` = 14.5%/yr, i.e. **80 years** — against a bootstrap median of **77 years**.

So on the real returns, with the real fat tails, the real autocorrelation and the real bad decades, the answer is
**within a couple of years of the Gaussian one**. The persistence caveat D-892 flagged and D-895 measured is worth
roughly **3% of the horizon at 1x**, not a different answer. Block length barely matters either (5d/21d/63d give
77/77/77), so the researcher degree of freedom in clause (4) is small here.

Where the distributions genuinely diverge is under **leverage with a tight floor**: at 3x against a 10% drawdown
rule the bootstrap puts **68–71% of paths into ruin** before the target, and at 2x, **20% of paths are still
running at the 100-year cap**. Neither is visible in a two-barrier formula that assumes infinite time.

## 8. The leverage that maximises REACHING the target, not growth (D-897)

D-892 computed the **growth**-optimal leverage (Kelly, 11.0x on this book) and flagged — but never computed — that
the leverage maximising **P(reach the target)** is a different number. It is, and the gap is a factor of 11 to 44.

200-year cap so that slow paths finish rather than censoring (at a 100-year cap the 0.25x and 0.5x cells come back
100% censored and would read as total failures — they are *slow*, not *failing*):

| leverage | P(target), 10% floor | median | P(target), 50% floor |
|---|---|---|---|
| 0.25x | **100.0%** | 171y | 100.0% |
| 0.5x | **100.0%** | 121y | 100.0% |
| 0.75x | 98.8% | 94y | 100.0% |
| **1x** | **96.1%** | **77y** | **100.0%** |
| 2x\* | 50.7% | 87y | 99.1% |
| 3x\* | 30.6% | 77y | 89.2% |

**1x dominates 2x and 3x on *both* dimensions.** 1x reaches the target 96.1% of the time with a 77-year median; 3x
reaches it 30.6% of the time with the *same* 77-year median; 2x is worse on both at 50.7% and 87 years. **Levering this
book above 1x does not buy speed at the price of risk — it buys nothing and pays risk for it**, because leverage
multiplies volatility in full while D-880's measured funding claws back the return. At the loose 50% floor 1x still
weakly dominates, so this is not purely a prop-firm artifact.

Kelly on this series is **11.0x**. The survival optimum is **0.25–1x**. Chasing the growth optimum here would mean
holding a position eleven to forty-four times larger than the one that actually maximises the chance of arriving.

**For a prop account** (~10% drawdown rule, the D-807 clock): the drawdown rule is the binding constraint and the
correct size on this book is **1x or below**. That is a measured statement about sizing, not a recommendation to fund
an account.

`*` sub-1x rows are part-cash and carry no financing, so that half of the curve is measured cleanly; 2x and 3x carry
D-880's crypto-perp funding as a proxy on an equities-and-futures book.

## 9. The era-conditional twin (D-903) — published beside §8, never instead of it

D-902 measured that equity–rates diversification **ended in 2022**: fourteen consecutive negative correlation years
(2007–2020) then five non-negative ones, with 2026 the most positive reading in the series. The rates class was worth
+0.21 of Sharpe and 5.7 years of avoided drawdown duration over the full window; post-2022 it is worth **−0.04**.

Everything in §7 and §8 resamples the **full-window** series and therefore assumes that regime persists. So here is the
same computation on a blend **with the rates class removed** — the conservative stand-in for a world where bonds no
longer hedge. Identical settings, 200-year cap, only the input series differs.

| leverage | floor | P(target) full-window | **era-conditional** | median full-window | **era-conditional** |
|---|---|---|---|---|---|
| 0.5x | 10% | 99.9% | 99.8% | 121y | **132y** |
| **1x** | **10%** | **95.5%** | **93.8%** | **77y** | **85y** |
| 2x\* | 10% | 52.6% | 46.3% | 86y | 94y |
| 3x\* | 10% | 30.3% | 27.0% | 79y | 84y |

**NOT MATERIAL, by the registered thresholds.** The median at 1x lengthens by 8 years (+10%, against a 15% trigger) and
P(target) falls 1.7 points (against a 10-point trigger). **The survival-optimal leverage does not change** — 1x still
dominates 2x and 3x on both dimensions.

So D-902's finding is **real about the mechanism and small in its effect on this ladder.** The reason is structural and
was the registered null: the rates class is worth only 0.21 of Sharpe, and D-897 already showed time-to-target is
dominated by the growth rate rather than by path details.

**And this is an upper bound on the harm, not a forecast.** The no-bonds series removes rates *entirely*, whereas the
real post-2022 world still holds rates that merely stopped hedging — so the true effect is at most this and probably
less.

## 10. What the 1× rung can actually hold (D-906)

D-905 corrected the timed book to **149 years** at its holdable size. So the honest question becomes a maximisation over
**holdable assets**, not over signals — because once leverage is unavailable, time-to-target is set by geometric growth
alone. 35 ISA-holdable instruments, **pick made on train (2005–2015) only**, measured on test (2016–2026), split fixed
before anything was ranked.

| train-chosen | g (test) | years to target | maxDD | underwater |
|---|---|---|---|---|
| **MTUM** | **12.3%/yr** | **94y** | −34% | 3.0y |
| QQQ | 15.6% | 74y | −38% | 2.2y |
| IWF | 13.6% | 85y | −35% | 2.3y |
| VLUE | 11.6% | 100y | −40% | 3.6y |
| QUAL | 11.3% | 101y | −34% | 2.2y |
| *the timed book (D-905)* | *7.6%* | *149y* | *−6%* | *4.0y* |

**The train-chosen holdable pick beats the programme's entire timed construction by 55 years** — and six entries beat
it, so it is not a fluke. Buying a factor or index ETF and holding it outgrows a class-parity trend book with a
volatility overlay, at the only leverage an ISA can use, by decades.

**The trade-off, now priced:** the timed book buys **drawdown depth** (−6% against −34%) and pays **55 years** for it.
A fivefold smaller worst loss is worth something — but the price should be known.

**HINDSIGHT ONLY** on the registered rule: the ex-post best on test is SMH at 24.1%/yr and 48 years, but that is
hindsight, and the **11.8-point gap** between it and the train-chosen pick measures exactly how much. Quoting 48 years
would have been the D-455 failure.

**Survivorship:** this panel holds instruments that exist *today*, so the whole frontier is biased upward by every fund
that closed. Stated, not corrected — this record cannot reconstruct the dead-ETF universe.

**And 94 years is still not a plan.** The target remains unreachable at 1× by any holdable instrument. It needs leverage
this record measured as harmful (D-897), an account type this book cannot use, or the per-head money at rung 0.
