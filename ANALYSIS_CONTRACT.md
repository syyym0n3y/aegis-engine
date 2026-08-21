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

## Rule 7 — the RANDOM-CONTROL gate (added 2026-08-06, D-146; paid for in full)

**No conditional expectancy may be called an edge until it beats a MATCHED RANDOM-ENTRY control.**
Match on: same instrument, same regime/condition, same direction, same stop/target mechanics. Require the
Welch t of (setup − control) ≥ 2 via `_shared/trd-random-control.ts` `edgeVsRandom()` (fails closed on N<30).

Why this is now Rule 7: four candidates (D-144/145) reached +0.08…+0.32R OOS expectancy, survived
regime-dependent costs, survived era walk-forward, and were formally pre-registered — and ALL FOUR were then
shown to be **regime drift, not setups**: none beat a random entry in the same regime (all |t|<2, half were
worse than random), and the headline stress-short was positive in **0 of 50** instruments. In calm VIX a
*random* long earns +0.15–0.25R. Any "setup" measured without this control is measuring the market's drift
and calling it skill. This gate is machine-enforced and unit-tested; it must never be bypassed.

## Rule 8 — NEVER conclude from an aggregate; disaggregate to see, deflate to believe (added 2026-08-17, D-334)

**An aggregate is a projection that can hide the opposite of what it shows.** D-332 called funding-carry
"IC-null" from a POOLED number (t=−1.54); D-333 disaggregated by higher-timeframe regime and found a
significant, sign-correct, horizon-strengthening signal (72h t=−2.72) that the pool had cancelled to zero.
The pooled conclusion was not just weak — it was **wrong in direction**. A single averaged number is the
laziest possible read and is forbidden as a verdict.

**The doctrine (operator-locked, binds every analysis):**
1. **No verdict from a pooled/averaged statistic — ever.** A factor, edge, or strategy is judged on its
   DISAGGREGATED grid, not one number. Minimum cuts before any verdict: **per-symbol/instrument · per-regime ·
   per-timeframe (MTF, D-333) · per-epoch (walk-forward era)**. The pool is reported ONLY as a footnote to the
   grid, never as the headline. If the only evidence offered is an aggregate, the analysis is incomplete —
   go back and cut it.
2. **Disaggregate exhaustively — this is the machine's advantage over a human.** A person eyeballs the average
   and stops; the engine can slice every conditioning dimension and must. "Looks null on average" is never a
   stopping point — it is the signal to cut deeper, because opposite-signed sub-populations cancel.
3. **The mandatory partner: deflate + OOS, or it is data-mining.** Exhaustive disaggregation WILL surface
   structure in pure noise. So every cut multiplies the trial count (`trd_trial_counter`), every disaggregated
   cell carries its N and deflated significance, and a cell is believed ONLY after out-of-sample / walk-forward
   confirmation. Disaggregate to DISCOVER; deflate + OOS to BELIEVE. A significant slice without its deflation
   and OOS is NOISE, labeled as such (this is Rule 4 applied to slices).
4. **Coherence across cells outranks a single low p-value.** A lead is trusted when disaggregated cells agree
   in a mechanistically-sensible way (same sign across a regime family, monotone in horizon) — that pattern is
   far stronger evidence than one isolated t past the bar, and far harder for noise to fake.

The one line: **the average is where signal goes to hide — cut it apart, then make every piece earn belief.**


---

## THE COVERAGE LAW (added 2026-08-21 after a grave failure — binds every analysis, forever)

**A null result is evidence about the MARKET only if the data was adequate to detect the effect. Otherwise it is evidence
about our DATA.** Absence of data is not evidence of absence.

### The failure this exists to prevent
Aegis ran ~45 tests and reported a program-wide conclusion that documented premia were absent — while holding **five** EDGAR
fundamental concepts out of the hundreds available. Accruals (Sloan 1996, one of the most robust anomalies ever documented),
cash-flow-to-price, gross profitability and net-operating-assets were never tested **because the data was never fetched**.
The absence of findings was then narrated as a property of markets. That inverted the burden of proof and would have closed
the research program on a false premise.

### The law, operationally
1. **No null verdict without a coverage statement.** Every negative/null result MUST report the data that produced it:
   instruments, observations, date span, and the specific inputs required by the hypothesis. A null without coverage is
   reported as **"UNTESTED — insufficient data"**, never as "no effect".
2. **Check the input before blaming the market.** Before writing any null, ask explicitly: *is the required input actually
   loaded?* If a factor needs a concept/field we do not hold, the verdict is UNTESTED, not NULL.
3. **Underpowered is its own verdict.** If n is below the floor for the effect size claimed by the literature, say
   UNDERPOWERED and state what n would be needed. (Applied correctly in D-391: 26 settlements -> "underpowered, not disproven".)
4. **Free data unfetched is a research failure, not a market finding.** Any Tier-1 gap in docs/RESEARCH_GAPS.md invalidates a
   program-level efficiency claim until it is closed.
5. **Enforced by machine, not memory:** `scripts/coverage-guard.ts` measures live coverage against the declared requirement of
   every factor family and exits RED when a verdict rests on inadequate data. Documented is not enforced; the guard is.


## THE LIQUIDITY LAW (2026-08-21) — binds every promotion
**A cross-sectional result is a claim about a TRADABLE strategy only if the edge survives in the LIQUID tercile. Otherwise it
is a claim about names that cannot absorb size.**
Origin: two independent panels reached it by different routes — D-419 (price/volume, 367 months) and D-423 (fundamentals,
103 months). Headline returns of 11-19%/yr decomposed into liq:LOW 20-40%/yr and **liq:HIGH 0.9-5.7%/yr (SR 0.04-0.26)** —
i.e. nothing where size can actually go. Every strong cross-sectional number this program has produced has had this shape.
Rules: (1) no strategy number is reported without its liquidity decomposition; (2) the promotable number is the LIQUID
tercile's, never the pooled one; (3) a headline whose edge vanishes above the liquidity floor is recorded as CAPACITY-BOUND,
not as an edge; (4) enforced by `scripts/liquidity-guard.ts` — no lineage row may sit in a promoted state without a recorded
liquid-tercile Sharpe clearing the floor (verified RED on a below-floor row, RED on a row that never states one, PASS on a
compliant row, and exit-code-checked in both directions).
