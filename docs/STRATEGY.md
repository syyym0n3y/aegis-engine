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
- **Phase 1: NOW.** Three concrete targets: (1) **measure XMR's real bid-ask/slippage** — the edge dies at 40bp, so
  tradeability turns on the actual cost; if it clears, XMR asia mean-reversion is the first live micro candidate. (2)
  **Systematically search the instrument × setup × session × factor-confluence space** for more cells like XMR — the
  surface just proved they exist, especially in thin, illiquid, retail-driven markets. (3) **Test whether stacking
  factors concentrates the trend/momentum real-timing edge past cost.**
- **Phase 2 (data expansion)** remains scoped by the prior: the current bars are well-mined, so the ROI is in new data
  classes (microstructure/order-book, options chains) — but Phase 0 shows there is still conditional edge to harvest in
  the data we already hold before we spend on new data.

## 5. What "done" means

The mission is achieved when EITHER (a) a real, better-than-random, cost-clearing, deployable edge is found, mapped to
its instruments/timeframes/sessions, wrapped in an adaptive algorithm, and forward-confirmed on the ladder — and it
compounds faster than the current book; OR (b) across the best data we can access, every cell of the surface and every
pre-registered confluence rule is proven sub-fee or non-deployable, with the receipts. There are no question marks left
in either case. Until one of those two states is reached, this document is open and I act on it.

**The next action is always the top unresolved cell of the surface.**
