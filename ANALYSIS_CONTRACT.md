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


## THE EFFECT-SIZE LAW (2026-08-21) — binds every "we found something"
**A significance test answers "is it there". Only effect size measured in MULTIPLES OF THE ROUND-TRIP COST answers "is it
worth acting on". No signal is reported as an edge without that number.**
Origin: D-426, perp order flow — the most statistically convincing result this program has produced. Residual aggressor
imbalance had rank IC negative on **20 of 20 instruments** (P ~ 2e-6 under the null), |t| to 4.9, holding out-of-sample, on
BTCUSDT clearing **$523M per hour** — capacity was emphatically not the constraint. Effect size: **0.02x-0.14x the maker
round-trip fee.** The same data gives OLS |t| < 1.3, because in fat-tailed hourly returns a RANK statistic orders the 99%
of small moves that carry no money while the money sits in a tail where the relationship is absent.
Rules: (1) every reported signal states bp-of-expected-return per 1sd of signal, beside the round-trip cost it must beat;
(2) **rank IC on fat-tailed high-frequency data is NOT evidence of tradability** — pair it with an OLS/mean effect, and if
the two disagree, the mean one decides; (3) an effect below 1.0x its cost is recorded as SUB-FEE, never as an edge;
(4) enforced by `scripts/effect-size-guard.ts` (verified RED on sub-fee, RED on significance-without-magnitude, PASS on
compliant, exit-code-checked both directions).


## THE BREADTH LAW (2026-08-22) — binds every cross-sectional result
**A cross-sectional statistic computed on a thin universe is a statement about a few names, not about a factor. Report
breadth beside every cross-sectional Sharpe; treat any cross-section under ~50 names as UNTESTED, not as evidence.**
Origin: three separate concentration artifacts. D-415 — funding crowding, IC 0.1404 at t 38.35, a POOLING artifact across
180 heterogeneous perps, retracted in full. D-423 — score-weighted construction showing 72.1%/yr at SR 1.49 from ~160 names
normalised to gross 2, flagged as concentration rather than alpha. D-443 — crypto momentum at 94.2%/yr, SR 1.13, alpha
t 2.93, computed on **fourteen** perps, where quintiles mean 3 long and 3 short; at 162-name breadth the identical rule
gives **SR 0.34, t 0.86**. In all three the t-stat was large and the number was not real.
Rules: (1) every cross-sectional result states the mean number of names per rebalance; (2) under ~50 names the verdict is
UNTESTED; (3) when a result is large, EXPAND BREADTH before believing it — that test is cheaper than the retraction;
(4) survivorship and breadth are different problems and must be fixed separately (in D-443 the survivorship effect was
small and POSITIVE at +5.2pp while breadth accounted for the entire collapse); (5) enforced by `scripts/breadth-guard.ts`
(verified RED on a thin cross-section, RED on one that never states breadth, PASS on a broad one, exit-code-checked).


## THE EXECUTION LAW (2026-08-22) — binds every result that leans on passive fills
**A maker/limit-order fee is not a cost model. It is a HYPOTHESIS ABOUT FILLS, and it must be tested by measuring the
return CONDITIONAL ON FILLING.**
Origin: D-445/447 produced the strongest candidate this program has found — the 20:00-22:00 UTC perp window, ranked #1 of
22 possible 2-hour windows, 3.61sd above a typical one, drift-neutral excess 7.83bp at **t 10.92 with 14 of 14 symbols
agreeing**, positive in three of four eras. It failed at taker fees (0.87x) and cleared at maker fees (2.17x), so the
entire verdict rested on the maker assumption. Measured on 5-minute bars that assumption was FALSE:

| | BTCUSDT | ETHUSDT |
|---|---|---|
| passive fill rate | 92% | 91% |
| return, ALL days | +3.81bp | +5.91bp |
| **return on days FILLED** | **−1.85bp** | **−2.80bp** |
| return on days NOT filled | +68.18bp | +96.53bp |
| net at maker on filled days | −1.51x the fee | −1.78x the fee |

You are filled when the market comes back to you — which is exactly when the move is not happening. The entire positive
return lived in the days the order never filled.
Rules: (1) quoting an all-days return beside a maker fee is invalid — it assumes the fill is independent of the outcome,
and it never is; (2) any result whose viability depends on passive execution is **UNTESTED** until its fill-conditional
return is measured; (3) report the fill RATE and the return on filled days, not just the average; (4) enforced by
`scripts/execution-guard.ts` (verified RED on a maker assumption with no fill study, PASS on one with a measured
fill-conditional return, and correctly EXEMPT for taker-costed results — a negation-handling flaw found by its own
self-test, where "no passive assumption" tripped a naive keyword match).


## THE SELECTION LAW (2026-08-22) — binds every result that CHOOSES among components
**Choosing which components to keep using the full sample, and then reporting an out-of-sample number on that choice, is
not out of sample. The choice must be made on train only, frozen, and applied forward.**
Origin: D-455. The combined book reported that overlaying trend SELECTIVELY — only on classes where it measured positive —
recovered OOS Sharpe from 0.00 to **0.37**, concluding that selectivity was "worth ~0.37 of Sharpe". The class set was
hardcoded from a FULL-SAMPLE measurement and applied across the OOS window. Re-made on TRAIN ONLY, the overlay was negative
in **every** class (equity −22.0pp, commodity −8.8pp, sector −4.6pp, index −3.5pp, etf −1.7pp, fx −0.9pp) — **no class
qualified**, and the "selective" book collapsed exactly onto the passive book it was supposed to beat.
This leak is invisible to every other guard: the returns were computed correctly, the train/test split was real, and no
future price was touched. What leaked was WHICH COMPONENTS TO KEEP.
Rules: (1) any pick among classes, symbols, parameters or variants is declared with the window it was made on; (2) a pick
made on the full sample makes the result IN-SAMPLE, whatever the split says; (3) when a "selective" version beats a blanket
one, re-make the selection on train before believing the difference — that test is cheaper than the retraction;
(4) enforced by `scripts/selection-guard.ts` (verified RED on a full-sample pick, PASS on a train-only pick, and exempt
where nothing is chosen — a negation flaw caught by its own self-test, exactly as the execution guard's was).
