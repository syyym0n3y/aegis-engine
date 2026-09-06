# GOLD PATH — what "extract bits of wealth every day, regardless of instrument" means on the evidence (D-804)

> Written 2026-09-06 after reading all 580 decision entries (D-331…D-803; 198 carry open-item language). Every number
> below is a measurement already on the record or re-read live tonight; nothing here promotes, pays, or amends a rule.
> This is the document NEXT.md now points at. The operator's instruction was: account for everything, name every
> neglected gap, and deal with whatever stands between the engine and the gold. Here is that, honestly.

## 0. The measured state (2026-09-06)

| quantity | value | source |
|---|---|---|
| decision entries | 580 (D-331…D-803) | `data/decisions-audit.txt` |
| entries mentioning KILL / RETRACT | 343 / 70 | grep of DECISIONS.md |
| forward clocks registered / marks recorded | **17 / 316** | `trd_forward_rules`, `trd_forward_marks` (live) |
| clocks computable on their forward window / verdicts | **0 / 0** | latest mark per clock, 2026-09-06 |
| lineage rows in a promoted state | **0** | liquidity-guard, every run |
| deflation ceiling every result must clear | 5.4555 | STATE.md |
| wealth ledger | **EMPTY** (no deposit, wrapper, or currency-leak row) | `wealth-ledger.ts` |
| machine guards on the board | 28 on disk, all green | `guard-status.sh`, registry CONSISTENT |

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

**B. UNTESTED with data already held, never revisited (0 later mentions) — the actual research queue, one trial each:**

| entry | what is untested | input held? |
|---|---|---|
| D-626 | short-interest SURPRISE (change vs expectation), decided before the Benchmark Law | FINRA short interest: yes |
| D-612 | PEAD conditioned on analyst coverage (deferred, "event study not powered") | earnings + coverage proxy: yes |
| D-601/602 | leverage effect powered up — where the risk actually sits | bars + fundamentals: yes |
| D-476 | the TRADABLE version of the insider family (278k events swept, tradable cut not run) | Form 4: yes |
| D-477 | classic premia at maximum honest power — momentum t 4.84 across a century, never taken to the placeable instrument | Ken French + ETF panel: yes |

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

1. §2.B — the five untested-on-held-data tests, one trial each, laws applied, verdicts to lineage + a DECISIONS entry.
2. §3.3 — the descriptive 2026-break decomposition.
3. §3.7 — the three reliability items.
4. §1.3 — register the prop clock ONLY on operator sign-off; then the ledger scorer for it (CONTINUITY LAW).

## 5. Deliberately NOT on the list

Chart patterns, L2 depth, sentiment/NLP (operator: OFF). More grammar triggers (drained). More prop firms before
the first outcome exists (§1.3). Any amendment to a registered rule. Any "daily edge" claim that is not a matured clock.
