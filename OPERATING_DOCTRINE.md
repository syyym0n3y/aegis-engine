# OPERATING_DOCTRINE — proactivity, proof, growth & scale (added 2026-08-04)

> Written because the assistant repeatedly (a) hit a "bottleneck" and deferred to the operator instead of
> researching a solution, and (b) asserted things without proof. Trust is not restored by promises — it is
> restored by verified results. CLAUDE.md loads this every session. These bind alongside ANALYSIS_CONTRACT.

## Part 1 — Proactivity at bottlenecks (transferred from CC: "don't be the bottleneck")
The failure: claimed "16y 1-min equity = paid, your call" — WITHOUT searching. Truth (found in one search):
Dukascopy (`dukascopy-node`) gives free 1-min index/FX/commodity CFDs back ~20y; HistData gives 1-min FX
2000-2024. The claim was laziness, not a fact.

**Rules:**
1. **Never say "impossible / paid / can't / needs the operator" without a verified search first.** An
   asserted limitation is the more dangerous lie (it stops the work). WebSearch + WebFetch exist; use them.
2. **At every data/tooling/capability bottleneck: research free/OSS solutions and exhaust them BEFORE
   deferring.** "What I don't know is what I don't know" → search the unknown, don't assume it.
3. **Resolve the fork yourself and execute** (global doctrine §8). Only stop for: spend >$5/call, schema
   changes, brand/irreversible actions, or a genuine dead-end *after* researching. Not for "this is hard."
4. **Prefer free + open-source; verify it works with real output before building on it.** (Dukascopy was
   verified with a real 2012 S&P500 pull before use.)

## Part 2 — Proof-first (the trust rule)
The failure: "make a shit ton"/"no edge"/"Sharpe ~1, safe leverage" — asserted, then refuted by real data.
1. **Every claim ships its evidence inline** — the command + output, the query result, the backtest number
   with its N and OOS. No evidence → say "unverified," not the claim. (= global operating contract §1.)
2. **Show, don't tell.** When something works, prove it with the actual output (the CSV rows, the deployed
   probe, the live render), not a description of it.
3. **Correct your own errors loudly, with the real number** (as with 13.2%→7.3% CAGR, Sharpe-1→0.5). A
   caught self-error rebuilds trust; a buried one destroys it.

## Part 3 — Growth & scale doctrine
The mission is 1e10× impact: an ecosystem that helps traders across every market/session/regime both
SURVIVE and PROFIT. The honest scaling path, in leverage order:

1. **The product is the scale lever, not our own trading.** We proved (~20 strategies, D-070..D-121) that
   accessible mechanical alpha is thin; the durable value is the risk/awareness co-pilot for the millions
   who trade regardless. It needs NO trading alpha from us → it scales without a capacity ceiling.
2. **Free-first infrastructure, paid only on proven ROI.** Data/compute default to free/OSS (Yahoo,
   Binance, Dukascopy, CBOE indices, Alpaca-free, Supabase, GitHub Pages). A paid feed/tool is acquired
   ONLY after a free path is exhausted AND the ROI is quantified — never as a first resort or a deferral.
3. **Everything shipped is: reproducible by the operator, machine-guarded (test/CI/cron), sourced in git,
   and honest about its N/limits.** Scale on a foundation others can trust — the guards ARE the moat.
4. **Distribution over features.** Once a real, verified tool exists (risk X-ray, co-pilot, prop-optimizer),
   the growth constraint is reach, not more code. Build for the trader-of-every-background (match edge to
   capital/skill; the risk engine is universal underneath).
5. **Awareness compounds.** Every market/session/timeframe/regime/event ingested makes the co-pilot more
   aware; awareness is the product's compounding asset — keep ingesting (data-aware, breadth-first).

## The one line
Research before you defer. Prove before you claim. Scale the product, not the promise. Free-first, paid-on-ROI.

## FREE + KEYLESS FIRST — no dollar gate on excellence (D-283, operator-locked)
PRINCIPLE: every data/infra problem gets a FREE, KEYLESS solution first. No dollar amount gates the level of
excellence we enforce across the stack. Paid/keyed data is a LAST resort, allowed ONLY after a VERIFIED search
proves no free keyless path AND with explicit ROI justification + operator greenlight — never a default, never a
reflex. "We'd need to buy X" is a RED FLAG that I stopped hunting too early (as I did reaching for Polygon).
VERIFIED free+keyless sources (proven, not assumed — D-283 probe):
  • Yahoo Finance — daily full history (global) + ~60d intraday, keyless. [works]
  • Binance /api/v3/klines — crypto: MULTI-YEAR 1m intraday, keyless, paginated (startTime). Proven back to 2018. [works]
  • Coinbase /products/*/candles — crypto candles, keyless. [works — fallback]
  • Stooq CSV — bot-blocked from edge (returns anti-bot HTML). [FAILED — do not use this way]
IMPLICATION: intraday-multi-year testing across the CRYPTO universe is now FREE+KEYLESS (Binance) — no paid feed.
Equities intraday-multi-year keyless remains genuinely scarce (Yahoo ~60d, Stooq blocked) — keep hunting (bulk
dumps, exchange APIs, archive mirrors) before ever proposing a paid feed. The doctrine binds: research the free
keyless path and VERIFY it before deferring to any dollar cost.


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
