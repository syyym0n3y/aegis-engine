# GOLD PATH — what "extract bits of wealth every day, regardless of instrument" means on the evidence (D-804)

> Written 2026-09-06 after reading all 580 decision entries (D-331…D-803; 198 carry open-item language). Every number
> below is a measurement already on the record or re-read live tonight; nothing here promotes, pays, or amends a rule.
> This is the document NEXT.md now points at. The operator's instruction was: account for everything, name every
> neglected gap, and deal with whatever stands between the engine and the gold. Here is that, honestly.

## 0. The measured state (2026-09-06)

| quantity | value | source |
|---|---|---|
| decision entries | 590 (D-331…D-813) | `data/decisions-audit.txt` + DECISIONS.md |
| entries mentioning KILL / RETRACT | 343 / 70 | grep of DECISIONS.md |
| forward clocks registered / marks recorded | **18 / 600+** (prop clock signed D-807; every clock has live inputs and a scorer since D-813) | `trd_forward_rules`, `trd_forward_marks` (live) |
| clocks computable on their forward window / verdicts | **0 / 0** | latest mark per clock, 2026-09-06 |
| lineage rows in a promoted state | **0** | liquidity-guard, every run |
| deflation ceiling every result must clear | 5.4555 | STATE.md |
| wealth ledger | **EMPTY** (no deposit, wrapper, or currency-leak row) | `wealth-ledger.ts` |
| machine guards on the board | 30 on disk, all green (decisions, REST-restart guards added D-804/810) | `guard-status.sh`, registry CONSISTENT |

## 1. The phrase, translated into mechanisms that actually run daily

"Regardless of instrument" fails on the evidence, and the failure is specific, not a mood. The cross-instrument
sign maps disagree by asset class: the liquid-decile dip-buy is US-equity-specific (crypto daily fails, D-791);
breakout continuation at 10:00 ET is weak and regime-dependent (+6.49bp, t 2.37, 60%); every crypto construction
sign-flipped in 2026 (persist-real t 2.97 → −3.01; two of three hourly-sweep clocks tracking KILL); trailing stops
and pyramiding destroy what fixed-K keeps (D-787). There is no instrument-agnostic daily extraction rule on the
record, and D-780 hunted for survivors deliberately, with the negative bias removed, and found these and only these.

What DOES run every day with positive expectation, in order of certainty:

1. **The structural rate — certain, legislated, and unlogged.** D-735 anchors 10.75%/yr; the ISA wrapper is worth
   0.63–1.45%/yr alpha-equivalent (D-758); currency-of-account leakage defaults to 130bp/yr (D-731, unmeasured on
   the live account); below ~$60k the next deposit beats a 3% alpha (D-746). This is the whole of the 10^7 lever that
   is inside the market today. It is worth more than any edge this engine has ever promoted, and its ledger is empty.
2. **The 17 clocks — the pipeline that can EARN a daily-trading mechanism.** Each carries a numeric two-sided rule
   written before its data existed, immutable by trigger, scored daily, RED on lapse. None has a computable forward
   window yet. Nothing can be promoted before one matures; the scorer, not a session, decides.
3. **The prop-firm route — conditional, priced, unpaid.** Futures props are −EV on every futures-compatible cell.
   utc16 alone at 0.5× is the only configuration with positive EV in 2026 (+3.8 per fee $, 48% vs 34% no-edge, 9%
   blow-up; day-t 0.51 — wide error bars). The ready-to-sign clock `fwd-prop-ftmo100k-utc16-0p5x-v1` exists in
   `docs/PROP_FIRM_PLAN.md §3`. One account, not N: N accounts on one signal are one bet at N×.

Everything else on the record is research, and research is not income.

## 2. The neglected-gap register — every open-language entry, classified

**A. Superseded (closed by a later law or drain; nothing to do).** The 33-trigger grammar lane (D-301…D-331,
"queued/untested") was DRAINED at D-342 with a measured yield of 0/1,023. The Stage-1 queue in NEXT.md (Supabase
provisioning, Alpaca ingest, `trd_features`) was superseded by the owned node (D-408→D-729) and `trd_features` holds
0 rows (D-704). NEXT.md had not been edited since 2026-08-14; it is rewritten tonight to point here.

**B. UNTESTED with data already held, never revisited (0 later mentions) — RUN 2026-09-06 (D-805). CORRECTION: D-612 was TESTED (not supported) and D-601/602 was resolved at n=53 (absent); the audit's keyword extraction misfiled both and I listed them without reading the entries. The three real tests: all NULL, sign MISSED on two.**

| entry | what is untested | input held? |
|---|---|---|
| D-626 | short-interest SURPRISE at K=12 settlements — **NULL, sign MISSED (NW t 0.83), D-805** | FINRA short interest: yes |
| D-612 | ~~PEAD by analyst coverage~~ — **already TESTED at D-612 (not supported); misfiled here** | — |
| D-601/602 | ~~leverage effect powered up~~ — **already resolved at D-602 (n=53, absent); misfiled here** | — |
| D-476 | insider SELLS in the tradable slice (side never held; 660k rows ingested) — **NULL, sign MISSED (t 0.32), D-805** | Form 4 sells: now yes (file) |
| D-477 | profitability + investment premia (column ambiguity) — **NULL vs ceiling: t 1.29 / 2.12, investment dead post-2013, D-805** | Ken French: yes |

Each must be run under BENCHMARK (universe mean + excess), TURNOVER (drag beside gross), INSTRUMENT (placeable or
proxy, stated), and costs one trial. Expected outcome per base rate: null. They are on the list because an unrun
test on held data is a research failure, not a market finding (COVERAGE LAW rule 4).

**C. Blocked with a NAMED barrier (free sources searched; not "impossible", just not free yet):** per-strike options
OI / dealer gamma (D-350; the Deribit BTC/ETH book is now ingested daily, D-792 — equities remain the gap); borrow
fee in bp (D-580/D-639; IBKR FTP blocked); order-book depth (L2 — explicitly OFF the list by operator instruction);
intraday OI for equities; earnings revisions (licensed); central-bank reserves (quarterly, lagged); the delisted
cohort — 27.3% of the equity FTD universe (D-639/646; a loud coverage figure, not a silent hole).

**D. Operator-only (the engine cannot do these, by design):** pay one prop fee (§1.3); log deposits, wrapper, and
currency leak into the ledger (`ADD_DEPOSIT / SET_WRAPPER / SET_CCY_LEAK_BP`); the CC Supabase invoices (the cockpit,
not the engine — the engine is on the owned node); capital access beyond the current budget (D-746's 3%-alpha line).

## 3. What stands in the way of the gold — and its disposition

1. **The ledger is empty.** Every month not deposited costs more than any edge ever promoted. Disposition: operator
   logs three rows; nothing further to build. The ledger's own "18 clocks live" was a printed literal — corrected
   tonight to a live count (17), because a number that is not measured is the class this programme exists to kill.
2. **Every clock is pre-horizon.** No promotion is possible until one matures, and forward testing is a weak
   decision tool over any horizon a session can see (HOLDABILITY LAW). Disposition: wait; the continuity guard reds
   on lapse; no session may "read" a clock early.
3. **The 2026 crypto regime break is unexplained.** Four constructions flipped sign in the same year. Disposition:
   a DESCRIPTIVE-ONLY decomposition (by symbol, hour, era, funding regime) — no mechanism story without a PREREG
   (MECHANISM LAW). Two live clocks depend on the answer, so it is the highest-value open question on the board.
4. **Clock #18 is weak in calm regimes** (VIX3M<20: −39.1bp/day over 619 days; ≥20: +92.2bp over 405). Disposition:
   the rule is immutable; a conditional v2 is a NEW registration and only after this clock ends. Report-only until then.
5. **The prop decision is not mine.** Disposition: priced, verification checklist written, clock ready to sign.
6. **Two data spaces stay dark** (per-strike equity OI, borrow fee). Disposition: the driver register carries the
   barrier by name; the next free source found opens them (five "paid/gated" labels have already fallen).
7. **Reliability debt still open:** cockpit-render fails its positive control (content, not cwd/perms);
   `refresh-bars.ts` writes bars without the metadata columns the liquid refresher writes; guard-status shows a
   transient RED for ~1 minute after a kickstart. All three are logged, none hides a feed.
8. **Future decisions could drift back to research-for-its-own-sake.** Disposition: from D-804 every DECISIONS entry
   must carry a `GOLD:` line naming the mechanism it feeds (structural | clock | prop | gap | reliability | research |
   law) and what it changes — enforced by `scripts/decisions-guard.ts` (RED on a missing line, self-tested both ways,
   wired into the runner and the board).

## 4. Order of work (unblocked, $0, in this order)

1. ~~§2.B — the five untested-on-held-data tests~~ DONE (D-805): three run (all NULL), two were already resolved.
2. ~~§3.3 — the descriptive 2026-break decomposition~~ DONE (D-806): panel-wide, seasonality unstable yearly.
3. ~~§3.7 — the three reliability items~~ CLOSED (D-806). Dispositions for everything else: `docs/DEVIATION_REGISTER.md`.
4. §1.3 — register the prop clock ONLY on operator sign-off; then the ledger scorer for it (CONTINUITY LAW).

## 4b. What happened after this was written (2026-09-06/07)

- D-805: the five-item queue closed — three real nulls, two items were already resolved (misfiled by the keyword audit).
- D-806: the deviation register; dealer gamma (naive) and the crypto delisted cohort unblocked; the 2026 break described as panel-wide.
- D-807: the prop clock signed and registered, scored only from the operator's ledger; fee unpaid.
- D-808/809/811: the operator's order-flow stack measured on every free source — 8 pre-registrations, 8 retractions; crypto L2/flow, index put/call history and FX tick footprint now HELD (register 50 / 3).
- D-810/812: PostgREST restart cause established (OOM in a 3.8GB VM at 2.84GB); legacy stack stopped; guard names the killed statement.
- D-813: three perp panels had frozen and three clocks had no scorer — fixed on Monday before the first bar; continuity GREEN.
- D-814: the missing model classes run — ridge, boosting, meta-labeling and regime conditioning all sub-fee or worse; HAR-RV variance forecasting CONFIRMED on 11/11 (the per-instrument model with skill: how far and how long, never which way).
- D-815/816: paid data priced; the equity L2 barrier measured on the operator's Databento credit ($95.52) — sub-fee on all 20 names.
- D-819/820/821: HAR-RV live daily; SPX per-strike OI bought and measured (no pin; the flip at-fee on ES costs, unregistered); vol-sizing of the registered rules costs return.
- D-823: THE FIVE — research frozen (guard), ceiling split by provenance (admits nothing today), MICRO rung prepped (hourly sheet, ledger, kill-switch; live on the first hand-placed fill), prop parked behind 30 real fills, session exit condition written.
- D-823b-f: the sheet made live on all 12 instruments; **placeability verified — FCA COBS 22.6 bans crypto derivatives for UK retail, and the CFD minimum is ~100x the intended size, so the product is a spread bet and the tradable set was 3 of 12**.
- D-825/826b: the first SUPPORTED result, **retracted 40 minutes later** — its benchmark spanned the full history while its events were out-of-sample; corrected, the rule underperforms an unconditional 24h hold on all three placeable instruments. Caught by a second implementation disagreeing on one number.
- D-827: multi-timeframe trend alignment as a breakout gate — **NULL both ways on 110,746 events**. Alignment orders the DEGREE of breakout failure (monotone at K24, train and test) without producing a gain.
- D-828/829: the daily behaviour atlas — **range is predictable (corr 0.60, stable across a regime change), direction is a coin flip (50.1%)** — and the reversion test it implied is NULL; after an exhausted range price CONTINUES, and the reverse underperforms simply holding.
- D-830: **our forecast beats the market's price of range by 26% over 36 years and cannot be monetised** — implied is not a forecast but a price carrying a 4-vol-point premium, and our forecast exceeds it in only 14 of 432 windows.
- D-831: the Douglas/Schwager literature accounted for; on a zero-edge stream 1 trader in 20 shows +8.36bp/trade and selective memory inflates a record by ~87bp/trade.
- D-832: **at 30 fills the smallest detectable edge is 46.8bp — 7x anything this programme has produced.** The micro review is an OPERATIONAL test, never an expectancy test (gate row `micro_review_is_operational`).

## 6. WHERE THIS LEAVES THE GOLD PATH (rewritten 2026-09-08 after D-823→D-832)

**What is now closed, with reasons rather than shrugs.** Direction is not predictable on this universe (2.9M trials, and
D-828's 50.1% up-day share arriving independently). Breakouts, levels, order flow and multi-timeframe structure are all
measured and dead. **Range IS predictable — that is real and confirmed twice by different methods — and it has now
resisted conversion into a return on both asset classes, including in the instrument where range is priced directly.**
The literature the operator named is accounted for proposition by proposition; where it disagreed with our data, the
data won.

**What that means for the four levers.**
1. **Structural (deposits × compounding × wrapper).** Still the only mechanism on this record with certain positive
   expectancy, and today's work strengthens that by elimination rather than weakening it. It has **no vehicle**: no
   account exists (D-823c). This is the binding constraint on everything else.
2. **Position (the micro rung).** Prepped, hourly sheet live, kill-switch armed — and **no admitted rule**, since D-825
   was retracted. D-832 settles what its first fills can and cannot establish: plumbing yes, expectancy no.
3. **Prop.** Parked behind 30 real fills, priced, terms verified, UK not restricted.
4. **Clocks.** 19 registered, scored daily, none matured.

**The one-line honest statement of the programme's position:** the engine can forecast how far, not which way; the
market prices how far with a premium our forecast almost never beats; and the operator's binding constraint is not the
absence of an edge but the absence of an account. Every hour spent on the first two is worth less than the hour spent
on the third.
- D-822: gap analysis — residual-follow clock made scorable at its registered cadence; conditional VRP on the HAR forecast NULL; D-820's cost-inflated t corrected; HAR-RV on the cockpit.
- D-817/818: two of the three paid barriers opened free and keyless (estimate revisions; the per-name options surface, forward); a peer session added SqueezeMetrics GEX/DIX history, Deribit DVOL and a Nasdaq revisions feed (D-818, both its tests retracted). Register 56 held / 2 blocked, both paid.

## 5. Deliberately NOT on the list

Chart patterns, L2 depth, sentiment/NLP (operator: OFF). More grammar triggers (drained). More prop firms before
the first outcome exists (§1.3). Any amendment to a registered rule. Any "daily edge" claim that is not a matured clock.
