# PLAYBOOK.md — what our tests still miss, and the patterns that generalize to any setup / any direction

Distilled from D-146…D-187 (random-control gate → LEAN port → multi-timeframe sweep → forward paper). This is the
transferable IP: the blind spots to fix before real money, and the meta-patterns that apply to ANY buy/sell decision
in ANY direction, not just the two survivors.

## PART A — What is MISSING from our tests (the honest gaps, ranked by how much they can bite)

1. **No real fills / slippage / market impact.** Everything is modeled cost (spread + borrow), never an executed
   order. Paper→micro→small on a real broker is the ONLY cure; forward paper books virtual R at modeled cost, so it
   also does not prove fills. rip-short's +0.06R net is inside the width of realistic slippage — this is the #1 risk.
2. **Capacity untested.** rip-short shorts overbought names in downtrends — often small-cap / hard-to-borrow. We
   modeled a flat 8%/yr borrow, not borrow AVAILABILITY (some names are unborrowable) or impact at size. The edge
   may exist at $1k and vanish at $1M.
3. **Portfolio construction / concurrency untested for the survivors.** We measured per-trade R in isolation. Real
   deployment holds many correlated positions that CLUSTER (every name overbought-in-downtrend at once in a selloff).
   The D-154 heat-cap work was never applied to rip-short/dip-buy. Concurrent risk ≠ sum of per-trade risk.
4. **One-bar entry-timing assumption.** Local scripts enter next-bar open (clean); some LEAN virtual books used the
   signal bar's close as an entry proxy (a 1-bar look-ahead that flatters results). Re-run survivors with strict
   next-bar fills before promotion.
5. **Regime conditioning is shallow.** dip-buy passed in-sample but died out-of-window (regime-suspect, D-186). We
   never split edges systematically by VIX / trend / rate regime. rip-short only fires in downtrends by construction,
   but bull-vs-bear-subperiod stability is unquantified.
6. **Cost is modeled constant; in reality it widens in stress** — exactly when mean-reversion fires most. Our fixed
   2bp/spread understates the true cost of the trades we most want to take.
7. **Crypto survivorship bias.** US equities are survivorship-free (QC), but Binance BTC/ETH are survivors — dead
   coins absent. The crypto rip-short edge (D-170) could be inflated; never tested on delisted coins.
8. **Program-wide multiple testing.** We deflated within a 6-setup panel (Bonferroni), but across the whole arc we
   ran hundreds of configs. True deflation should use the full trial count (trd_trial_counter). rip-short's t=7.23
   survives even that; dip-buy's t=3.73 likely does not.
9. **Only time-series single-name mechanics.** No cross-sectional RANKING (long the most-oversold vs short the most-
   overbought each day) — which is where most equity alpha actually lives — no pairs/relative-value, no options.
10. **No walk-forward re-optimization.** Params were frozen once. Robustness-by-plateau (D-184) is good, but true
    walk-forward re-fits each window and trades the next.
11. **Forward-tracker feed ≠ discovery feed.** Edges found on QC/Binance; forward paper runs on Yahoo. A feed
    discrepancy the forward test will expose but we have not quantified.

## PART B — PATTERNS that generalize to ANY setup / ANY direction (the durable rules)

1. **Positive expectancy is worthless; beating a RANDOM entry is everything.** In calm regimes a random long earns
   +0.15–0.25R — most "edges" are just that drift. Rule: a setup is real only if it beats a matched random entry
   (same instrument, regime, direction, stop/target), t≥2. This is the master filter for any decision. (D-146)
2. **Judge against the SAME-direction random control — direction is asymmetric.** Longs ride drift, so a long's raw
   return overstates skill; you must beat a random long. Shorts fight drift, so a short that merely loses less than a
   random short can be a real edge (rip-short: +0.13R while random short −0.19R). Never compare a short to a long.
3. **Mean-reversion beats momentum on this universe, at every timeframe.** Every breakout/Donchian setup was dead or
   anti-edge; all survivors FADE extremes (RSI overbought/oversold) with a 200-MA trend filter. Default prior for a
   new idea: fade-the-extreme > chase-the-breakout.
4. **Edges are timeframe-locked — there is no all-timeframe setup.** rip-short: daily + crypto 5m. dip-buy: hourly.
   Minute: nothing. Match the signal's reversion horizon to the timeframe, and only where cost is small vs the move.
5. **Cost-in-R is the killer, and it grows as you speed up.** Faster bars → smaller ATR stop → fixed spread/borrow
   becomes a larger fraction of R. Minute edges die on cost, not signal (D-169, D-187). Rule: compute cost-in-R
   FIRST; if cost > ~½ the gross edge, don't trade it.
6. **Survivorship bias inflates every long backtest.** dip-buy: t=5.63 on curated survivors → t=1.15 on
   survivorship-free. Assume any backtest that drops the dead is optimistic; discount accordingly. (D-176/177)
7. **Real edges are SMALL, breadth-dependent, unglamorous.** rip-short is +0.06–0.14R/trade, weak per-name,
   significant only across many names (PBO-clean but small). Trade wide-and-thin, never concentrated. Anyone
   promising a big per-trade edge is selling an overfit. (D-184, matches D-070 thesis)
8. **The fat tail is real but un-timeable.** Single candles run huge (MFE to 263R) but no entry method — S/R
   included — catches them better than random (D-172). Don't build around catching the tail; cap the downside and
   let a FIXED target harvest the middle.
9. **TP:SL geometry: target 3R, cap loss 1R. Wider (5R) helps only the strongest edge; cutting winners short wins
   the hit-rate but LOSES money.** Let winners run to ~3–5R; never move the stop to break even early. (D-154, D-172)
10. **Overfit is cheap to detect: both-halves + PBO.** If a setup isn't same-sign-positive in BOTH time-halves and
    PBO<0.5, it's curve-fit. A real edge is a PLATEAU across a parameter neighborhood (rip-short 39/54 variants), not
    a SPIKE at exact knobs (dip-buy 17/54). Sweep params before believing. (D-155, D-184, D-186)
11. **The default verdict is REJECT.** 859 anomalies + 212 predictors + thousands of configs → 2 modest survivors.
    The base rate of "no edge" is ~99%. Every new idea starts guilty until it clears the gate. (D-070)

## The one-line decision rule (any instrument, any direction)
Only act when the setup beats a same-direction random control (t≥2, both-halves, PBO<0.5) AND cost-in-R < ½ the
gross edge AND the timeframe matches the reversion horizon — then size small and wide, cap loss at 1R, target 3–5R,
and discount the whole thing for drift (longs), borrow (shorts), and survivorship. If any clause fails: don't trade.
