# STRATEGY — the reverse-engineered pathway (synthesis 2026-09-16)

> Big picture, compiled across D-917..D-932 and the full data stack (19,728 deep-panel instruments, 14,579 macro
> series / 1.06M rows, 287k COT, 3.9M short-interest, 10.8M fails-to-deliver, 655k FX-hourly). Every conclusion below
> is reverse-engineered from a pre-registered test with receipts.

## What the whole arc proved (reverse-engineered)
1. **Markets at our horizons/instruments are ~3 factors + unpredictable noise (D-920).** 32.8% of the median
   instrument's variance is common-factor beta (equity market, BTC, rates); the 67% residual has ~zero autocorrelation.
2. **Every single-variable timing edge is sub-cost or decays out of sample** — surface (D-917), confluence (D-919),
   intraday order-flow = bid-ask bounce (D-921/925), positioning/options (D-923), cross-instrument lead-lag (D-927),
   on-chain (D-928), attention (D-929). The residual cannot be timed cheaply.
3. **The only things that work are structural, not predictive:**
   - **Diversification across independent premia — the free lunch.** Sharpe ladder as each independent factor is added:
     **trend 0.74 -> +long 0.89 -> +crypto-momentum 1.09 -> +going-concern short 1.60** (D-922/924/932).
   - **Leverage** on that Sharpe (bounded by drawdown, not edge).
   - **Stake** — the largest *safe* compressor of the timeline.
4. **The breakthrough (D-930/931/932): the going-concern distress SHORT.** The first strong cross-sectional edge in
   this program that does NOT die in the liquid tercile (it strengthens: liquid 126d excess -24.6%, t -8.5). Borrow
   survives on the non-crowded majority (~40%/yr net). As a 4th sleeve it lifts the blend 1.09 -> **1.60**, cuts maxDD
   -23% -> -15%, and HALVES time-underwater 3.8y -> **1.7y**. Real, independent (max |corr| 0.12), forward-clocked.

## The honest timeline (measured, not hoped) — 4-sleeve blend Sharpe 1.60
| start | -> £1M, survivable (~40% vol, DD -60%) | -> £1M, full-Kelly (RUINOUS) |
|---|---|---|
| a coffee (£5) | ~25 years | ~9 years |
| £10k | ~9 years | ~3.5 years |
| £250k | ~2.8 years | ~1.1 years |

**"Coffee -> £1M in a year" is arithmetically impossible with the best edge ever built here.** It requires either a
starting stake of ~£273k-610k, or ~9-25 years from a coffee. A coffee compounded for one year at the highest *survivable*
rate is ~£8; at ruinous full-Kelly, ~£18 -- not £1M. The path that promises £1M in a year from a coffee is the 45x
grid in the operator's screenshot, whose hidden float we reconstructed at -£400-700k: it does not compress time, it
deletes the account. **The real lever is STAKE x the 1.60 book x survivable sizing -- and that reaches £1M in YEARS.**

## The pathway forward (act on this)
1. **Run the forward clocks to promotion** -- fwd-fourfactor-blend-gcshort (the 1.60 book) is the single most valuable
   pending fact; it only matures with time. The 3-sleeve book is already live on paper (D-926).
2. **Verify the gcshort tail** -- its standalone maxDD is -92% (squeeze risk); measure realized borrow + cover slippage
   and cap the sleeve's drawdown before any live sizing.
3. **Maximise the stake** -- from £250k the survivable path to £1M is ~3 years; from a coffee it is ~25. Stake is the
   lever, not a mythical edge.
4. **Keep the coverage discipline** (COVERAGE LAW) -- broad now; the productive frontier is not more data classes
   (all lands sub-cost) but the going-concern short's live deployment and a live forward feed.

---

## (Earlier working notes, retained as history)

## 0. What we honestly know, and the real open question

**Known (measured, machine-enforced):** every *unconditional, always-on* construction we have built tops out at ~0.45
leverageable excess Sharpe — direction models (52.87% at 1h, sub-fee), trend books across panels, the timed
class-parity book. Costs, turnover and ruin sink the naive versions; the honesty gates have caught our own inflated
results repeatedly.

**NOT known, and this is the gap:** we have never systematically measured, as one coherent surface, **how well our
setups trade across every instrument × every timeframe × every session, versus a random-trading benchmark of matched
frequency and cost.** We cannot currently answer "are we better than pressing random buttons, and *where*." We have
also never tested **multi-factor confluence** as a *conditional, selective* edge — the hypothesis that the edge is
sub-fee unconditionally but clears cost precisely when several independent factors align, rarely.

**The real open question is therefore not "is there an edge" (unfalsifiable, guru-bait) but:** *across the full market
surface, and conditional on multi-factor confluence, where do our methods beat random after realistic cost — by how
much, how often, and is it deployable?* That is testable, and it is the mission.

**SETTLED 2026-09-15 (D-920) — the measurable variables are accounted for, and they collapse to ~3 factors + noise.**
A variance decomposition of 90 instruments across 8 asset classes onto 9 measurable market drivers (equity market,
yield-curve slope, credit, vol, inflation expectations, real yield, growth, BTC) settled the *why-does-each-instrument-
behave-this-way* question empirically: the median instrument's daily variance is **32.8% explained, 67.2% residual**,
the macro block adds **0.9pp over a market-only model** (the 'many variables' are one risk-on/off factor wearing many
hats — plus a BTC factor for crypto and a rates factor for bonds), and the **residual autocorrelation is −0.02** — the
unexplained two-thirds is a random walk with no cheap timing handle. This is the *structural* reason every surface edge
is real-but-sub-cost and why confluence of collinear factors (D-919) adds nothing: there is no missed measurable
variable that unlocks daily timing. The only places a new variable could still live are the **intraday / order-book
horizon** (the BTC/ETH/SOL microstructure mirrors already in the panel — the daily residual is noise, the 1-min residual
might not be) and **non-linear / lagged** structure. Both are Phase 2.

**Intraday horizon tested (D-921), and it closes the loop.** The 5m/1m residual of the five major perps *does*
carry structure the daily residual lacks — significant negative autocorrelation — but it is **0.1–1.5bp, an order of
magnitude below the 5bp round-trip, and it grows as liquidity falls and after removing BTC beta: it is the bid-ask
bounce**, the very spread you'd cross to harvest it (the same mechanism that made D-918's illiquid class a mirage). So
the measurable-variable accounting is now **complete for the data we hold, across both horizons**: every measurable
variable is either a common-factor beta (not timeable alpha) or sub-fee microstructure. The only genuinely un-tested
variables are **real order-book depth / order-flow** (only a single snapshot is held — a data-acquisition item) and
**options / positioning** — which is exactly what Phase 2 acquires.

**And the timeline question, answered (D-920 Part B).** The 149-year figure is the low-Sharpe *unlevered* floor; the
honest lever that compresses it is **leverage × stake on a real Sharpe, not a bigger edge** (the residual can't be
timed). Monte-Carlo of the levered wealth path: at the best Sharpe we have actually built (**0.83**, the VIX-overlay
risk-parity book), the *confident* setting is **~2× (half-Kelly), drawdown-survivable → £10k → £1M in ~16 years median**;
full-Kelly (4×) reaches ~11y but at ~100% drawdown and ruin risk — reckless. **Stake is the largest *safe* lever:** the
same book takes **£100k → ~7y, £250k → ~4y** with zero added risk. To go faster *confidently* needs a higher Sharpe than
demonstrated, and D-920 says that Sharpe can only come from **diversification across the ~3 independent factors (portfolio
Sharpe > any component — the one free lunch)** or the intraday horizon — never from timing the residual.

## 1. The mission, defined so it can actually be reached

Build a systematic, adaptive trading capability that, across instruments/timeframes/sessions, **provably beats random
after cost** and compounds cashflow faster than the current ~0.45-Sharpe book — OR prove, at the best data we can
access, that no such deployable edge exists. **Both outcomes are mission success** under the falsification doctrine: the
first is money, the second is the certainty that stops us burning years and capital chasing a ghost. The one
unacceptable outcome is the current state — *not knowing because we never built the evaluation.*

## 2. The universal test (every phase, no exceptions)

- **The random benchmark.** Every setup is scored against random entry/exit of matched frequency, side, and cost on the
  same bars. "Better than random, net of cost, with day-clustered significance beyond the deflation ceiling" is the bar.
  If we cannot beat a coin, we are not trading — we are paying spread to gamble.
- **The honesty gates stay on.** Pre-registration, the cost/turnover/ruin/benchmark/selection/holdability laws, the
  zero-edge control, the leverageable-*excess* Sharpe (not the rf-inflated total). No phase ships a number the gates
  reject. Every "we found something" is registered before the data is touched and killed if it does not clear.
- **Conditional is allowed; selective-on-full-sample is not.** A confluence edge is tested by pre-registering the
  confluence rule, selecting on train, and measuring forward — never by picking the winning condition after the fact.

## 3. The pathway (phases; each a testable question with a kill condition)

**PHASE 0 — THE TRADING-QUALITY SURFACE (now, no new data).** Build one evaluator that runs a battery of canonical
setups (trend, breakout, range-fade, momentum, level-reclaim, session-open) across every instrument × timeframe ×
session we hold, each scored against its matched random benchmark, producing a *surface map* of net-of-cost edge. This
is the thing we cannot currently do. *Deliverable:* a heatmap of where, if anywhere, our setups beat random.
*Kill:* if no cell beats random after cost beyond the ceiling, the unconditional surface is dead and we go to Phase 1.

**PHASE 1 — MULTI-FACTOR CONFLUENCE (now, no new data).** For the cells that show life (or the least-dead), test whether
the edge concentrates when N independent factors align (trend + session + volatility regime + level + release +
cross-instrument lead). Pre-register the confluence rules; measure the *conditional* net edge and its *frequency*. The
hypothesis worth its own test: rare, high-confluence events clear cost where the always-on average does not.
*Kill:* if confluence adds nothing over the single best factor on train-selected, forward-measured tests, conditional
edges on this data are dead.

**PHASE 2 — DATA EXPANSION (the 6–12 month access play).** Map what data would unlock edges the current bars cannot see,
and stage acquisition by ROI: intraday tick / order-book (microstructure, real order flow), full historical options
chains (convexity, gamma, dealer positioning), more instruments and sessions, and any free alternative data. Each new
dataset re-runs Phases 0–1 on the surface it opens. *Kill per dataset:* if a dataset's first honest evaluation is
sub-fee, it is closed and its cost not renewed.

**PHASE 3 — ADAPTIVE PER-INSTRUMENT ALGORITHMS (gated on Phase 0–2 finding real cells).** For every instrument/timeframe
where a real, better-than-random, cost-clearing edge is found, build an *adaptive* algorithm that sizes and switches
setups by regime, integrating the winners and standing aside where nothing works — the operator's "adaptive cashflow."
*Kill:* an adaptive algorithm that does not beat the best single static setup out of sample is discarded.

**PHASE 4 — SYSTEMATIC DEPLOYMENT EVALUATION (gated on Phase 3).** Evaluate the full adaptive book across the surface on
the paper → micro → small ladder with immutable forward clocks, so we can finally answer "how well would we do if
deployed systematically." *Kill:* the ladder's own promotion gates.

## 4. Where we are on the pathway

- **Phase 0: DONE (D-917), and the surface is ALIVE.** The evaluator is built and validated (our setups cluster near the
  50th random-percentile as they must; the benchmark is calibrated). Findings: (a) on perps, trend/momentum genuinely
  time **better than random** (percentile ~100 — chart analysis captures real autocorrelation) but at ~1–3bp they are
  below the ~9bp cost; (b) FX shows no timing skill (median 50); (c) **one genuine conditional edge was found** —
  **XMRUSDT × mean-reversion × the asian session, +33bp/trade, beats random, survives cost to ~20bp, and holds out of
  sample** (train +45bp → test +23.5bp). This is the first cell on the record to beat random *and* realistic cost *and*
  hold forward, and it proves conditional confluence finds edges the unconditional average hides.
- **Phase 1: RESOLVED (D-918, D-919) — the multi-factor edge is real but sub-cost, and the illiquid class is a mirage.**
  The three Phase-1 targets are now answered with receipts:
  1. **Is XMR the head of a deployable illiquid-alt CLASS? No (D-918).** Train-select (positive train mean, frozen) the
     whole class of illiquid-alt mean-reversion/breakout × session cells, measure the equal-weight portfolio on test at
     escalating realistic cost. Every cell is net-**negative** by 40bp, and four of five sit at random percentile **<30**
     — the selected direction is *worse than a coin flip* out of sample. The one percentile-100 cell has a **negative**
     day-clustered t (a few-days concentration). The huge nominal-net cells (HOME +58, FARTCOIN +59, TUT +109bp) are the
     **illiquidity premium**, not an edge. XMR individually still clears while its class is worse-than-random — so it is
     *not* a class artifact; it is either genuine tiny-capacity microstructure or a 1-in-~1000-cell multiple-comparisons
     survivor, now moved to an **immutable forward clock** (`fwd-xmr-asia-rangefade`) rather than decided by more mining.
  2. **Does CONFLUENCE lift the timing edge past cost? No, but it carries real information (D-919).** Sweeping K of the 4
     factors agreeing: on the panel, gross rises monotonically with K (0.38→0.55→**3.77bp**) and K≥2 **beats matched-
     random** (pctl 100) — so *factor agreement does carry a real signal*, the operator's hypothesis confirmed in the weak
     sense. But net-of-cost is negative at every K, the day-clustered t at high K is **negative** (the profit is a few
     heavy-trading trend days, not a robust daily edge), and on the capacity-rich **liquid majors K=3 inverts** to negative
     gross (agreement marks exhaustion). The multi-factor edge *is* the trend-regime signal already known to be real, to
     lose to buy-and-hold, and to be sub-cost intraday.
  3. **XMR real cost:** XMR is a mid-cap (median hourly $vol ~$7M in-sample), whose real perp round-trip is a few bp, well
     under the ~33bp where its edge dies — so *cost* is not what threatens XMR; *multiple-comparisons* is, which is exactly
     what the forward clock adjudicates. (A live order-book spread read is a Phase-2 data item.)

  **The honest terminal read of Phase 1:** across the data we hold, there is no broad multi-factor edge that clears cost —
  the multi-factor signal is real, sub-cost, and regime-concentrated, and the illiquid-alt cells are the uncapturable
  illiquidity premium. This is *measured*, not assumed. One marginal single-market cell (XMR) is on a forward clock.
- **Phase 2 (data expansion) is now the live phase — and the pathway is intact, not closed.** Phase 1 did not find a
  deployable edge in the current bars; it found *where the edge would have to come from*. The decisive open question is
  **conditional-on-regime at finer resolution**: the confluence signal is real and beats random but concentrates in trend
  days — so the Phase-2 datasets with the highest ROI are the ones that resolve regime and microstructure the 1h bars
  cannot: (a) **sub-1h / tick + order-book** (does confluence clear cost with tighter holds inside a high-vol regime, and
  what is the real spread on the thin cells); (b) **a realized/implied volatility-regime series** to condition the
  confluence edge on (test: does K≥3 clear cost *only* in the top vol tercile). Each dataset re-runs the surface,
  illiquid-class and confluence engines already built (`quality-surface.ts`, `illiquid-altmr.ts`, `confluence.ts`) — the
  evaluation machinery is done and waiting on data. *Kill per dataset:* first honest evaluation sub-fee → closed.

- **D-920 settled the accounting and the timeline (2026-09-15).** Two deliverables shipped: a driver variance
  decomposition (markets = ~3 independent factors + 67% autocorrelation-free residual) and a leverage-confidence
  frontier (confident ½-Kelly ~2× on Sharpe 0.83 → £10k→£1M ~16y; £100k→~7y). **This reframes the whole mission:** the
  fast path is no longer 'find a bigger edge' (the residual is unpredictable) — it is **(1) raise the portfolio Sharpe by
  diversifying across the ~3 independent factors and every additional independent stream, (2) size at confident
  half-Kelly, (3) maximise the stake, and (4) mine the one horizon still unaccounted-for: intraday/order-book.**

  **Highest-ROI next actions, in order:**
- **D-922/923 resolved the diversification test AND the data-completeness question (2026-09-15).** The free lunch is
  real: the risk-parity blend of trend-following + long-basket gives **Sharpe 0.89 (t 3.65)**, beating the best
  component 0.74 and the 0.83 ceiling — now on an immutable forward clock (`fwd-canonical-premia-blend`). Real-path
  drawdown (not the optimistic Monte-Carlo) sets the confident size at ~20% vol → **£10k→£1M ~29y, £100k→~15y,
  £250k→~9y**. And the last measurable-variable class — options-positioning (CBOE skew/put-call/VVIX, Deribit DVOL) —
  was tested as a predictor (D-923) and carries **no robust deployable edge**, completing the accounting: across
  factors, intraday, and positioning, every measurable variable in held data is non-timeable beta or sub-cost. **The
  thing being sought is not a hidden variable — it is this diversified book, sized survivably, with the largest stake.**
  The only un-acquired free data with any prior is historical order-book depth (`data.binance.vision`), which needs an
  allowlist addition (operator action) and carries a low prior after D-921 showed the visible microstructure is the
  bid-ask bounce.

- **D-924/925 (2026-09-15) — the diversification ladder reached Sharpe 1.09, and the last free dataset was acquired and is null.**
  Adding the third independent factor (a dedicated crypto-momentum sleeve, standalone 0.76, corr ≤0.32) lifted the blend
  to **Sharpe 1.09 (t 4.46), maxDD −23%** — the ladder is now 0.74 → 0.89 → 1.09 as each of D-920's three factors is
  added, on the forward clock `fwd-three-factor-blend`. Real-path survivable size (~20% vol): **£10k→£1M ~23y, £100k→~12y,
  £250k→~7y**. And with the allowlist armed, the last un-acquired free variable — Binance order-book depth + taker order
  flow — was ingested and tested (D-925): order flow is **contemporaneous, not predictive** (control r=0.49, forward
  sub-cost bounce), confirming D-921 with real data. **The measurable-variable accounting is now complete across every
  horizon and every data class held or acquirable free** — factors, intraday, positioning, order-book/flow — all
  non-timeable beta or sub-cost. The value is the diversified book, not a hidden variable.

  **The path from here is execution, not more search:** (1) the deployable candidate is the 3-factor blend, forward-clocked
  and sized at survivable ~20% vol; (2) the only remaining lever on the timeline is a *fourth* genuinely independent stream
  — but every classic 4th premium is now confirmed dead in this data: FX carry (−0.44), value (−0.26), **bond/term-premium
  carry (D-731b re-run: null, t 1.18)**, and the variance-risk premium (D-574/575). So **1.09 is the honest ceiling of
  held-data diversification**, and further Sharpe needs genuinely new independent alpha we do not have. The realistic
  levers are therefore (a) a **larger stake** (the largest safe compressor of the timeline) and (b) the **MICRO rung** when
  the `fwd-three-factor-blend` clock promotes. The search for a hidden edge is complete; the work from here is execution.

  1. **Portfolio-Sharpe via diversification (free lunch, no new data).** Combine the ~3 independent return streams
     (equity risk-parity/VIX-overlay, a BTC-factor timed book, a rates/carry stream) into one book and measure the
     *combined* holdable Sharpe vs the 0.83 component — diversification is the only demonstrated way to raise Sharpe, and
     every 0.1 of Sharpe measurably shortens the timeline. Pre-register; the combined book is the deployable candidate.
  2. **Intraday/order-book residual (the one un-mined variable).** Re-run the surface + confluence engines on the
     1-min / bookDepth / metrics mirrors already held for BTC/ETH/SOL — the daily residual is noise, but order-flow at
     the minute scale is the untested place a real timing edge could live. Kill if the 1-min residual ACF is also ~0.
  3. **The confident-leverage MICRO rung.** When the combined book clears, size it at half-Kelly and run it on the
     paper→micro ladder with an immutable forward clock — the frontier says this is where the 149-year path becomes
     human-scale, and it needs no mythical edge, only disciplined sizing.

## 5. What "done" means

The mission is achieved when EITHER (a) a real, better-than-random, cost-clearing, deployable edge is found, mapped to
its instruments/timeframes/sessions, wrapped in an adaptive algorithm, and forward-confirmed on the ladder — and it
compounds faster than the current book; OR (b) across the best data we can access, every cell of the surface and every
pre-registered confluence rule is proven sub-fee or non-deployable, with the receipts. There are no question marks left
in either case. Until one of those two states is reached, this document is open and I act on it.

**The next action is always the top unresolved cell of the surface.**
