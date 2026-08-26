# CLAUDE.md — Aegis (CC trading vertical)

> **Governed by Command Centre.** This is a new CC vertical in its OWN repo + OWN
> Supabase project, deliberately blast-radius-isolated from YGS so a trading
> kill-switch bug can never touch the YouTube factory. CC keeps oversight +
> Architect veto. The global `~/.claude/CLAUDE.md` Hard Rules bind here in full
> (sequential cost-bearing calls, endpoint allowlist, cost confirmation,
> honest-advisor protocol).

## The one-paragraph thesis

This is **not a trading bot. It is a falsification engine that is allowed to
trade only after it has repeatedly tried and failed to disprove an edge.** The
only component with near-certain positive expected value is the risk gate. Every
signal (congressional, Form-4, 13F, SMC) is — on the peer-reviewed evidence —
crowded, lagged, or capacity-bound. The base rate is brutal (~97% of retail
lose; <1% beat fees over 15y). So the system's default verdict on any strategy
is REJECT, and **the most likely terminal state is "nothing cleared the gates" —
which is a SUCCESS of the engine, not a failure.** See [`DECISIONS.md`](./DECISIONS.md) D-070.

## Session-resume protocol — read in order

0. [`ANALYSIS_CONTRACT.md`](./ANALYSIS_CONTRACT.md) — **binds every analysis: report the measurement not
   the feeling; real over approximate; built over projected; consistent over convenient.** No bias by mood.
0b. [`OPERATING_DOCTRINE.md`](./OPERATING_DOCTRINE.md) — **research before you defer (never claim
   impossible/paid without a verified search); prove before you claim; scale the product not the promise;
   free-first, paid-on-ROI.** Proactivity + trust + growth/scale doctrine.
1. [`STATE.md`](./STATE.md) — current live state, what's built, what's blocked.
2. [`NEXT.md`](./NEXT.md) — the Stage-1 work queue.
3. [`DECISIONS.md`](./DECISIONS.md) — D-070 + append-only decision log.
4. [`LADDER.md`](./LADDER.md) — the staged-autonomy ladder + promotion gates.
5. [`RISK_POLICY.md`](./RISK_POLICY.md) — the enforced risk invariants.
6. [`docs/trd/STAGE1.md`](./docs/trd/STAGE1.md) — the Stage-1 build spec.

## Non-negotiable invariants (fail closed)

- **No real money before the gates.** Auto-execution is disabled below the SMALL
  rung. Stage 1 touches $0 and has no broker order path at all.
- **No LLM in the order path, ever.** Execution is deterministic rules + the
  risk gate only. LLMs may reason about strategy *specs*, never place orders.
- **Look-ahead is structurally impossible**, not a code-review hope — every
  feature carries the `effectiveDate` it was legally knowable (`trd_features`),
  and the backtest may only read via `asOf()`. The 45-day STOCK Act lag lives in
  that column and cannot be engineered away.
- **A null is only a market finding if the data could have detected it** (COVERAGE LAW is an invariant):
  before writing any null, verify the required input is actually loaded; if not the verdict is UNTESTED. Enforced by
  `scripts/coverage-guard.ts`, which exits RED on inadequate coverage.
- **Every Sharpe is reported next to N** (its trial count). A Sharpe without its
  N is a lie. `trd_trial_counter` increments on EVERY backtest run, including
  failed/iterated ones.
- **Resolve on history FIRST; forward-testing is background confirmation, never
  the bottleneck.** Every lead is verdicted on ALL available history with
  walk-forward + trial-count deflation *now* — decades of bars and thousands of
  trades beat waiting months for a 30-trade forward counter (D-104: btc-sweep-rr3
  killed on 4,673 historical trades vs 2/30 forward). Forward data is the final
  signature on something history already cleared. Only genuinely history-poor
  signals (short-history weekly macro) legitimately wait on forward weeks.
- **Costs are pessimistic by default.** Paper P&L is never read as "has edge".
- **Gate thresholds are decision-locked.** Changing DSR>0.95 / PBO<0.5 / sample
  floors requires a NEW `trd_gate_thresholds` row naming a DECISIONS.md entry —
  a motivated operator must not be able to quietly loosen a gate to force a
  promotion.
- **Signals are single-operator and never published** (publishing specific
  buy/sell recs for value triggers Investment-Adviser registration).
- **Idempotency end-to-end + append-only evidence.** Re-runs are no-ops; the
  ledger is immutable. Broker creds live in Vault (`cc_trd_*`), NOT provisioned
  until staged gates pass.
- **Every edge decision updates `trd_lineage`** (the provenance ledger, D-272)
  alongside its DECISIONS.md entry — one row per lead with its hypothesis, test,
  key metric, verdict, status, and decision trail. `trd_lineage_roster` is the
  queryable current state; the whole development is auditable in SQL, not prose.
- **The kill-switch is durable state** (a Postgres row) that survives daemon
  restarts — a crash must never silently re-enable trading.

## Stack

- Supabase (Postgres + Deno edge fns + Auth + Vault/pgsodium) — its OWN project
  (ref TBD; operator provisions). Namespacing: tables `trd_*`, fns
  `agent-trd-*` / `cc-trd-*`, migrations `000N_*.sql`, vault `cc_trd_*`.
- Oversight/reporting UI lives in **Command Centre** (read-only, via a
  service-role bridge) — this repo is the engine; CC is the cockpit.
- `deno test supabase/functions/_shared/` — the honest-stats core (offline, no deps).
- `deno check supabase/functions/**/*.ts` — must pass before commit.

## What "done" means here (inherits global doctrine)

Works in its real environment; reproducible by the operator via a script/UI she
owns; doesn't break what worked; source committed with `deno check` passing;
STATE.md / DECISIONS.md updated. A strategy is NEVER "done/profitable" on a
backtest — only after it clears paper → micro → small with REAL samples and a
clean kill-switch record.


## THE COVERAGE LAW (2026-08-21) — binds every conclusion
**A null result is evidence about the MARKET only if the data was adequate to detect the effect; otherwise it is evidence
about our DATA.** Absence of data is not evidence of absence.
Origin: Aegis reported program-level "no edge" conclusions while holding 5 of hundreds of available EDGAR concepts — accruals,
cash-flow-to-price, gross profitability and NOA were never tested because their inputs were never fetched, and that absence
was narrated as a market property. Inverted burden of proof; nearly closed the program on a false premise.
Rules: (1) no null verdict without a coverage statement (instruments, observations, span, required inputs); (2) check whether
the INPUT exists before blaming the market — if it does not, the verdict is **UNTESTED**, not NULL; (3) underpowered is its
own verdict, with the n required stated; (4) an unfetched free dataset is a RESEARCH failure, not a market finding;
(5) enforced by `scripts/coverage-guard.ts` (exits RED on inadequate coverage — verified to fail, not just to pass).


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


## THE EXECUTION LAW — SAME-BAR COROLLARY (2026-08-23, D-498)
**A close-derived signal may not act at that same close.** The first 4 specs ever to clear all six gates (VIX9D/VIX
inversion risk-off, t 5.5–5.8, +19%/yr) SIGN-FLIPPED to −11%/yr (t −4.1, negative 14/16 years) under ONE DAY of
execution lag — the signal day was the crash day. Lag-1 execution is the structural floor for every bar-close timing
rule; enforced by the execution guard's SAME-BAR RULE (`exec:"lag1"` stamp required on every timing-family ledger row,
verified RED on 187 unstamped rows including the 4 false survivors).

## THE INSTRUMENT LAW (2026-08-25, D-575) — the programme's most reliable failure predictor
**A premium must be measured in the instrument that would HOLD it. Measuring in research space and assuming the
conversion has failed 4 times out of 4, each by a different mechanism, and each time only after a statistical claim had
already been made and reported.**
| # | research-space claim | what the placeable instrument delivered |
|---|---|---|
| D-530 | equity decile long-shorts, real alpha | cannot be placed at all — thousands of names, borrow assumed |
| D-555 | factor premia | ETF wrappers capture ~20% (a long-only tilt is not a long-short) |
| D-556 | same premia, concentrated | placeable and DEAD: t 0.35, -93% drawdowns |
| D-574 | crypto variance premium t 3.76 | t 1.18 naked / 0.42 delta-hedged straddle |
The common structure is always the same: the edge and the vehicle turn out not to be the same object, and the gap is
discovered last instead of first. Note that costs were rarely the culprit — D-573 measured Deribit spreads at a
harmless 3.3% of premium and the strategy still failed, because a straddle is a poor variance proxy in a gapping asset.
Rules: (1) every live return claim states whether it was measured in the PLACEABLE INSTRUMENT or in a RESEARCH PROXY;
(2) a proxy claim must carry a MEASURED conversion, never an assumed one; (3) research-space measurement is still
allowed and useful — what is forbidden is reporting it as if it were tradable; (4) the workflow inverts where possible:
start from what can be placed and measure the edge THERE; (5) enforced by `scripts/instrument-guard.ts` (RED on a
research-space claim with no stated conversion, verified by selftest and on 22 live rows, exit-code-checked).

## THE PRE-COMMITMENT LAW (2026-08-25, D-571) — binds every forward clock
**A forward test without a written promote/kill rule is not a test — it is an option to rationalise later. Every
forward-registered spec carries numeric, two-sided conditions written BEFORE its data exists, in an append-only table
the author cannot edit when the results arrive.**
Origin: four forward clocks were started (paper book, crypto lit5, residual-follow, the 8 payout leads) with no stated
decision rule. No statistical gate can catch this failure because it happens in the NARRATION — the numbers arrive and
whoever reads them, including a future session of me, gets to decide afterwards what they meant. Registered in
`trd_forward_rules` with an immutability trigger (UPDATE/DELETE raise, verified by attempting one).
The rules deliberately encode this session's own corrections: the paper book is judged against the modern-era Sharpe
0.40 (D-527) not the 0.90 full-sample headline, and against the COMBINED-book null of 6.63 (D-558) not the 5.34
single-spec ceiling; crypto lit5 is judged at 0.60 because subset choice was worth +0.28 t (D-560) and the full span
lowered the honest number (D-564). Each rule also states what is NOT evidence against — a weak first year is expected
for strategies that spent years underwater historically (D-566).
Enforced by `scripts/forward-rules-guard.ts` (RED on a vague or one-sided rule, verified by selftest; PASS on numeric
two-sided rules; wired into the daily runner).

## THE HOLDABILITY LAW (2026-08-25, D-565/566) — binds every deployable claim
**Depth is not the risk; DURATION is. Every live book must state its longest TIME UNDERWATER, not just its maximum
drawdown — a -65% drawdown recovered in three months is a different instrument from one that lasts three and a half
years, and the second is what actually ends deployments.**
Origin: the crypto candidate survived ten statistical attacks — execution lag, punitive fees, era decomposition,
liquidity inversion, cross-venue replication, its own construction-specific null, exhaustive subset enumeration,
survivorship repair, factor attribution, full-span extension — and was then disqualified by a fact no gate measured:
**1,363 days (3.7 years) underwater**, with every individual year carrying its own -28% to -56% drawdown. Vol
targeting does not rescue it (paired t -0.28), unlike on equities where the same policy cuts time-underwater from
5.8 years to 2.8. Two consequences: capacity was never the binding constraint (tolerance is), and a forward clock can
spend years in drawdown without that being evidence against the strategy — which makes forward testing a far weaker
decision tool than its duration suggests.
Rules: (1) every live book/ml row stating SR or %/yr also states its time underwater; (2) scope is deployment
candidates, not research measurements of factors — stated explicitly so the scoping is auditable; (3) enforced by
`scripts/holdability-guard.ts` (verified RED on a depth-only synthetic row and on 24 live rows, PASS after measured
durations were stamped, exempt where no return is claimed, exit-code-checked both directions).

## THE SIGN LAW (2026-08-24, D-553/554) — binds every directional claim
**A direction asserted is not a direction checked. Any result invoking a pre-registered, expected or literature sign
must state whether the measurement MATCHED or MISSED it — and a post-hoc flip is never claimable.**
Origin: the funding book was run LONG-high-funding, reported under the label of the pre-registered SHORT-high
direction, and the resulting "+48.1%/yr / blended SR 1.70, drawdown -36%" stood as the session's best result until an
unrelated test produced an inconsistent number. Every other law was green throughout: coverage had been expanded 20x
first (25 -> 512 symbols), the portfolio-t decided, execution was lagged, the universe swept, trials counted. What
failed was that a DIRECTION was narrated and never verified against what the code did. Corrected: the pre-registered
direction LOSES (-48.1%/yr); the profitable direction is an unregistered flip and is not claimable (D-511b precedent).
Rules: (1) every row invoking a directional prior states MATCHED or MISSED; (2) a flip discovered after the fact
requires fresh pre-registration and forward confirmation before it means anything; (3) enforced by
`scripts/sign-guard.ts` (verified RED on a synthetic prior-without-outcome and on 5 live rows including the author's
own, PASS after honest outcomes were stated, exempt where no prior is claimed, exit-code-checked both directions).
NOTE ON THE ONE SPEC THAT PASSED CLEANLY: lit5's five literature signs ALL matched in the liquid core (D-542), which
is now a verified statement rather than an assumed one.

## THE UNIVERSE LAW (2026-08-24, D-535) — binds every cross-sectional result
**Who is IN the universe is a researcher degree of freedom, and it moves the answer more than most of the choices the
other laws police. Report the range of the headline metric across defensible universe definitions; a result whose
Sharpe doubles across them is NOT IDENTIFIED, whatever its t-stat.**
Origin: the crypto GBM book — the program's best placeable candidate and its first liquidity-ROBUST signal — printed
20.0 / 35.9 / 50.2 / 53.1 / 80.9 %/yr (SR 0.61 / 1.11 / 0.99 / 0.95 / 1.30) across five defensible definitions of the
same idea: all-328 contracts, all-498, liquid tercile, fixed top-60 by dollar volume, fixed top-100. A **2.1x spread in
Sharpe and 4.0x in return**, with no principled criterion selecting among them — and every other law satisfied the
whole time (trials counted, liquidity decomposed, breadth adequate, execution lagged, selection train-only). Fixed-N
was adopted to KILL this instability and did not: top-60 gives 1.30, top-100 gives 0.99.
Rules: (1) every promoted cross-sectional claim states its universe sensitivity, measured or explicitly not measured;
(2) a spread beyond ~1.5x in the headline metric is recorded as NOT-IDENTIFIED, never as an edge; (3) each universe
variant costs a trial like any other specification; (4) enforced by `scripts/universe-guard.ts` (verified RED on a
synthetic unstated row and on 9 live rows including the author's own newest claims, PASS after honest statements,
exempt for single-instrument families, exit-code-checked both directions).

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


## GUARDS MUST INSPECT THE RUNNING CODE, NOT ONLY THE RECORD (2026-08-22)
**A guard on the ledger does not constrain the agents.** Aegis had seven laws with seven machine guards, every one green,
and three real defects sitting in production the whole time — because all seven inspected `trd_lineage` (what was
CONCLUDED) and none inspected what the live agents were COMPUTING AND PRINTING:
- `aegis-autopilot` derived its deflation ceiling from a hardcoded N=1000 (3.72) instead of the program's ~1.53M trials
  (5.34), and had SURFACED Ken French momentum at psr_z 3.73 as "clearing" for **nine consecutive cycles**;
- `aegis-positioning` printed "combining validated edges" while the `honest_note` it wrote to the database said neither
  leg was validated;
- `aegis-discovery` reported a Sharpe and a psr_z for candidates whose cumulative equity had gone NEGATIVE (maxDD −114.8%).
Every one was visible in a log file that nothing was reading. Enforced by `scripts/agent-output-guard.ts`, which reads the
LATEST run of each agent and goes RED on: a drawdown past −100% not labelled RUINED, a noise ceiling below the current
trial count, a "validated/verified edge" claim while the ledger promotes nothing, a stale log, or non-empty stderr.
**Two flaws in that guard were caught by building it:** it first scanned whole log tails and so flagged defects that had
already been FIXED (a guard that cannot go green after a fix gets ignored — worse than useless), and it repeated one
problem once per matching line. Both corrected: latest-run-only, deduped.

## THE MECHANISM LAW (2026-08-25, D-597) — the gate that sat one step too late
**A causal claim is only admissible if its kill condition was written before the data existed. Every research row
either cites a pre-registration in `trd_prereg`, or marks itself DESCRIPTIVE ONLY.**
Origin: seven mechanism stories were proposed for one set of measurements in a single session — arbitrage-thinness,
dispersion, leverage crowding, listing age, a liquidity band, a stop-width rescue, and a refutation of the beta
explanation. All seven died. Six died to controls, which is the system working. The seventh, **D-590, was a false WIN
reported to the operator**: "shorts pay more than longs, therefore not beta", resting on a POOLED comparison in which
one stop geometry carried **64.3%** of the trades. One decomposition reversed it. It was found by chance while
re-reading my own output.
None of the other fourteen guards could have caught it: **every one inspects a conclusion already in the ledger, and
this failure happened one step earlier — in the move from a number to a story about the number.**
Rules: (1) a mechanism claim cites `PREREG: <id>`, or is marked DESCRIPTIVE ONLY — description is always allowed,
the unregistered *story* is what is forbidden; (2) `trd_prereg` is append-only with an immutability trigger, and an
outcome once recorded cannot be rewritten, so **a retraction can never be softened into a win** (verified by
attempting all four attacks); (3) any row reporting a POOLED statistic must state its disaggregation — the D-590
shape; (4) enforced by `scripts/mechanism-guard.ts`, verified RED on the literal D-590 sentence, PASS on a
registered claim and on a descriptive one, exit-code-checked both directions.

## THE PRECONDITION LAW (2026-08-25, D-598) — 9 of 10 self-inflicted defects were one bug
**Assert that the run did what you asked before reading what it produced.**
Origin: every self-inflicted failure of the session was classified. Ten defects; **nine share one structure and not
one is a reasoning error** — a stale `.tsv` read after a run wrote nothing; columns labelled "gross" that were net
because a fee variable was never passed; a `SYMBOLS` filter matching 0 of 31 names; a self-test that silently did
nothing because the script read `SELFTEST` while `GUARD_SELFTEST` was set; five guards exiting 0 with the database
unreachable; a guard certifying "ALL 0 PROMOTED ROWS"; a regex splitting one book into twenty fake families; a
blanket UPDATE contaminating a pre-registered forward row. **Zero were arithmetic. Zero were misread markets.**
The resulting rework was **41% of commits**. Reviewing harder does not fix this class; asserting does.
Rules: (1) every analysis script calls `declareKnobs()`, which prints the EFFECTIVE configuration and **refuses to
run** when a set variable is a near-miss of a declared one (catching both the mistyped name and the
prefix variant — `GUARD_SELFTEST` vs `SELFTEST` is edit-distance 6, so containment is checked too); (2) a filter that
matches nothing yields **UNTESTED**, never a null — `assertNonEmpty()`; (3) a file must have been written by *this*
run — `assertFresh()`; (4) a mutation states how many rows it expects to touch — `assertTouched()`; (5) all five
verified by breaking their inputs, and retrofitted into `crypto-nonlinear.ts` and `grammar-search-deep.ts`, the two
scripts that produced most of the rework.

## CONTINUITY: THE SYSTEM MUST OUTLIVE THE SESSION (2026-08-26, D-613)
**A registered forward rule that is never SCORED, and a dataset that silently stops arriving, both produce the
feeling of discipline while leaving everything they were built to prevent.**
Origin: THE PRE-COMMITMENT LAW (D-571) built `trd_forward_rules` with an immutability trigger so a forward test
could not be rationalised after the fact, and five clocks were registered against it — paper book, crypto lit5,
residual-follow, the eight payout leads, the hedging-pressure flip. **Nothing scored them.** `forward-rules-guard.ts`
verified a rule was two-sided and numeric; it never asked what the data had since done. A rule that reaches its
horizon unscored leaves the discretion exactly where it was, because whoever reads the numbers years later still
decides what they meant.
The parallel failure is data: an ingest that stops leaves the last good rows in place, so every query keeps
answering plausibly from a frozen snapshot. Months of research can be conducted against stale data with every
number internally consistent and none of it current. This programme has already met the quiet version twice —
a daily runner wedged mid-edit (D-566) and five guards certifying green while reading nothing (D-584).
Rules: (1) every forward clock accumulates append-only MARKS in `trd_forward_marks` (immutable by trigger, verified
by attempting UPDATE and DELETE); (2) a clock that MATURES without a verdict turns the scorer RED — maturity may
never pass silently; (3) the scorer deliberately does NOT invent verdicts, because a generic guess is the discretion
the pre-registration removed — it tracks the clock and refuses to let it lapse, a human or spec-specific script
supplies the number; (4) every feed carries a staleness budget matched to how often the SOURCE publishes, since a
weekly dataset is not stale at three days and crying wolf trains everyone to ignore the alarm; (5) enforced by
`scripts/forward-scorer.ts` and `scripts/continuity-guard.ts`, both wired into the daily runner and
`scripts/guard-status.sh` (16 guards).
