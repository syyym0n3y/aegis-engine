# STATE — Aegis (live state)

## Last updated
**2026-08-14 (Opus 5) — D-314: completion probes on the other 24 crons — `trd_cron_health_v` went from
verifying 6 of 30 jobs to 30/30 mapped.** pg_cron's `succeeded` only ever meant `net.http_post` enqueued a
request; 24 jobs read `dispatch-only` and could have 500'd on every run without the monitor noticing. The 24
edge functions behind them now wrap their handler in a `SERVE()` shim writing a `trd_beat()` heartbeat with
**HTTP status + a 150-char response snippet**, and the view derives job→fn from `cron.job.command` by regex
instead of a hand-maintained list (**30/30 mapped, 0 unmapped**; any future `trd_*` cron is covered on
creation). Verified on the SCHEDULED path, not by deploy message: `trd-alpaca-equity-tick`, `trd-alpaca-tick`,
`trd_orbfollow_30m`, `trd_edge_factory_par_1m` and `trd_edge_stage2_3m` all beat from their own crons,
unprompted. **The new probe immediately caught a false alarm**: `trd_edge_stage2_3m` had flipped to
SILENT-FAIL-SUSPECT while healthy — its old `eng` probe inferred completion from OUTPUT rows, so "nothing to
test" looked identical to "crashed"; it now reads VERIFIED carrying `{"ok":true,"done":"all candidates stage-2
tested","nTrials":598740}`. **Live count: 14 VERIFIED-COMPLETING, 16 dispatch-only, 0 SILENT-FAIL-SUSPECT, 0
DISPATCH-FAILED.** The 16 are daily/weekly/nightly jobs that have not fired since deploy — that is the probe
working, not a gap; they clear on their next scheduled run. `deno check` green on all 24, `verify_jwt=false`
preserved, all 24 ACTIVE.

**2026-08-14 (Opus 5) — D-315: grammar widened to 20 triggers — `rsidiv`, the first condition that is a
DISAGREEMENT BETWEEN TWO SERIES; stage-2 record 538 tested / 0 survivors.** Loop healthy and writing: queue
`max(run_at)` 0.11 min old, 5,800 rows in the trailing 10 min, `done` 318,967 → **361,907** since the D-313
session (writes LAND, not merely "processed:N"). Queue 820,800 total — 361,907 done / 309,771 pending /
149,122 thin. Stage-2 fired once and **caught up**: 7 computed / 7 persisted / 0 lost at a true trial count of
**584,540**; cumulative **538 candidates, 538 tested — 523 stage2-killed, 15 thin, 0 survivors,
`trd_forward_candidates` = 0.** Shipped `rsidiv` (ingest id=25, web:tradersagency): all 19 prior triggers read
price geometry alone or an indicator ALONE — `rsi` a LEVEL cross, `supertrend` a STATE flip, `squeeze` a RATIO
of two volatility measures of the same bars. None compared the SHAPE of price against the SHAPE of momentum.
Bullish divergence = a LOWER swing low with a HIGHER RSI at that swing. **Entry timing has no free parameter:**
a fractal pivot (L=2) is not knowable until *k+L*, so the trigger fires on exactly one bar — the pivot's
confirmation bar — the first instant the divergence exists as information; nearest prior same-kind pivot only,
because scanning back for the best match is cherry-picking the trial counter cannot see. **Fixtures were
MEASURED, then asserted:** base pivot A low 89.30/RSI 16.77 vs B low 88.80/RSI 30.08 → 1 long +1R, with
`riskFrac` pinned at 3.8/92.6 so both the entry bar and the pivot-low stop are locked. **Negative control A
carries the weight** — the same confirmed LOWER swing low with the legs' force reversed (A low 94.30/RSI 24.71,
B low 88.30/RSI 23.46) → no disagreement, no trade; `breakout`/`nbar`/`sweep` cannot tell it from the base
case. **Not a re-skin of `rsi`, proven on the same bytes:** on those control bars plain `rsi` takes 2 longs and
`rsidiv` takes 0. Control B (higher low + diverging RSI) and a price-mirror short case complete the set.
**Machine guard shipped with it:** `?trigger=<class>` on `trd-edge-factory` — the page fetch has no ORDER BY,
so a newly seeded trigger sat tens of thousands of rows deep and its DEPLOY could only be verified by the CLI
message, never by output (the D-308 failure mode: an undeployed trigger falls through the `switch` and marks
every row `thin`, which reads like progress). Absent, behaviour is byte-unchanged. 20/20 grammar + **262/262
`_shared`** green, both edge fns redeployed. Seeded 2,700 specs × 16 markets = **43,200 rows**, verified by
SHA-256 (`de72aa4f…948c7659`) computed independently in Postgres and TypeScript over `enumerate()+specKey()`.
**Deploy verified by OUTPUT:** `?market=LINKUSDT&trigger=rsidiv` → **35 rows `done`, all non-null `n`, avg 104
trades (37–208), 5 thin, 0 passing the gate.** **Honest status: `rsidiv` has produced nothing — 0 candidates,
0 stage-2 survivors, 0 forward candidates; 43,160 rows still pending, its hypothesis is UNTESTED.** D-303's
diagnosis stands: the binding constraint is STOP GEOMETRY, not trigger vocabulary. ↓ prior stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-313: grammar widened to 19 triggers — `squeeze`, the first trigger whose condition is
a RATIO of two volatility measures; stage-2 record 253 tested / 0 survivors.** Loop healthy and writing: queue
`max(run_at)` 0.6 min old, `done` advanced 318,939 → 318,967 while this session ran (writes LAND, not merely
"processed:N"). Queue 777,600 total — 318,967 done / 326,771 pending / 131,862 thin. Stage-2 fired once and
returned `"all candidates stage-2 tested"` at a true trial count of **524,700**; cumulative **253 candidates,
253 tested — 238 stage2-killed, 15 thin, 0 survivors, `trd_forward_candidates` = 0.** Shipped `squeeze`
(ingest id=21, web:chartink): BB half-width (2·sd of 20 closes = where price SETTLED) vs KC half-width
(1.5·ATR(20) = how far it TRAVELLED). "Squeeze on" = BB entirely inside KC; the trade is the RELEASE bar, the
first bar the band escapes the channel. Direction from close vs the 20-bar basis, stop at the OPPOSITE Keltner
band — ATR-scaled by construction, the same D-303 `riskFrac` argument that motivated `supertrend`. **It is not
a duplicate of `nr7`/`inside`/`delivery`:** those measure ABSOLUTE range compression, this measures a RATIO, so
it is blind to scale and disagrees with them in both directions. **Negative control A carries the weight** — a
prelude of range-1.0 bars (8× tighter in absolute terms than the squeezed prelude) whose closes march +3/bar is
maximally "compressed" to those three triggers and NOT squeezed here, so the IDENTICAL drop must produce no
trade. 19/19 grammar + **261/261 `_shared`** green, `trd-edge-factory` redeployed. Seeded 2,700 specs × 16
markets = **43,200 rows**, verified by SHA-256 (`bfc17a15…bbf9987a`) computed independently in Postgres and
TypeScript over `enumerate()+specKey()`; the generator was first proved byte-exact by regenerating the
`supertrend` seed and diffing both directions against the live table (43,200 = 43,200, 0 rows either way).
**Detector verified by OUTPUT on live Binance 15m bars** (1,000 bars, rr=1, trendMode=none): BTCUSDT n=15,
ETHUSDT n=14, SOLUSDT n=20, DOGEUSDT n=14 in swing mode; median `riskFrac` 0.50–0.89% of notional (0.95–1.75%
at atr6) — above `MIN_RISK_FRAC` and inside the band that can pay a 10–20bp round trip. Expectancy at those N
is not a measurement of edge and is not reported as one. **Honest status: `squeeze` has produced nothing — 0
scored rows, 0 candidates, 0 stage-2 survivors, 0 forward candidates; its hypothesis is UNTESTED.** ↓ prior stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-312: grammar widened to 18 triggers — `supertrend`, the first VOLATILITY-NORMALISED
entry condition; stage-2 record 203 tested / 0 survivors.** Loop healthy and writing: queue `max(run_at)` 0.86
min old, 6,280 rows in the trailing 10 min, `done` 308,754 / pending 300,451 of 734,400 (lower than D-310's
327,779 because the D-310 58k + D-311 1,005 resets are re-draining, not a stall). D-311's guard
`trd_factory_promo_integrity_v` reads **CLEAN** (0 orphans). Stage-2 **caught up** — fired once, returned
`"all candidates stage-2 tested"` at a true trial count of **509,380**; cumulative **203 candidates, 203
tested — 188 killed, 15 thin, 0 survivors, `trd_forward_candidates` = 0.** Shipped `supertrend`: ATR appeared
in the grammar only as STOP geometry (D-305) and never as an ENTRY condition — bands at `mid ± 3×ATR(10)`
ratchet in the trend's favour and the state flips when a close breaches the far band. Chosen over the other 10
ingest primitives because D-303's binding constraint is stop geometry, and this is the only queued trigger
whose signal is scaled by current volatility (native ATR-sized stop → a `riskFrac` that might pay its fees).
Causal by construction (bar *k* reads only *k*, *k−1*); the seeded initial direction is quarantined by a `warm`
index so the first reported flip always comes from the recursion, not the assumption; identity-keyed WeakMap
memo (D-310). **Negative control B carries the weight** — the IDENTICAL 10-point drop after an ATR-8 prelude
must NOT fire, which is exactly what a raw `breakout`/`nbar` cannot distinguish. 18/18 grammar + **260/260
`_shared`** green, both edge fns redeployed. Seeded 2,700 specs × 16 markets = **43,200 rows**, verified by
SHA-256 (`4bd69a3d…6bd6c13`) computed independently in Postgres and TypeScript. **Deploy verified by OUTPUT**
(D-308 lesson): **35 rows `done`, all non-null `n`, avg 161 trades, range 33–303, 0 zero-trade rows.**
**Honest status: `supertrend` has produced nothing — 0 candidates, 0 stage-2 survivors, 0 forward candidates**;
43,160 rows still pending, so its hypothesis is UNTESTED. D-303's diagnosis stands. ↓ prior stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-311: factory swallowed-write audit — the scorecard promotion flush had stranded
1,005 gate-survivors before stage-2 could test them.** Audited all 8 `.catch(() => {})` write sites in
`trd-edge-factory`. A PostgREST 4xx/5xx does not throw, so the swallow reported false success (the D-307
class). CRITICAL site = the scorecard survivor flush: **measured 1,005 queue rows with `passes=true`
(`vs_random_t` 4.4–11.69, holds_both, ≥180 trades) in NEITHER scorecard NOR stage2_results** — stage-2 reads
candidates from scorecard, so it never tested them. Ruled out format-mismatch / stage-2-deletion / stale-flags
before calling it loss. Root cause is an **atomicity gap**: `passes=true` committed per-page, promotions
buffered to an end-of-request flush; the cron scores 40 specs/run at ~2.0s (a 200-spec batch returns
`WORKER_RESOURCE_LIMIT`), so any failure or isolate-kill between the two stranded the survivor silently. Fix:
ported stage-2's `writeRows`/`countPersisted`; **scorecard now leads** — a promoting row's `passes=true` is
committed only after its scorecard row is confirmed landed, else the spec is left pending (self-healing) and
counted; response reports `promoLost`/`queueLost`/`writeErrs` and returns HTTP 500 on any loss. The 3 other
dangerous sites (queue flush, trial-bump, seed, thin-PATCH) are now `res.ok`-checked; the benign bars-cache
write is left swallowed with a comment. **Machine guard: migration `0017` `trd_factory_promo_integrity_v`**
(passes=true ⇒ in scorecard OR stage2_results; flags `orphaned_after_fix` as a REGRESSION). **Recovery:** the
1,005 reset to pending for atomic re-scoring. Verified: post-fix live runs `promoLost:0 / queueLost:0`, guard
**CLEAN** (0 orphans), 259/259 `_shared` green, both fns redeployed. **Found no edge** — these are in-sample
first-pass survivors; stage-2's gauntlet will almost certainly kill them all, as it has all 200 so far. The
bug was destroying the engine's ability to test its own candidates, not hiding a strategy. ↓ prior stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-310: the `pullback` and `rsi` triggers were scored on ANOTHER COIN's EMA/RSI.**
Loop healthy and writing: queue `done` 319,951 → 327,779, `max(run_at)` 0.76 min old, 6,160 rows in the
trailing 10 min. Stage-2 **caught up** — fired once, returned `"all candidates stage-2 tested"` at a true
trial count of **489,960**; cumulative **200 candidates tested — 185 killed, 15 thin, 0 survivors,
`trd_forward_candidates` = 0.** Instead of an 18th trigger (D-303: trigger vocabulary is not the binding
constraint), fixed a silent correctness bug found while reading the grammar: the EMA/RSI memo caches were
keyed `` `${bars.length}:${period}` `` with **no market in the key**, and `trd_bars_cache` holds **exactly
35,040 bars for all 16 markets** — so every market collided, and a warm edge-function isolate served the
first market's indicator series to every market after it. `clearEmaCache()` existed and was called from
**nowhere**. Confined to the two triggers that read the cache (`passesTrend` computes its EMA locally and was
always correct), and it corrupts in **both directions** — measured pre-fix: `rsi` fabricated **10 trades on a
market whose own RSI yields 0**, `pullback` had all **36 of its real trades erased**. Fingerprint in live
data: two SOLUSDT `pullback` candidates identical at n=33 / abs_r=0.3276 / t=4.50 across *different* ema and
stopLookback settings. Fixed with `WeakMap` identity keying (exact, uncollidable, hit-rate-neutral) + a
regression test that is red on the old key. 259/259 `_shared` green, both edge fns redeployed. **4 `fac:*`
candidates quarantined** (all had already died in stage-2 — no false edge reached forward) and **58,396 queue
rows reset to pending**; verified by OUTPUT — 149 rows rescored in 3 min, 64 `done` with real counts (30–387).
**This found no edge; it destroyed and fabricated evidence, and the rescore may kill as many rows as it
revives.** D-303's diagnosis stands: the binding constraint is STOP GEOMETRY. ↓ prior status stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-308: grammar widened to 17 triggers (`choch`) — the first STRUCTURE-based primitive;
stage-2 record 199 tested / 0 survivors.** Loop healthy and writing: queue `done` 319,479 → 319,951 across this
session's checks, `max(run_at)` 0.85 min old, 6,400 rows in the trailing 10 min. Stage-2 is **caught up** —
fired once, returned `"all candidates stage-2 tested"` at a true trial count of **483,880**; cumulative **199
candidates, 199 tested — 184 killed, 15 thin, 0 survivors, `trd_forward_candidates` = 0.** Shipped `choch`
(change of character): all 16 prior triggers read a CANDLE or a ROLLING WINDOW — none read MARKET STRUCTURE.
`choch` fires only when a range break **reverses** an established swing-pivot structure (lower-high + lower-low,
then a close back above the last swing high). Point-in-time by construction: a fractal pivot at bar *k* needs
L=2 bars either side so it is not knowable until *k+L*; only pivots with `k+L <= i` are read, and it fails
closed under 2 highs + 2 lows. **Two negative controls carry the weight** — one breaks the same level inside an
UP structure (plain BOS continuation → must not fire; this is what proves `choch` is not a re-skinned
`breakout`), the other contracts the lows so no structure exists. 15/15 grammar + **258/258 `_shared`** green,
both edge fns redeployed. Closed out `bos` as a duplicate (it is `breakout`/`channel` minus the structure
precondition; seeding it would add 43,200 trials and deflate every other candidate's DSR for no information —
the D-304 `nr4` rationale). Seeded 2,700 specs × 16 markets = **43,200 rows**, **verified by SHA-256**
(`c50cdc67…07816d`) computed independently in Postgres and in TypeScript over `enumerate()`+`specKey()`, so no
orphaned rows. **Deploy verified by OUTPUT, not by the CLI message** — an undeployed trigger falls through the
`switch` and marks every row `thin`, which reads like progress; measured instead: **40 rows already `done`, all
non-null `n`, avg 718 trades, max 1,276, 0 passing the gate.** Also replaced the D-305 compat test's hardcoded
`16 * …` with `GRAMMAR.trigger.length * …` so a new trigger can never again silently drop a stop-mode rung.
**Honest status: `choch` has produced nothing — 0 candidates, 0 stage-2 survivors, 0 forward candidates**, and
43,160 of its rows are still pending (the factory's page fetch has no ORDER BY, so it consumes heap order —
behind, not starved). **D-303's diagnosis stands: the binding constraint is STOP GEOMETRY, not trigger
vocabulary.** ↓ prior status stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-307: stage-2 had written NOTHING for 5.6h; PostgREST was rejecting every
mixed-shape batch, silently.** Stage-2's last persisted row was 07:33Z; the 3-minute cron fired **140 times,
all HTTP 200**, and wrote **zero rows** (~113 wasted invocations reporting `ok:true, tested:12`). Root cause,
verified by making the write loud: `PGRST102 "All object keys must match"` (HTTP 400) — PostgREST demands an
identical key set across a bulk INSERT and rejects the batch **atomically**; stage-2 built three row shapes
(thin-no-`n`, thin-with-`n`, full verdict), so the first batch mixing thin with scored lost all 12 rows, then
rebuilt and re-failed the identical batch every 3 minutes forever. Fixed with one all-keys-explicit-null row
template **plus the guard that matters**: `writeRows()` checks `res.ok`, `countPersisted()` reads back what
landed, and the response reports `computed`/`persisted`/`lost` and returns **HTTP 500** when `lost > 0`.
Verified independently of the function's own claim: post-fix `computed 12 / persisted 12 / lost 0`, DB
`trd_stage2_results` **186 → 198** rows, `max(run_at)` 7s old. The outage hid no edge — it was destroying kill
verdicts. **198/199 candidates now tested: 183 killed, 15 thin, 0 survivors, `trd_forward_candidates` = 0.**
Queue healthy throughout (316,120 done, `run_at` 47s old). Same swallowed-write pattern remains at 8 sites in
`trd-edge-factory` — currently writing, so not in outage, but it is the same landmine and is its own unit. ↓

**2026-08-14 (Opus 5) — D-306: grammar widened to 16 triggers (`soldiers`); stage-2 record 139 tested / 0
survivors.** Loop healthy and writing: queue 62,417 done, max `run_at` 0.78 min old, 4,302 rows in the trailing
10 min. Stage-2 fired once (12 tested, 0 survivors); cumulative **139 tested, 0 survivors, 0 rows in
`trd_forward_candidates`** — every kill `unprofitable@pess-cost`, deflated Sharpe 0.000, walk-forward 0–3 of 5,
least-bad −0.018R at 20bp/side. Shipped `soldiers` (three white soldiers / three black crows — 3 strong
same-colour advancing bodies, each opening inside the prior body; point-in-time, + TWO negative controls each
isolating one requirement; 15/15 grammar + 257/257 `_shared` green, both edge fns redeployed) and seeded 2,700
specs × 16 markets = 43,200 rows. **Seed verified by SHA-256** against the TypeScript `specKey()` over the
sorted distinct keys — `528aae4c…847178` on both sides, so no orphaned rows. Its point is the head-to-head with
`nbar`, which reads the SAME three bars as a reversal: only one of the two readings can be right.
**Scheduling measured, not assumed:** the factory's page fetch has no ORDER BY, so it consumes heap order — a
5-min sample shows ~215 rows per trigger across all 15 pre-existing triggers, 100% `widestop`, 0 soldiers, i.e.
the scan is inside the D-305 block; at ~38k rows/hr against 615,070 pending, `soldiers` starts scoring in ~13–15
hours. Behind, not starved. **D-303's diagnosis stands — the binding constraint is STOP GEOMETRY, not trigger
vocabulary.** `soldiers` has produced nothing yet: 0 scored, 0 candidates, 0 survivors. ↓ prior status stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-305: STOP GEOMETRY is now a grammar axis + the random control was a false-positive
engine (found & fixed).** The constraint D-303 named is now expressible. MEASURED on live 15m bars first
(median ATR/price 0.16–0.25%; trigger stops 0.25–0.79% of notional → 1.85R round trip at the stage-2
pessimistic fee), then built to that measurement: 4 new stop modes — `atr2` (0.45% riskFrac, 0.883R, the rung
kept as a FAILING control), `atr6` (1.37%, 0.292R), `atr12` (2.72%, **0.147R**), `wide100` (0.85%, 0.471R, the
same widths via a non-ATR mechanic). Stop widening happens AFTER the trigger fires, so it never changes which
bars signal. Seeded 518,400 rows at priority 3; grammar is now 40,500 specs. **Backwards compat proven, not
assumed** — `stopMode` defaults to `swing`, `specKey` is byte-identical when absent, and a differential harness
(657 swing specs × 3 real markets vs the pre-change code) returned **0 mismatches**, so the 62k scored rows
stand. **Bug found in the process:** `randomControl` hardcoded the swing stop, so a wide-stop setup beat random
on fee asymmetry alone (D-146's exact failure, inside the gate meant to prevent it); plus a pre-existing
exploding-cost defect that let one degenerate control trade produce a −1,228R mean. Fixed via one shared
`stopForMode` for both legs, closed-only control trades, and a symmetric `MIN_RISK_FRAC` floor in the SCORERS
(not the generator, to preserve the scored rows). Quarantined 154 contaminated `fac:*` candidates (none had
reached stage-2) + reset 2,726 rows. **Verified: atr12 went from 44 passes/315 scored → 0 passes/26 scored** —
the passes were entirely the artifact. **The axis exists, is fee-payable, and has produced nothing yet: 0
candidates, 0 stage-2 survivors, 0 forward candidates.** ↓ prior status stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-304: grammar widened to 15 triggers (`star`); stage-2 record 36 tested / 0 survivors.**
Full-gauntlet loop healthy and writing: queue 53.7k/121k done, 6,400 rows written in a 10-min window, max
`run_at` 0.1 min old. Stage-2 fired once (11 tested, 0 survivors); cumulative 36 tested, **0 survivors, 0 rows
in `trd_forward_candidates`** — every kill is `unprofitable@pess-cost` with walk-forward 0-1 of 5 folds and
net_r_pess −0.02 … −4.19R. Shipped `star` (morning/evening star, 3-candle reversal, close-confirmed above the
impulse body midpoint, point-in-time, +negative-control test; 10/10 green, both edge fns redeployed) and seeded
540 specs × 16 markets = 8,640 rows; **verified live** — 333 already `done`, all with non-null n (avg 664
trades), 0 passing the factory gate. Closed out `vwap_reclaim` (no volume in `Bar` — structurally untestable)
and `nr4` (strictly weaker duplicate of `nr7`; would inflate the trial counter and deflate every other
candidate's DSR for no information). **The D-303 diagnosis stands: the binding constraint is STOP GEOMETRY, not
trigger vocabulary — a 15th trigger does not address it.** ↓ prior status stands. ↓

## Prior
**2026-08-14 (Opus 5) — D-303: the Edge Factory's COST MODEL was the bug; 147/147 candidates dead.**
Added `riskFrac` (=|entry−stop|/entry) to the grammar so a fee quoted in bps-of-notional can be converted
exactly into R. Measured: median stop on 15m crypto = **0.28% of notional**, so Binance's 10bp/side taker
really costs **0.54R per side** — the factory's flat 0.05R/side understated cost ~7×. Every one of the 147
promoted candidates flips from +0.138R avg gross to **−0.947R net**; best is −0.359R; **0/147 positive even
at a 5bp/side** perp/discount fee; 0/147 hold a majority of 6 walk-forward folds. Not one candidate's gross
expectancy (max +0.271R) reaches its own round-trip cost (min 0.516R). Shipped `trd-edge-stage2` (real cost
+ 6-fold WF + DSR vs the true trial count + PBO/CSCV over the selection neighbourhood) and FIXED the factory
gate at the source (gross run, per-trade riskFrac costing on setup, random-control, OOS and dollar legs).
No re-run of the 44.6k scored specs needed: under-costing only ever made the gate more permissive. The
failure is STOP GEOMETRY, not the trigger — every class dies identically; the next unit is widening the
grammar to stops/timeframes where 1R is ~1-2% of notional. Queue 47k/121k done, factory healthy. ↓ prior status stands. ↓

## Prior
**2026-08-08 (Opus 4.8) — DEFINITIVE GLOBAL VERDICT (FX-normalized, D-220).** Expanded intl universe to 693 liquid
names (18 exchanges) + FX-NORMALIZED the sweep (14 live FX pairs, GBp/ZAc handled → correct USD tiers). rip-short FAILS
at EVERY international tier (even large flat: -0.010, t=-0.30); D-219's positive was a currency artifact. **DEFINITIVE:
rip-short is US-quality-large-cap-SPECIFIC** — works only on a narrow pocket of liquid quality US large-caps (curated 30
= +0.342R t=6.77), marginal on broad US large, negative US mid/small/micro, and dead across ALL international tiers.
Likely a US-microstructure phenomenon (borrow depth / options-hedging flow / index mean-reversion) that doesn't
replicate abroad. Coverage: 100% US (9,850) + 693 FX-normalized intl / 18 exchanges → the illiquid ~50k global tail is
EMPTY; no new edge anywhere beyond the narrow US pocket. The BROAD edges are the factor/index ones (VRP, pairs, term-
structure, XS-momentum); rip-short/bbfade/crypto-momentum are narrow technical patterns. Global coverage program
COMPLETE. Sweeps resumable (`data/*_pool*.csv`). ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — INTERNATIONAL grind + coverage verdict SETTLED (D-219).** Sourced liquid intl universe
(357 large/mid-caps, 18 exchanges via Yahoo suffixes; Yahoo serves any ticker, bulk LISTS were the only gap — no free
keyless global-listing API). Grind: rip-short WEAK/not-significant on intl large-caps (t=0.98) — reinforces D-218:
**rip-short is a NARROW edge confined to liquid US quality large-caps**, weak even in international blue-chips, negative
across mid/small/micro + the illiquid tail. COVERAGE VERDICT: edges live in liquid quality names; the illiquid ~50k
tail is EMPTY (proven on 100% US 9,850 + a liquid intl cross-section). The literal 50k isn't free-bulk-sourceable and
harbors no edge, so grinding it reconfirms emptiness rather than finding edges. Sweeps resumable (`data/univ_pool.csv`,
`data/intl_pool.csv`). Other edges (VRP, pairs, term-structure, XS-momentum) are index/factor-level, unaffected.
↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — 100% US UNIVERSE SWEPT (9,850): rip-short is NARROW — DEFINITIVE (D-218).** Full sweep
settled a flip-flop I made 3× from partial samples: rip-short does NOT generalize across the universe. On full US
coverage (6,932 scored / 198k signals), mid/small/micro are all significantly NEGATIVE net of realistic cost+borrow;
only price-tier "large" is marginal (+0.031), and the real edge lives in liquid HIGH-QUALITY large-caps (curated 30 =
+0.342R t=6.77). D-217's "generalizes" was a largest-company-first ordering artifact (SEC file is size-ordered).
**Final envelope: rip-short = a NARROW edge on liquid+borrowable+quality large-caps (~dozens of names), small capacity —
NOT universe-wide.** Meta-lesson (paid 2×): never conclude from a partial/order-biased sample; 100% coverage is the
arbiter — the 50k ask was right. Sweep resumable; intl suffixes remain for global 50k but US verdict is definitive.
Other edges (VRP, pairs, term-structure, XS-momentum) are index/factor-level, unaffected. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — FULL-UNIVERSE COVERAGE (the 50k ask) + honest edge-narrowness correction (D-216).**
Sourced SEC 9,850 US filers (keyless) + built RESUMABLE liquidity-aware sweep (`scripts/trd-universe-sweep.ts` →
`data/univ_pool.csv`). First batch 459 stocks / 12k signals: **rip-short does NOT generalize broadly** — edge
negative/weak across all liquidity tiers with realistic per-tier cost + borrow; most signals fire on unborrowable
micro/small caps. VERIFIED (D-216b): curated 30 mega-caps HOLD at t=6.77 under identical cost → the narrowness is
GENUINE, not a cost artifact. **rip-short is deployable ONLY on liquid + borrowable + quality mega-caps** (a small set),
not universe-wide — sharpens the envelope honestly. Other edges (VRP, pairs, term-structure, XS-momentum) are
index/ETF/factor-level, not single-name-breadth-dependent. QUEUED/resumable: full 9,850 US at stride=1 + intl suffixes
toward global 50k. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — ANOMALY SPACE EXHAUSTED: 7 setup edges + 3 factor premia; live app at 7 (D-210…214).**
Term-structure roll (6th, USCI Sharpe 0.37 vs naive 0.02, roll drag 7-13%/yr) + cross-sectional momentum (7th, t=2.61)
added. Documented factors confirmed via ETFs: momentum/quality/min-vol REAL (corrects D-212 low-vol mega-cap artifact);
value/size decayed. Rejected: TS-momentum, pre-FOMC (decayed t=1.14), seasonality, lead-lag, carry. PEAD RUN (D-215, inconclusive on 1yr free Nasdaq data — fails magnitude signature; deep 20yr test needs keyed feed).
**7 discrete edges: rip-short · bbfade_lo/bear · crypto momentum · VRP · pairs/stat-arb · term-structure roll ·
cross-sectional momentum. + factor book (momentum/quality/min-vol).** Live app deployed at 7 edges via git pipeline
(github syyym0n3y/aegis-engine → aegis-engine-psi.vercel.app, dpl 6c87287 READY). Pattern definitive: risk premia +
conditioned technicals survive, folklore dies. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — QUEUE COMPLETE: FIVE verified edge families + live app deployed (D-208/209).** Research
queue run: seasonality REJECTED (arbitraged out), pairs/stat-arb VERIFIED (5th edge — market-neutral spread reversion,
24/24 pairs net-positive both-halves at pessimistic cost), lead-lag REJECTED (0/16), carry REJECTED (DBV Sharpe 0.03),
term-structure = VRP (no new edge). **FIVE verified edges: rip-short · bbfade_lo/bear · crypto momentum · variance
risk premium (options) · pairs/stat-arb.** Everything else rejects. LIVE APP DEPLOYED via git pipeline: github
syyym0n3y/aegis-engine main ← merged content commits (a6a455b 4-edges, a62a333 5-edges); Vercel auto-deployed to
aegis-engine-psi.vercel.app (dpl READY, tools intact, your 8 commits preserved). Remote `origin` now configured here.
↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — FOUR verified edge families + options wall OVERCOME + merged to main (D-206/207).** Framework
grid completed (weekly+4h, D-206): commodity momentum leans on weekly, nothing else new. OPTIONS now testable for free
(D-207): variance risk premium is real at every horizon/asset (implied>realized 80-87%), and CBOE's 34yr option-selling
indices (PutWrite/BuyWrite) beat SPY risk-adjusted (Sharpe 0.71/0.61 vs 0.55) — a 4th edge family (variance-premium
harvest, crash-gated). Overnight-drift anomaly tested (real for ETFs +10.3% vs +0.7% intraday, cost-gated). **Verified
edge families = 4: rip-short · bbfade_lo/bear · crypto momentum · variance-risk-premium (option-selling).** Research arc
D-146→D-207 MERGED to main (537e217) — main now holds all research + the updated live app (web/aegis-app/index.html,
3-edges content, checksum 7d3124d6; deploys via Vercel git pipeline on push to main). NEXT research agenda (queued, not
blocked): pairs/cointegration, seasonality, carry, term-structure roll-yield. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — THREE verified edges + the capped-stop survivorship principle (D-202…D-205).** Operator
caught a real bias (SPY-regime imposed on all assets + pooling dictating individuals); de-biased to per-instrument-own-
regime + count-inference (D-202). All timeframes tested (D-204, 5m→1h ladder): cost wall kills PROFIT not SKILL (5m
mean-rev beats random but nets negative; edges daily-locked). Crypto momentum survivorship-STRESSED (D-205): holds on
coins that cratered 54–100% (p=1.4e-10) → **the 1R-capped stop is STRUCTURALLY survivorship-proof in ANY direction**
(corrects my over-caution). **Verified tradeable set = 3: rip-short (equity daily, p=1e-7) · bbfade_lo/bear (equity
daily) · crypto momentum (daily Donchian-L, survivorship-checked; also 1h net+0.05R).** Crypto=momentum, equities=mean-
reversion (opposite). Status artifact: claude.ai/code/artifact/0874b850-4772-489b-9fbf-6e3aad33d34f. Live app is on
Vercel: aegis-engine-psi.vercel.app. Residual limiter: fully-delisted-to-zero names untestable free, but capped-stop
bounds that exposure structurally. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — COMPLETE MULTI-ASSET PICTURE (D-200/201).** Built the per-instance "trade the chart" engine
(`trd-instances.ts`, D-200): 240 instances/8 charts → 0 survive program-wide deflation — per-instance is the DEPLOYMENT
model (=trd_forward), a false-positive factory as naive discovery. Then the COMPLETE SWEEP (`trd-complete.ts`, D-201):
154 instruments × 9 asset classes (equities mega/mid/battered, sector+intl ETFs, commodities, FX, crypto, rates) × 6
setups, gated+deflated+both-halves. Funnel 132 cells→32 raw→10 deflated→**4 robust (all rip-short**, now proven across
cap tiers incl the battered tail, both-halves stable = capped-short survivorship-immunity confirmed). Crypto momentum
t=6.17 EXPOSED as survivorship/era mirage (both-halves half-flip) — the trap the gate caught. One new lead: etf-intl
donch_L/bear (t=4.43, both-halves ✓, needs survivorship-free check). Updated status artifact:
claude.ai/code/artifact/0874b850-4772-489b-9fbf-6e3aad33d34f. Thesis CONFIRMED not overturned: across the whole tested
market, ONE edge family (rip-short) clears every honest filter. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — BOTH edges wired + verified dormant-by-market (D-197…D-199).** Two survivorship-checked
edges now run live on the $0 virtual forward tracker (cron 6h): rip-short (bull-regime short) + bbfade_lo/bear
(bear-regime long, D-197 — edge GROWS on a battered universe, opposite of dip-buy's mirage; 8 legs registered,
detector extended with band-mode + SPY-bear regime gate, 9/9 tests green). Demo BROKER (Alpaca paper) executor
deployed DORMANT (arm=false, killswitch=false) + owner-run `scripts/demo-exec.sh` {status|arm|disarm|kill|tick|forward}
— Claude does NOT arm; one operator command goes live. VERIFIED (D-199): 0 forward trades = honest scarcity — 9/10
rip-short names above their 200MA in this bull tape, so the overbought-in-downtrend signal cannot fire; bbfade needs
SPY<200MA. Both edges dormant-BY-MARKET; arming now places 0 trades (correct, D-070). Next signal comes from the
MARKET (a regime that offers a setup) or the operator arming demo — NOT more backtests. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — AUGMENTATION program CLOSED + 3rd social decode (D-193…D-196).** Confluence question fully
answered: it does NOT help — correlated (D-194) OR orthogonal (D-195, zero incremental lift; stacking stress axes is
net-negative → selects bear regime). rip-short's "when" = one regime filter (bull+high-vol), not a stack. DECODED
Trades By Sci (@tradesbysci, 539k subs, $199 course): 6/6 method pillars (S&D, liquidity, market-structure/BOS,
order-blocks/FVG, trend, "no-trade-until-break") all land in already-falsified space; the exact demand-zone gold long
(`scripts/trd-gold-sr.ts`) = random (+0.25R setupR is pure gold drift, NEGATIVE edge in its own downtrend regime); the
$8.5M panel = drift×leverage (260% margin level), not edge. `DECODE_tradesbysci.md` + `AUGMENTATION.md` are the
deliverables. Tests are FINISHED (only untested lever = a non-stress orthogonal axis e.g. flow/positioning — no free
source in hand). $0, no order path touched. ↓ prior status stands. ↓

**2026-08-08 (Opus 4.8) — PIVOT to AUGMENTATION (D-193/194).** Engine reframed from "falsify" to "tell the trader
when/what/which-regime." Two builds: (1) the PRECISE 7-step ICT composition (`trd-alpaca-ict`, ~4,800 setups on
GLD/SLV/SPY/QQQ) is REJECTED and *worse than random* (t=−3 to −7) — FVG/BOS confirmation makes you enter late, after
the reversion is spent. (2) The AUGMENTATION MAP (`scripts/trd-augment.ts`, `AUGMENTATION.md`) gates each family per
regime×vol cell, deflated: **regime-conditioning works** (rip-short +0.057R→+0.109R restricted to high-vol bull);
**confluence-stacking FAILS** (correlated setups agreeing = weaker, not stronger — redundant confirmation destroys
power); **two falsified families hold a conditional edge** (Bollinger-fade-LONG in bear = deflated +0.078R t=3.69
n=7,230; dip-buy in bear/stress = +0.215R raw t=2.24, promising-not-proven). bbfade_lo/bear = new forward candidate.
$0, no order path touched. ↓ prior program-complete status stands underneath. ↓

**2026-08-08 (Opus 5) — PROGRAM COMPLETE: every PLAYBOOK gap closed; ONE edge fully characterized (D-146…D-192).**
Exhaustive falsification done end-to-end for $0. THE ANSWER: exactly one edge survives every test —
**rip-short** (short RSI>70 while <200MA), a SMALL BULL-REGIME mean-reversion short on liquid equities (D-179
t=7.23; survives program-wide deflation to N=100k, D-191), corroborated independently on crypto 5m (D-170). Its
full deployment envelope is now known: **liquid + easy-to-borrow names, SPY>200MA regime only, small size,
hedged/market-neutral** (standalone short book = 32% DD from bear squeezes, D-189/191; slippage-robust to ~28bp
and liquids 100% ETB, D-190). **dip-buy** hourly FAILS program-wide deflation → false positive (D-191, demoted).
Everything momentum / breakout / cross-sectional reversal (D-188) / minute (D-187) is DEAD. Gaps all closed:
fills+capacity (D-190), concurrency (D-189), regime (D-191), cross-sectional (D-188), look-ahead + crypto-
survivorship (D-192). Forward paper: 24 candidates live, borrow-modeled (D-185), cron 6h. Real-fills path built
DORMANT (`trd-alpaca-paper-exec`, armed-OFF via trd_exec_arm; kill-switch+regime+ETB+heat gated) — operator arms
it to cross into execution; Claude does not. Free-solution map exercised (Alpaca minute, Dukascopy, Stooq
allowlisted). PLAYBOOK.md = the transferable buy/sell patterns. 234 TS + 3 Py tests green. $0 spent, no order
placed. Next signal comes from TIME (forward clocks / arming the paper executor), not more backtests.

## Prior
**2026-08-08 (Opus 5) — MULTI-TIMEFRAME SWEEP COMPLETE + 2 SURVIVORS IN FORWARD PAPER (D-170…D-186).** The LEAN+gate
port (D-174) ran the survivorship-free US-equity universe across DAILY (top-500), HOUR (top-200) and attempted
MINUTE (free-node ceiling, D-181), plus BTC/ETH crypto and all intraday SESSIONS (D-170) — every gate: random-
control (D-146) + Bonferroni deflation + both-halves + real borrow. **Two timeframe-locked mean-reversion edges
survived, both now in forward paper (24 candidates, $0, no order path, cron 6h):**
  • **rip-short** (RSI>70 & <200MA, short) — DAILY equities (D-179, t=7.23) AND crypto 5m (D-170, t=8.07). Robustness
    D-184: sign-robust 39/54 variants, PBO 40% (NOT overfit) — a real but SMALL cross-sectional/breadth edge; trade
    wide-and-thin, never concentrated. THE stronger survivor. Forward: 10 per-symbol legs + crypto legs.
  • **dip-buy** (RSI<30 & >200MA, long) — HOURLY equities (D-180, t=3.73, modest). Robustness D-186: FRAGILE out-of-
    window (17/54 positive on recent 2y) → regime-suspect, LOW confidence. Weak link; in forward paper but do not size.
Everything momentum/breakout is DEAD at every timeframe. Survivorship bias was the source of the curated-data false
positives (D-176/177). Borrow now modeled in the tracker (D-185, v2). Free-solution map for every "paid" frontier in
FREE_SOLUTIONS.md — minute-universe (local LEAN + Alpaca-free/Dukascopy), futures/FX (Dukascopy), global (Stooq,
survivorship-biased-but-quantified); the only remaining steps are operator-gated CREDENTIALS (Alpaca key / Dukascopy
endpoint), not effort. Promotion gate unchanged: >=30 forward trades, positive mean consistent with in-sample, before
micro. 234 TS + 3 Py tests green. $0 spent this entire arc.

## Prior
**2026-08-07 (Opus 4.8) — FORWARD PAPER LIVE for the first-ever gate survivor (D-171).** The D-170 full sweep (92 cells across NASDAQ/S&P500/BTC/ETH × 5 TFs × sessions × long/short, each vs its own random control) found exactly ONE survivor of random-control + trial-deflation + both-halves + walk-forward OOS: **BTC/5m mean-reversion short** (t=8.07; OOS +0.29R/t4.7; real at ≤5bp/side, dead at 10bp retail spot). It is now under autonomous forward PAPER: migration `0013_trd_forward_paper.sql` (general registry `trd_forward` + append-only ledger `trd_forward_trade` + rollup `trd_forward_state`), edge fn `trd-forward-tick` (kill-switch-gated, Yahoo feed, keyless, verify_jwt=false), cron `trd-forward-forward` @ 43 */6 (jobid 24). Seeded with the survivor + two near-miss controls (eth-5m-short, btc-5m-long) so "all instruments/TFs considered" is a one-row insert and the controls falsify our deflation threshold. Verified live end-to-end: append-only trigger blocks DELETE, idempotency holds (probe 11 trades → re-tick N=11), ledger clean, forward clock started 2026-08-07. Promotion gate: ≥30 forward trades + positive mean consistent with in-sample, ≤5bp exec — still behind every LADDER rung. $0, no order path. Operator surface: `scripts/trd-forward-status.sh`. 234 tests green.

## Prior
**2026-08-04 (Opus 4.8) — FRONTIER COMPLETE + SYSTEM AUTONOMOUS (D-086…D-093).** The full edge-lens map is swept and the system runs without the operator. **Live public app:** https://syyym0n3y.github.io/aegis-engine/ (GitHub Pages — Vercel create-project is 403-blocked on the operator's role; Supabase edge fns force text/plain so can't serve browser HTML — both worked around, D-086/087). Tabbed SPA: live cockpit + Risk-Xray + Authenticity + Allocator, verified in-browser, CORS-open APIs. **5 autonomous edge fns, all healthy + cronned:** trd-paper-tick (6h), trd-macro-pump (4×/day), trd-prereg-tick (6h), trd-tbr-tick (weekdays 21:00), trd-squeeze-tick (daily 01:30). **3 pre-registered forward hypotheses** (all $0 real money, forward-testing, on the app): btc-sweep-rr3-v1, gold-tbr-v1, btc-squeeze-v1 — all high-RR crypto/Gold vol-liquidity events. **Edge-lens taxonomy (R-003) COMPLETE:** 12 lenses + COT tested (D-090…D-093) — cross-sectional(weak), calendar(dead), event/pre-FOMC(dead, arbitraged away), intermarket(dead), funding(thin), order-flow/CVD(dead via FREE binance klines → paying for tick NOT justified), vol-regime(clustering validates risk-layer + BTC squeeze lead), COT positioning(folklore, no tradeable edge). **Corpus (trd_strategies): 12 rows, 4 hard-DEAD, 0 tradeable survivors.** Cross-cutting law proven across every dimension: the edge is slow factor-premia + risk management; everything fast/directional/anomaly is efficiently priced. Sizing doctrine locked (operating-principle-domination memory): factor book unlevered sized to drawdown tolerance (10% dd → ~33% investable); strategies $0 until forward-clear, ~1% per trade never 10%.

## Prior
**2026-08-04 (Opus 4.8) — PRE-REGISTERED HYPOTHESIS + MACRO CORRELATION (D-083/D-084).** Universe sweep (D-083): 4,320 strategies × 20 markets × 3 timeframes × 8 regimes = **1,010,539 conditional cells over 419,725 real bars → 0 clear DSR** (the mechanical retail genre has no deflation-surviving edge across the tradeable universe; only the global factor book D-077 ever cleared). The one robust lead (BTC 15m liquidity-sweep, EMA20, wide 3:1 targets) is now FROZEN as a pre-registered hypothesis (`trd_prereg` `btc-sweep-rr3-v1`) with an autonomous forward tracker (`trd-prereg-tick`, cron 6h) that counts ONLY post-registration trades → a single un-deflated trial. Honest baseline: its unconditional 60d expectancy is −0.057R (the big numbers were cherry-picked cells); forward test settles it at n≥30. Macro correlation (D-084): chart edges have **near-zero correlation with VIX/yield-curve**; concrete tie found — BTC-sweep degrades when the curve inverts (+0.13R→−0.60R), recorded as its deployment gate. `scripts/trd-refine.sh` reproduces every calculation in one command. `trd_goldmine` persists top candidates. Grammar = 8 trigger classes; 131 tests green.

## Prior
**2026-08-03 (Opus 4.8) — STRATEGY ALGEBRA + MASS SEARCH (D-081).** Aegis can now assess strategies at scale AND falsify them honestly. `_shared/trd-grammar.ts` = a component algebra (trigger × EMA × trend × stop × RR × session = 2160 composed strategies; 4 trigger classes: sweep/fvg/breakout/pullback). `scripts/trd-strategy-search.ts` runs all 2160 × 4 real markets (Gold/BTC/ETH/S&P, keyless Yahoo 15m) and deflates via the existing `deflatedSharpe`(by trial count)+PBO core. Live result: 8,640 trials → 1,613 positive in-sample → 662 positive OOS → **0 clear DSR** (all multiple-testing artifacts; best survivor DSR 63%). Also D-080: faithfully implemented + **falsified** the viral "XAU 15m liquidity-grab 76.53% win" claim (real gold: 44% win, −0.192R, t=−3.34). CC `trd_strategies` corpus table catalogs each assessed strategy + verdict (seeded D-080/D-081). 131 tests green. Honest lead: sweep+rr3+London on crypto is least-overfit (still fails DSR). Bulk YouTube ingest remains gated; scalable path is the grammar (feed strategy → decompose → already in the search space).

## Prior
**2026-08-03 (Opus 4.8) — MACRO-REGIME OVERLAY LIVE (D-079).** Added the top-down layer the platform lacked: `_shared/trd-macro.ts` classifies where an economy sits in its cycle (EXPANSION→LATE_CYCLE→CONTRACTION→RECOVERY) from point-in-time yield-curve / credit / Sahm-unemployment / PMI / vol signals and emits a de-risk MULTIPLIER (0,1] that ONLY shrinks size when the regime is fragile — never predicts direction (macro = fragility, not forecasting; see D-079). Wired LIVE + autonomous, $0/keyless: `trd-macro-pump` (Yahoo curve+vol, since FRED's CDN blocks the Supabase datacenter) → `trd_macro_state` → `trd-paper-tick` throttles every order by the factor → `aegis-cockpit` shows the cycle + de-risk + honest "what to expect". `pg_cron` runs the pump 4×/day, 5 min before each 6h bot tick. Current read: curve +0.99pp, VIX 28th pct → EXPANSION, de-risk 1.0 (overlay a no-op in today's calm tape). 125 tests green; edge-fn deps are now symlinks to the tested `_shared` modules (repo == tested == deployed). Best-effort FRED enrichment (credit/unemployment/CPI) via `scripts/trd-macro-refresh.ts`.

## Prior
**2026-08-03 (Opus 4.8) — PLATFORM SHIPPED (D-078). The full product is built, tested (119/119 green), and LIVE.** Nine engine modules in `supabase/functions/_shared/` — Verify, Protect, Allocate, Normalize, Platform, Uplift, Firewall, Setups, Bot, Paper-Broker — wired into live edge-fn APIs (`trd-api-verify/protect/allocate`, `trd-platform`) + a **public web tool** (`web/aegis-terminal.html`, served at `glzz…supabase.co/functions/v1/aegis-terminal` — client-side, any broker, free). Migration `0003_trd_platform.sql`. Proven end-to-end on real data: the risk firewall KEEPS accounts alive even trading a losing strategy (BTC 15m paper sim: −10%/1.6y but 11% maxDD, no ruin); the adaptive allocator COMPOUNDS when a real edge is in the pool (capstone: 100% weight on the global factor book → 30.8×/36y, Sharpe 1.13). Global factor validation (free Fama-French, D-077) is the compounding engine — a diversified risk-premia book, NOT chart signals (all falsified across D-071..D-077). Data pipelines (`trd-fetch-ff`, `trd-ingest-daily/alpaca/edgar-fund`) + scratch tables on **command-centre (glzz)** — trd_* isolation deferred (2-free-project cost limit). OPEN: teardown of temp research probe fns (no MCP delete → dashboard); branded domain; auth/billing; close risk-inventory gaps (slippage/gap/fat-tail/reconcile). Live broker execution stays paper-first behind the gates.

## Prior (2026-06-07 (Opus 4.8 [1m]) — D-072 SECOND POND PASS: ~16/16 securities strategies rejected; the real edge is the operator's OWN creator business (Pond H), not a trade. Barbell direction: Ireland-UCITS index core (US-situs estate-tax trap is LETHAL for a SA national) + ISA/SIPP tax wrapper (highest-certainty edge) + tiny finite UK-trust-discount tilt + BUILD the creator substrate (unmonetized on the visa; Graduate Route before 31 Dec 2026, then monetize). Aegis pivots: alpha-finder → folklore-falsifier + core-protector. (D-071: first pass, 3/3 real-data kills incl. 18yr trend.) 42 tests, $0.**

## Where we are
- New CC vertical **Aegis**, own repo `/Users/ona/Projects/aegis`. D-070 locked.
  Target re-anchored to "prove a real positive edge net of costs, then scale only
  what's proven" (operator-confirmed).
- **Provisioning: $0 LOCAL-DEV — DB IS UP.** Docker wasn't installed → installed
  **Colima** (free FOSS runtime, `brew install colima docker`; analytics disabled
  in `config.toml` for the Colima docker.sock quirk). `supabase start` runs the
  local stack; **`0001` applied + VERIFIED on live Postgres** (12 tables;
  append-only UPDATE/DELETE both raise; idempotency dup→unique-violation,
  on-conflict→no-op; 4 gate thresholds seeded). **Nothing billed.** Cloud ($10/mo,
  always-on) still required before any real autonomy — local is laptop-only dev.
  Stop the stack with `supabase stop` + `colima stop` (a VM runs while up).
- **Built + verified this session (30 unit tests green, `deno check` clean, all offline, $0):**
  - Honest-stats core (`_shared/trd-stats.ts`): PSR / **Deflated Sharpe** / MinTRL /
    **PBO-via-CSCV** + Sharpe/Sortino/maxDD/Calmar + erf/normalCdf/invNorm.
  - **Backtest core (`_shared/trd-backtest-core.ts`):** OLS factor decomposition
    with per-coef **t-stats** (residual alpha must be statistically SIGNIFICANT,
    not just positive), expanding walk-forward, and the REJECT-by-default gate.
  - **Strategy interpreter + orchestrator (`_shared/trd-strategy.ts`):** declarative
    JSON specs (universe/signal/sizing), point-in-time decision loop (asOf INSIDE
    the loop), bar-N+1 fills, turnover cost, idempotent content-addressed runKey.
  - **Runtime self-test (`_shared/trd-selftest.ts`):** proves the engine still kills
    bad strategies (overfit→PBO, noise→reject, look-ahead→blocked, **congressional
    copycat→unmasked as sector beta & REJECTED**) — the eventual `agent-trd-backtest`
    refuses to run if it fails. **This IS the D-070 Stage-1 success metric, demonstrated.**
  - Pessimistic cost model + point-in-time (look-ahead-fail-closed) modules + tests.
  - `0001_trd_substrate.sql` — 12 `trd_*` tables incl. `trd_manual_trades`
    (manual log), `trd_gate_thresholds` (decision-locked), price-revision
    bitemporality. Append-only triggers + RLS + seeded thresholds. **Written, not
    yet applied** (needs local Docker or the cloud project).
  - Governance: CLAUDE.md, DECISIONS.md (D-070 + adversarial addendum), LADDER.md,
    RISK_POLICY.md, docs/trd/STAGE1.md. Committed (`8291225` + rebrand/backtest-core).
- Design hardened by an 8-agent research+adversarial workflow (`wf_720b2865-2f3`);
  both verify passes returned **sound-with-fixes**; all fixes folded into D-070.

## Stage-1 pipeline — DONE + verified on real data (operator-owned CLIs)
`./scripts/trd-ingest-edgar.ts [YYYYMMDD] [limit]` → `./scripts/trd-build-features.ts`
→ `./scripts/trd-backtest.ts` (self-test gate + persists verdict) → `./scripts/trd-report.ts`.
Proven: 28 real Form-4s → 18 PIT features → copycat REJECTED (r2=0.96, β=0.85,
residual-α t=−0.85). The honest engine, on live data, $0.

## Next moves
The insider cluster-buy backtest is BUILT + executes (`./scripts/trd-insider-backtest.ts`)
but reports INSUFFICIENT DATA — it needs two inputs:
1. **Real prices (OPERATOR, 2 min):** Stooq is dead (JS anti-bot). Create a free
   Alpaca PAPER account (no money) → `APCA_API_KEY_ID/SECRET` → `./scripts/trd-ingest-prices.ts`.
   (Or authorize a different free feed — Yahoo chart API — for the allowlist.)
2. **Buy-event backfill (CLAUDE, free/slow):** our 1-day EDGAR sample had 0
   open-market buys (they're rare). Run `./scripts/trd-ingest-edgar.ts` over ~10-15
   recent days to surface real cluster-buys → rebuild features → real signal.
3. Then: run `trd-insider-backtest` → real verdict (expect REJECTED — small n / no
   significant edge — the honest likely outcome).
4. **Hosted path (cloud-time, deferred — NOT half-built):** thin `agent-trd-*` edge-fn
   wrappers + `cc-trd-report` CC panel + CI `runSelfTest()` ratchet — only matter once
   the $10/mo cloud project exists. Congress ingestion deferred (House PTRs are messy
   PDFs; EDGAR/Form-4 is the cleaner + stronger signal).

## Blocked on operator (free actions / config)
- ✅ ~~Start Docker~~ — Colima installed + local DB up + `0001` verified.
- ✅ ~~Allowlist the 4 legal data-source endpoints~~ — added (House/Senate/SEC/Alpaca).
- **Alpaca paper** account → creds for Vault `cc_trd_alpaca_paper_*` (free, paper only).
  Needed only for `agent-trd-ingest-prices`; congress + EDGAR ingestion don't need it.
- (Later) cloud project for always-on autonomy; broker/budget/475(f) for real money.
- Sign off / amend gate thresholds (D-070 seeds) via a decision-ref row (optional).
- (Later, real-money only) broker choice, R&D budget $ for MICRO/SMALL, IRS
  475(f) timing — flagged in D-070, not blocking Stage 1.

## Parallel track (the financier)
YGS finance channel (honest "we tried to copy Congress, here's why it fails, with
receipts" + the REJECTED list) — funds the R&D budget. Audience → trading, never
reverse. Not yet started; lives in the YGS/CC substrate, consumes
`trd_backtest_runs` as content input.
