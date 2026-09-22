# THE BIG PICTURE — what this program is, conceptually (2026-09-22)

> Every number below carries its D-entry. This is the conceptual map of ~960 decisions,
> written so the whole arc can be judged at once instead of one verdict at a time.

## 1. What was actually built

Not a trading bot. **A machine that makes it structurally hard to lie to ourselves about
money** — and only what survives that machine gets capital. The base rate demanded it
(~97% of retail lose; D-070 set REJECT as the default verdict). Ten weeks and ~2.9M
counted trials later, the machine's product is exactly what it was designed to produce:
a small set of survivors surrounded by a large, documented graveyard — and the graveyard
is load-bearing, because every killed idea is a mistake we can never silently re-make.

## 2. The one causal thesis that survived everything

Line up every survivor and they are the same phenomenon:

**Visible constraint → forced flow → we take the other side with patience.**

| Survivor | Visible constraint | Forced flow harvested |
|---|---|---|
| Distress short (D-930/935/936) | going-concern / late filings; short-sale limits slow correction | months-long forced repricing into delisting |
| IVOL short leg (D-939/953) | lottery demand + borrow constraints block arbitrage | overpriced junk bleeding back — strongest in extremes |
| Trend sleeve (D-868..872) | institutional inertia, slow rebalancing | multi-month herding |
| Session-sweep fade K24 (D-767/823/825) | stop clusters at public session levels | the sweep is stop-flow; the reversion is its exhaustion |
| De-gross overlay (D-947/953b) | short-book crowding (days-cover) | steps aside when the forced flow aims at us |
| Gamma regime (D-961, descriptive) | dealer OI positioning (public daily) | hedging flow damps next-day vol (t −4.4 beyond vol clustering) |
| Ballast / ISA (D-735/746/758) | tax code + compounding | the certain flow — deposits, untaxed |

The corollary is predictive: **we never predict prices; we predict who will be forced to
trade**, because constraints (filings, short interest, session levels, OI, rebalance
calendars) are public *before* the flow happens. Everything that failed — order-flow
scalps, ORB, calendar effects (TOM, D-962), pinning (D-820), squeeze hedges (D-946) —
failed because it had no forced counterparty, only a pattern.

## 3. The laws, read conceptually: each one names a way a number lies

| Law | The lie it kills |
|---|---|
| COVERAGE | "absence of evidence" dressed as "evidence of absence" |
| BENCHMARK | drift dressed as edge (D-962's TOM died here in one line) |
| LIQUIDITY / BREADTH / UNIVERSE | a few names dressed as a factor |
| EFFECT-SIZE / TURNOVER / COST-INFLATION | significance dressed as money |
| EXECUTION + lag-1 | a fill you'd never get dressed as a return |
| SELECTION | hindsight in the *choice* of what to keep |
| SIGN / MECHANISM / PRE-COMMITMENT | the story rewritten after the data arrived |
| INSTRUMENT | a research proxy dressed as a tradable vehicle |
| HOLDABILITY | a Sharpe you couldn't have lived through |
| CONTINUITY / PRECONDITION / POSITIVE-CONTROL | machinery that certifies while reading nothing |

Together they are one idea: **out-of-sample and its cousins are causality detectors** —
a fitted pattern has no cause and cannot transfer; a constraint-driven flow has one and
does. This is why the survivors form a single causal family: the laws filtered for
*mechanism*, not for backtest beauty.

## 4. The arc, in five eras

1. **Pattern era** — candle grammar, SMC, sweeps-as-signals. Nearly all sub-fee or
   selection artifacts. Lesson: effects without causes don't transfer.
2. **Pivot to forces** (causal-force pivot) — decompose moves into named mechanisms.
3. **Law era** (D-419..D-662) — every retraction became machine enforcement; 32 guards.
4. **Breakthrough** (D-930..D-953) — short-sale-constrained mispricing found: distress +
   IVOL lift the blend to excess Sharpe **2.08** (net-financed, D-913 discipline),
   IVOL-concentration made it hand-fillable, de-gross insured the joint squeeze tail.
5. **Deployment & ecosystem** (D-954..) — runbook, executor (D-957, DORMANT, gated),
   verticals split (ballast = certain money + wealth ledger; assay = claims lab),
   night-shift infra (D-959), forward clocks doing the waiting.

## 5. The stones: what we hold vs what is still unmined

**Held and mined:** deep equity daily panel (+fundamentals point-in-time), 12-instrument
hourly panel (~13y), NQ 1m (936d), crypto perps 5m/1m, FRED macro (1.25M rows / 15,188
series — register row corrected 2026-09-22, it was stale), SPXW per-strike OI (120d),
SEC filings families, short interest, S&P membership changes 1976–2026 (407 events — D-963 verdict:
forced-flow FOOTPRINT CONFIRMED both sides, run-up t 3.65/−2.41, signs matched;
TRADABLE-DEAD at lag-1 without announcement dates, which are the re-entry gate),
CoinGecko top-1750 (D-964 cohort base rate: survivors sit at median −85% from ATH),
CEF universe, trade-journal + micro-ledger (empty, awaiting fills).

**Unmined, free, engine-actionable now:** CoinGecko/Blockchair (allowlisted, ping
verified 2026-09-22) — cross-venue crypto reference + on-chain.

**Unmined, operator-unlockable free:** FINRA TRACE (free credential) — the only real
credit-bond flow source; binance.vision archive (one allowlist line) — completes the
delisted-perp cohort; Solana/pump.fun sources (allowlist) — unlocks assay's memecoin
claims.

**Paid, decision-gated:** multi-year SPXW OI (validates D-961 across regimes; 5mo cost
$26); intraday equities; options IV history.

**Structural, and the IBKR account dissolves two at once:** real fills (the D-592 class)
and borrow rates (SLB) — the two datasets no vendor can honestly sell us arrive the day
the account opens.

## 6. The goal, in one honest paragraph

The blend at quarter-Kelly compounds ~57%/yr on the measured record; £50k seeded reaches
£1M in ~6–7 median years, £500/mo from zero in ~15, with a ~50–58% median max drawdown
and multi-year underwater stretches on the way — the price is nerve, not luck (D-950,
ballast horizon model). Capacity ~$1–5M means the edge carries a person, not a fund —
beyond it, ballast and the content business compound what the edge earned. The binding
constraint today is not another edge. It is the NI number → IBKR + ISA → armed capital →
real fills feeding the ledgers that are, deliberately, still empty.

*Kept honest by the no-completeness rule: this map is current, not final. The open list
lives in the gap register and NEXT queues, and D-960/963's clocks are running.*
