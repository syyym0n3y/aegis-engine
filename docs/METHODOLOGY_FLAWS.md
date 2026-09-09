# METHODOLOGY FLAWS — the complete register, including what nothing guards (D-836, 2026-09-08)

> The operator asked to understand every flaw in our methodology across the board. This is that, written to be
> uncomfortable rather than reassuring. **Section A** is what we found and guarded. **Section B** is what we found and
> did NOT guard. **Section C** is what nobody has hit yet but which I can identify by reasoning — the most valuable
> section, and the one with no evidence behind it, which is stated rather than hidden.
>
> The programme's own history says the ratio matters: 30 laws exist, every one written after a defect had already
> reached a conclusion. Section C is an attempt to get ahead of that for once.

## A. Found, and mechanically guarded (30 laws, 30 guards, board green)

Coverage · liquidity · effect-size · breadth · execution (+ same-bar) · instrument · pre-commitment · holdability ·
sign · universe (+ coverage-is-not-breadth) · selection · mechanism · precondition · continuity · benchmark ·
turnover · cost-inflation · deflation-paid · agent-output · plumbing · daemon-drift · schema-honesty · market-cap
share-base · sovereignty · permissions · decisions-mechanism · REST-restart · trial-idempotency · registry · gap-register.

Each is enumerated with its origin in `CLAUDE.md`. The property that matters is that **each was verified by being made
to go RED**, not merely by passing.

## B. FOUND AND NOT GUARDED — live exposure, today's date

| # | flaw | how it was found | why no guard yet | exposure |
|---|---|---|---|---|
| B1 | **Benchmark measured over a different WINDOW than the events it judges** | D-826b: retracted the programme's first SUPPORTED result the same day; D-826c found a second instance in `seasonality.ts` | the benchmark guard reads the LEDGER text and can see that a universe mean is STATED, never which window produced it. Detecting it needs code analysis, not text | **HIGH** — it flipped a verdict once already, and reverses signs rather than shrinking them |
| B2 | **t-statistics on OVERLAPPING windows** | D-416 named it; D-830 measured a **ten-fold** inflation (t 14.99 overlapping vs 1.57 honest) on the same regression | no mechanical check that a reported t used non-overlapping sampling | **HIGH** — a 10x inflation is enough to manufacture any result |
| B3 | **A monitor or regex reading the WRONG number** | D-833: a retest-harness pick matched the TRAIN row instead of the TEST row; it would never have fired | nothing verifies a pick against live output | MEDIUM — silent, and the board stays green |
| B4 | **A multi-part write failing halfway** | D-833: a script died mid-edit, so a commit shipped a change WITHOUT the entry documenting it — and the decisions guard passed because the entry did not exist to be checked | a guard cannot flag an absence it was never told to expect | MEDIUM |
| B5 | **Our own tooling's parse/vocabulary errors** | subheadings `### D-828` parsed as separate entries; `GOLD: gate` rejected because the vocabulary is fixed (twice: D-823, D-832) | these DO go red — but as false splits and false reds, which train the reader to dismiss the guard | LOW-MEDIUM |

## C. IDENTIFIED BY REASONING, NOT YET HIT — no evidence, stated as speculation

**These are the ones worth the operator's attention, because every entry in section A was once in this section and
nobody wrote it down.**

| # | suspected flaw | the argument | how to test it cheaply | if true, what it invalidates |
|---|---|---|---|---|
| C1 | **Split/dividend-ADJUSTED price LEVELS are not what traded** | our equity bars are fully adjusted. Adjusted *returns* are correct, but a rule keyed to a LEVEL — a prior-session low, a swing high, a round number — references a price that never existed at the time, and the adjustment encodes future corporate actions | re-run one level-based equity rule on unadjusted closes and compare event counts | any level/structure rule on the equity panel. **The intraday work is FX/crypto and unaffected** — which is luck, not design |
| C2 | **TESTED (D-842) — CONFIRMED IN PART: the substance survives, the STABILITY CLAIM does not.** The UTC day boundary is an arbitrary choice that the results depend on | D-828 found crypto extremes cluster 00:00–06:00 UTC. A "day" for a 24-hour instrument is a convention, and every prior-session level, daily range and day-clustered statistic inherits it | **DONE: `scripts/boundary-robustness.ts`.** Range predictability HOLDS at every boundary (first-hours-vs-rest correlation 0.546–0.639; prior-day 0.557–0.612), so the finding is structure. But the **boundary spread is 0.093 against the 0.009 train→test drift D-828 cited as evidence of stability — my own arbitrary convention moves the statistic 10x more than three years of regime change did** | not the finding, but the PRECISION claimed for it. Any conclusion resting on a UTC day must now report boundary sensitivity beside its train/test drift |
| C3 | **Costs are treated as constant across decades** | D-830 spans 1990–2026 at one cost assumption. Spreads in the 1990s were multiples of today's; a 36-year backtest at modern costs flatters the early era, and the early era is where D-830's only positive decade sits (+0.376, t 3.33 in the 1990s) | apply an era-varying cost and see whether any surviving early-era result persists | long-span results whose significance is carried by pre-2005 data |
| C4 | **TESTED, CONFIRMED, AND NOW CLOSED (D-836 → D-841): 3 real gaps found and fixed; 2 of the reported 5 were the detector, not the guards.** Guards are verified once, at birth, and never re-verified | four guards have been found broken AFTER shipping (D-584 fail-open, D-650, D-659 silent, D-671). `registry-guard` checks a guard EXISTS; nothing checks it can still go RED | **DONE and CLOSED: `scripts/guard-selftest-all.ts`, in the daily runner. 30 of 30 now demonstrate a working red branch.** The first report of 5 exposed was wrong in a way worth keeping: `coverage-guard` DID refuse (exit 1 on an injected impossible floor) but never printed that it was self-testing, and `market-cap-guard` prints "SELFTEST 1 PASSED" which the detector's regex could not match — **2 of the 5 were the detector**. The 3 real gaps (`continuity`, `gap-register`, `infra`) had no self-test at all and now each inject a subject that MUST be refused: an absent feed + an unregistered job; a gap marked FILLED with a backing that cannot exist; a probe of a dead port | the board's green, which is the single most load-bearing claim in the programme — now measured rather than assumed |
| C5 | **Every guard THRESHOLD is itself an unregistered researcher choice** | t ≥ 2.0, 60% instrument agreement, 1.5x universe spread, 50-name breadth floor — each was picked once and never justified against an alternative | state each threshold's provenance; where it was arbitrary, say so | not results directly, but the *appearance* of rigour, which is worse |
| C6 | **The hypothesis set is supplied by the operator and by me, and both are biased** | 2.9M trials, but the SPACE searched is what one person suggested and one model thought of. The mechanisms that survived (odd-lot, SPAC trust) were found *accidentally* while looking elsewhere — evidence the search space is the binding constraint, not the search | count what fraction of tests came from operator suggestion vs literature vs systematic enumeration | the claim that the universe is efficient — we have only shown that *our* hypotheses fail |
| C7 | **Post-publication decay is applied inconsistently** | D-500 found the announcement premium decayed post-publication; that reasoning is applied to some literature signals and not others | tag every literature-derived test with its publication date and check whether verdict correlates with it | the interpretation of every null on a published anomaly — "it never worked" vs "it stopped working" |
| C8 | **Survivorship in the DATA SOURCE, not just the universe** | Yahoo and the CFD feed serve what exists today. D-639/645 handled the equity delisting hole; nothing checks whether the FX/index CFD series has silently dropped instruments | list the instruments the source served a year ago against today | the intraday panel work, whose universe is "whatever we hold" |

## D. The one flaw that is not methodological

Ten weeks, 2.9M trials, 276 catalogued tests, 30 laws, 19 clocks, **zero trades and an empty ledger**. Every flaw above
is a reason a *finding* might be wrong. None of them is why there is no money. The binding constraint is that the
capital and the account do not exist yet, and no methodological improvement changes that — which is why D-823 froze
research behind an ACTS-ON requirement and D-679 recorded that the research was aimed at a capital regime the account
is not in.

## E. On 10^7

The operator's standard is a 10^7 effect. Stated honestly against this record: **no fix in sections A–C produces it.**
Better methodology makes the nulls more reliable; it does not create a return. The three things on this record with any
claim to that order of magnitude are (1) the structural lane — deposits × compounding × wrapper, certain but linear in
capital and slow; (2) the capacity-inverted mechanisms of D-834, which are real, small, and unverified for UK access;
and (3) something not yet in the search space, which section C6 argues is the most likely place it lives. **A
10^7 outcome is far more likely to come from widening what we ask than from tightening how we test.** That is the
uncomfortable conclusion of a register of methodology flaws, and it is the honest one.
