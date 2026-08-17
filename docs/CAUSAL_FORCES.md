# CAUSAL_FORCES.md — the whole picture (the pivot out of candle-grammar space)

> **Why this file exists.** For a month the engine mined *candle geometry* — the SHAPE of the effect after
> price already moved. ~1.03M specs tested, ~0 survived. The one lead that survived (funding-carry) is the
> ONLY hypothesis grounded in a real force. This file is the map of the forces themselves — the *causes* —
> and the operating laws for turning any cause into a tested, sized, risk-assessed factor. It is deliberately
> larger than what we can currently see a path to: the operator's standing directive is to account for the
> whole field, including the parts we cannot yet reach, and to name the unknowns rather than prune them.

## The two laws, made operational (not slogans)

### Law of causality — a setup is a symptom; trade the force, not the shadow
Every price move is, at the bottom, an **imbalance of market orders against resting liquidity**. A "breakout"
is not a cause — it is the *visible trace* of a cause (a stop cluster tripped, a dealer forced to hedge, a
crowded position unwinding, news repricing fair value). Candle patterns are shadows on the wall. The engine's
new prime directive: **for every candidate signal, name the force that would make it work.** No named force →
it is a shadow → it does not enter the queue. The funding edge earns its place because it names its cause:
crowded perp longs *must* pay carry and *must* eventually unwind, and you are paid to be the counterparty.

Operationally, a factor is admissible only if it declares:
- **`mechanism`** — the causal chain from observable → forced buying/selling → price.
- **`hypothesized_sign`** — declared BEFORE the test (pre-registration; kills hindsight fitting).
- **`effective_date_rule`** — exactly when the observable was legally/physically knowable (no look-ahead).

### Law of modularity — decompose forces into independent factors, measure each alone, then combine
Each force is a **separately-measurable factor**: a point-in-time value with a hypothesized sign and a
measurable **marginal predictive lift (Information Coefficient, IC = corr(factor, forward-return))**. The
payoff of modularity is threefold:
1. **Isolation** — test one force at a time; a factor either has IC>0 net of cost or it doesn't. No confounding.
2. **Combination** — surviving orthogonal factors stack: a multi-factor score has higher IC than any single
   factor when their signals are decorrelated (the whole point — diversified alpha).
3. **Conditioning** — the SAME factor has different sign/strength per instrument and per regime. "Favourable
   conditions that apply to every instrument" (operator) = the **factor × regime interaction** layer. This is
   where the 60-instrument-day leverage lives: each instrument trades only its factors, only in the regimes
   where that factor's conditional IC is positive.

### Law of multi-timeframe — timeframe is a dimension of every factor, never a fixed lens (D-333)
A factor measured through ONE timeframe can read null in aggregate while carrying a real signal, because
opposite-signed regimes on a HIGHER timeframe cancel. A single 8h/4h lens structurally cannot see this. So every
factor is tested across a timeframe grid AND conditioned on higher-timeframe context (the HTF trend/vol regime
that gates the lower-TF signal). MTF is mandatory, not optional enrichment — the aggregate is a projection that
hides structure the higher timeframe reveals. **Proven live:** funding-fade IC was ~null through the 8h lens
(t=−1.54), but conditioned on a WEEKLY-downtrend context it is significant and sign-correct at every horizon
(8h t=−2.02, 24h t=−2.34, 72h t=−2.72, strengthening with horizon) — and flips/vanishes in weekly-uptrends, so
the two regimes cancelled in the pooled view. The 8h lens said "nothing"; the weekly context said "a real fade
signal, but only when longs are already underwater." Discipline: every HTF regime×horizon cell is a trial and is
deflated (a wide MTF grid multiplies comparisons — MTF adds information AND multiple-testing risk simultaneously).

### The leverage math, stated honestly (the path to 10×)
**Fundamental Law of Active Management: IR = IC × √Breadth.** Breadth (many instruments × many factors × many
days, each an independent bet) is the multiplier. But it multiplies IC — √breadth on IC=0 is still 0. And 60
*correlated* instruments ≠ 60 independent bets (effective breadth is lower after correlation). So:
- The 10× is reachable through **breadth × turnover × conditional sizing** — but ONLY once at least one factor
  has IC>0 net of pessimistic cost.
- The engine's job is therefore: **manufacture IC (find real causal factors), then let breadth multiply it.**
- Sizing is not separate from this: position size ∝ (conditional IC × conviction) / (instrument risk), so
  better causal prediction directly improves the profit-vs-risk ratio the operator asked about — the same
  factor that predicts better also sizes better and de-risks better. Prediction, sizing, and risk are one loop.

## The force field — the 7 classes (granular rows filled by the research pass)

Each class below is a header; the parallel research pass populates the per-force rows (mechanism · observable ·
sign · evidence · free/keyed data source · executable-at-our-latency). Classes are ordered from *most proximate
cause* to *most structural*.

1. **Order flow / microstructure** — book imbalance, signed/aggressor flow, stop clusters, liquidation
   cascades, hidden liquidity, VPIN, price-impact (Kyle's λ). The literal proximate cause. *Databento MBO/MBP
   is our biggest unused asset here.*
2. **Dealer / mechanical flows** — options dealer gamma (GEX), vanna/charm, index rebalancing, MOC imbalances,
   month/quarter-end, buyback blackouts, leveraged-ETF daily rebalance. *Forced, non-discretionary, predictable.*
3. **Positioning / crowding** — funding rate (PROVEN template), open interest, COT, short interest, ETF flows,
   options positioning. *Who is already in and must exit.*
4. **Information / event-driven** — earnings surprise + PEAD, analyst-revision momentum, macro surprise vs
   consensus, M&A, insider Form-4, news velocity. *Fair value repriced; drift as it's absorbed.*
5. **Cross-asset / structural linkages** — futures-lead-spot, large-leads-small, US-leads-global,
   rates→duration, dollar→commodities→EM, vol term-structure / VRP. *One market forces another.*
6. **Liquidity / regime state** — volatility regime, trend-vs-range (efficiency ratio), time-of-day, seasonality,
   breadth, realized-vs-implied. *Not standalone edges — the CONDITIONING layer that gates every factor above.*
7. **Carry / cost-of-holding** — funding carry (proven), futures roll yield, dividend capture, borrow cost.
   *Structural drift you are paid (or charged) to hold.*

## What we already have vs must collect (filled by the infra-audit pass)
- **Have, keyless/free:** Binance fapi (OHLCV + funding, 24/7), Yahoo (equity/futures bars).
- **Have, keyed, likely DORMANT (biggest under-exploited assets):** Databento (institutional MBO/MBP/trades/
  options — classes 1, 2, 5), AlphaVantage (fundamentals, earnings, macro — classes 4, some 3).
- **Must collect:** options GEX/dealer positioning, COT (CFTC, free), short interest (FINRA/exchange, free),
  earnings + macro-surprise calendars, index-rebalance schedules.

## UNKNOWNS — accounting for what I do not yet know about the destination (operator directive)
These are NOT rhetorical; each changes the architecture and I must not silently assume an answer:
1. **Holding horizon.** Microstructure forces (class 1) decay in seconds–minutes; carry/positioning (3,7) live
   for days. Our Alpaca-paper latency is seconds-to-minutes — some class-1 edges may be *measurable but not
   executable* for us. Where on the horizon spectrum is the target?
2. **Asset scope.** Crypto (24/7, keyless, funding works, we own the perp broker) vs US equities/futures
   (Databento-rich, but market hours, borrow constraints). The 60-instrument-day frame reads equities-intraday
   — confirm, because it dictates which force-classes come first.
3. **Executability vs research.** Do we want factors we can *trade now* on paper, or are we also building a
   research corpus of forces we can't yet act on (to combine later / to justify a data-latency upgrade)?
4. **Capital/latency ceiling.** Some class-1/2 edges need faster data than keyless gives. Willingness to spend
   on data (Databento is already paid; deeper feeds cost more) sets the reachable frontier.
5. **Combination vs specialization.** One multi-factor score per instrument, or a portfolio of single-factor
   specialists each gated to its regime? Both are modular; they size and risk-manage differently.
6. **The forces neither of us has named yet.** The field above is my current map; it is certainly incomplete.
   The engine must stay OPEN — a factor registry any new force plugs into — precisely so the map can grow
   without a rewrite. That openness is the structural answer to "there's a lot we still haven't accounted for."

## How a factor moves from idea → sized position (the pipeline this pivot builds)
```
declare factor (mechanism, sign, effective_date_rule)   →  trd_factors (registry, pre-registered)
compute point-in-time values (no look-ahead via asOf)   →  trd_factor_values (effective_date enforced)
measure marginal IC per horizon × regime                →  trd_factor_ic (trial-count deflated)
survivors: IC>0 net of PESSIMISTIC cost, stable OOS      →  combine (orthogonal) + condition (regime)
size ∝ conditional-IC × conviction / instrument-risk     →  paper forward test → staged gates → REAL
```
Every stage inherits the existing invariants: append-only evidence, trial-count deflation, decision-locked
gates, no-LLM-in-order-path, forward test never the bottleneck (resolve on all history first).
