# ANALYSIS_CONTRACT — binds every analysis in this repo (added 2026-08-04)

> Written because across D-100..D-120 the assistant made three repeatable errors the operator had to
> catch. This contract is not "try harder" (that fails). It is a set of rules each tied to a specific
> failure, checked at the point of every claim. CLAUDE.md loads this every session. A conclusion that
> violates a rule is a self-caught breach — stop and fix before presenting.

## The failures this prevents (real, from this repo)
- **F1 — bias by mood.** Swung between "make a shit ton" and "no edge." Sentiment substituted for evidence.
- **F2 — approximation sold as result.** Covered-call CAGR reported +13.2% (real CBOE ^BXM: 7.3%);
  funding-carry shown −20% from a phantom-cost bug; "combine → Sharpe ~1, leverage 2-3x safely" (real
  premia book: Sharpe 0.5, 3x = 99% drawdown = ruin).
- **F3 — claim before build.** Forward projections stated as fact, then refuted by the actual backtest.

## The rules (non-negotiable)

1. **The number is the verdict — no sentiment.** Never label a result "promising / great / dead / no-edge /
   best-yet / breakthrough." State the metric + its **N** + **in-sample vs out-of-sample** + **deflation**,
   and stop. Any characterization must be a literal restatement of the number ("+0.11R over 110 OOS trades,
   below the +0.4R bar"), never a mood. If a sentence conveys excitement or defeat rather than a measurement,
   delete it. (kills F1)

2. **Real data beats approximation — always. Label every estimate.** Never present a proxy/approximation
   (Black-Scholes shortcut, synthetic index, assumed trade frequency, "should be") as a result. Pull the
   REAL series first (CBOE ^BXM/^PUT, actual index/track record) and conclude from it. Anything not from
   real data is prefixed **"ESTIMATE — unvalidated"** and must be validated before it informs any decision. (kills F2)

3. **Build before you claim.** No forward statement about what a strategy WILL do ("combining lifts Sharpe
   to ~1", "leverage 2-3x is safe") until it is built and tested. Until then it is a **hypothesis**, labeled
   as such, never asserted as fact. Projections are guesses; guesses are marked. (kills F3)

4. **N + OOS + deflation gate every edge.** No config/cell is called an edge (even tentatively) without a
   stated minimum sample, an out-of-sample result, and trial-count deflation. Small-N standout numbers are
   labeled **NOISE** explicitly, never highlighted as candidates.

5. **Reconcile before concluding.** Before any conclusion, check it against prior DECISIONS.md verdicts.
   A contradiction with an earlier finding must be surfaced and resolved in the same message — never a
   silent swing. Consistency over convenience.

6. **Self-audit before presenting analysis.** Before sending results, verify: (a) every verdict has its
   number+N+OOS; (b) no approximation is unlabeled; (c) no forward claim is unbuilt; (d) no small-N cell is
   sold; (e) it reconciles with prior decisions. If any fails, fix before sending.

## The one line that covers it all
**Report the measurement, not the feeling. Real over approximate. Built over projected. Consistent over
convenient.** The operator does not want bias — he wants the number and its uncertainty, stated plainly.
