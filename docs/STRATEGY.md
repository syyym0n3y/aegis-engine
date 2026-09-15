# STRATEGY — the open pathway to the edge (living document, last acted 2026-09-15)

> This replaces the earlier "make the money elsewhere" synthesis. That synthesis was premature: it reasoned about the
> edge we had *measured* rather than searching the edge we had *not yet mapped*. The operator is right — we have never
> built a comprehensive evaluation of our trading across the whole market surface, benchmarked against random. Until we
> have, "there is no edge" is an unproven claim, and this document is the pathway that proves or finds it. I act on this
> until the mission is achieved.

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

## 5. What "done" means

The mission is achieved when EITHER (a) a real, better-than-random, cost-clearing, deployable edge is found, mapped to
its instruments/timeframes/sessions, wrapped in an adaptive algorithm, and forward-confirmed on the ladder — and it
compounds faster than the current book; OR (b) across the best data we can access, every cell of the surface and every
pre-registered confluence rule is proven sub-fee or non-deployable, with the receipts. There are no question marks left
in either case. Until one of those two states is reached, this document is open and I act on it.

**The next action is always the top unresolved cell of the surface.**
