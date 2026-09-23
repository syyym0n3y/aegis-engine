> **ARCHIVED 2026-09-23 (D-970, audit).** This page is built on a superseded era of the record (pre-5-sleeve, ~0.45-1.60 Sharpe arithmetic, or a register that now lives in trd_gap_register). Current truth: docs/BIG_PICTURE.md + docs/DEPLOY_RUNBOOK.md + the D-939e leverageable pin (~1.92).
# WEEKLY PAYOFF — what "100% per week" means in arithmetic, and what the record can actually deliver per week (D-878, 2026-09-13)

> Operator target: extract at least 100% profit on investment at the end of every week, with multiple positions across
> instruments, and control the risk. This page does not argue with the target; it converts it into the two numbers any
> book is made of — Sharpe and volatility — and puts the measured record beside it.

## 1. The arithmetic
A weekly return r_w compounds to (1+r_w)^52 per year. **100%/week is 2^52 ≈ 4.5 × 10^15 per year.** No leverage on any
measured Sharpe produces it: at a weekly Sharpe of S_w and weekly vol σ_w the expected weekly return is S_w·σ_w, and a
book run at σ_w = 100%/week has a one-week drawdown distribution whose 5th percentile is ≈ −165%. **A 100%/week target
is ruin, not risk.** The honest question is: what weekly return does the best measured book give at a survivable vol?

| pair (D-873b/875), Sharpe 1.29 | book vol | expected %/week | %/yr | maxDD (history) | weeks in worst drawdown |
|---|---|---|---|---|---|
| | 10% | 0.25 | 12.9 | −17% | ~90 |
| **20%** | | **0.50** | **25.8** | **−33%** | ~90 |
| 30% | | 0.74 | 38.7 | −50% | ~90 |
| 40% | | 0.99 | 51.6 | −67% | ~90 |

**At 20% vol the pair pays about half a percent a week on average**, and at 40% about one percent a week with a
two-thirds drawdown. "Multiple positions" is already in these numbers: the pair is 51 ETFs across four classes plus
469 crypto contracts; adding *more* positions raises Sharpe only if they are uncorrelated, and every other sleeve
measured (carry, value, hourly set-ups) is dead or zero-gross.

## 2. The risk control that exists as a machine, not a sentence (D-878)
`scripts/trend-paper.ts` carries `pair20g`: the pair at a 20% vol target from trailing 60-day vol, gross leverage capped
at 3×, with a drawdown governor — exposure halves below −15% from the governed equity peak and quarters below −25%,
restoring in steps as the peak is regained. It is scored daily under the D-873 clock. Its history (D-878): Sharpe 1.27 vs 1.29 un-governed, maxDD −15% vs −33%, return 11% vs 26%/yr — the 3× cap binds because
20% vol on this pair means 6.7× leverage. **The binding constraint is access to leverage, not risk:** at 1× (an ISA) the pair is
~4–5% vol and about 0.1%/week.

**Every leverage route measured (D-866/878/880):** ISA 1× only; CFD financing negative; perps at 2× halve the Sharpe. The
rows above 10% vol are arithmetic, not access.

## 3. What would raise the weekly number honestly
Only a higher Sharpe: uncorrelated sleeves that survive (the release-hour study D-877 is the first non-price candidate),
or execution-side edges never measured. Leverage cannot; it moves return and drawdown together.

