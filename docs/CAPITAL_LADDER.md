# CAPITAL LADDER — from $10 to a million, rung by rung, from the measured record (D-882, 2026-09-13)

> Operator: never capped; a coffee into a million; find every reason it is possible. This ladder is built only from rows
> this programme has measured. Each rung states where its return comes from, the leverage route open at that size and
> its measured cost, and the growth the rung needs to reach the next in a year. Empty rungs are written as empty.

| rung | capital | what pays here (measured) | expected yield | leverage route open | to next rung in 1 year needs |
|---|---|---|---|---|---|
| 0 | **$10–£100** | **per-head money**: venue sign-up and free-share offers, one per person (D-851: ~£150–£400 once on ~£1,000 of deposits; T212 free share for £1) | **150–4,000% once** — the highest ROI on the record, and it is per head, not per pound | none needed | done by the offers themselves |
| 1 | £100–£1,000 | the rest of the reachable sign-up set (D-851); odd-lot tender priority once the broker question is answered (D-751/840: ~$230/event, ~5/yr, 99 shares each) | £150–£400 once; odd lots ~£1,000/yr on ~£12,000 employed | none | 10×: only per-head money does this, once |
| 2 | £1,000–£10,000 | **the pair** (D-873b/875): timed ISA class-parity basket + timed spot crypto, Sharpe 1.29 (0.90 ex-bull), at 1× each leg | **~5–6%/yr, ~0.1%/week** at ~4–5% vol | ISA 1× only; CFD financing negative (D-866); perps at funding halve the Sharpe (D-880) | 10×: impossible from market return (needs 900%/yr); the rung is crossed by deposits |
| 3 | £10,000–£100,000 | the pair; transfer-cashback tier opens (D-851: £100–£3,000 per head at £20k+) | ~5–6%/yr + £100–£3,000 once | same; the sign-up cashback is the only "leverage" | 10×: deposits, not return |
| 4 | £100,000–£1M | the pair at 1×; **external capital via a prop firm** (D-807 clock: FTMO-style 100k account, fee unpaid, payout split) is the one measured route to trading capital you do not own | pair ~5–6%/yr on own capital; prop payouts scored only from the operator's ledger | prop capital = leverage without financing, at a fee and with drawdown rules | 10× from £100k needs Sharpe ~1.5 at 40% vol for 6 years — no holdable book here is above 1.29 at 1× |

## What the ladder says, plainly
- **The bottom two rungs are the only place tenfold-in-a-year exists, and it is per head.** A £10 deposit that returns a
  £100 free share is 1,000%. It happens once per person per venue. It does not compound and it does not scale.
- **From rung 2 up, market return is ~5–6% a year at retail leverage.** Every route to more leverage has been measured
  (ISA 1×, CFD financing D-866, perps at funding D-880) and none pays. Rungs are crossed by deposits and time.
- **Rung 4's leverage is other people's capital.** A prop account is the one measured way a small trader controls six
  figures; it is on a clock (D-807) and its cost is the fee and the drawdown rule, both stated there.
- **Direction on a second-by-second basis is now measured, and it is real but sub-fee.** D-881 fit a walk-forward
  ridge-logistic model on 30 features per bar across five perps. At 1 hour it predicts the next bar's sign 52.9% of the
  time against a shuffled-label control of 50.4%, and **all five perps beat their own control** — the first consistent
  direction signal on this record. It earns about 1–2bp a bar against a 9bp round trip, so it is sub-fee by roughly 5×.
  At 5 minutes the accuracy FALLS to 51.7% while the fee stays fixed: **trading faster moves away from the money, not
  toward it.** Outside crypto it is chance — D-884 measured 51.3% on FX, gold and index CFDs against a 50.3% control,
  net negative on all eight instruments.
- **The maker route out of the fee was tested three ways and closed.** If the signal is sub-fee at taker, the obvious
  escape is to post passively and pay 2bp instead of 9. D-885 found the fill rate at the touch is 100%, so there is no
  filled-versus-unfilled contrast to measure. D-886 swept the price improvement a resting limit can demand, and a
  **coin-flip control matched or beat the model at every level** — the fill return had nothing to do with the model.
  D-887 then tested the mechanism itself at all 17,540 hourly anchors per perp with a taker exit charged: negative in
  **all 60 cells**, and zero gross. There is no passive-execution premium at this horizon on these instruments.

## Where the ladder is empty
There is no measured rung where £1,000 becomes £10,000 by trading within a year. If that rung exists, it is in data this
record does not hold — order-book depth, fills, options chains deep enough to price convexity historically — and the
page will say so the day it is measured rather than assumed.

**What the direction work settled (D-881/884/885/886/887/888/889/890/891).** The gap is no longer "can direction be
predicted" — it can, at 1 hour, in crypto, on every perp tested. The gap is the **fee**, and all three ways past a fee
are now measured shut.

1. **Pay less per trade — closed on both legs.** Passive entry: a limit at the signal close fills 100% of the time, a
   coin-flip control matches or beats the model at every level of demanded price improvement, and at full breadth with
   the exit charged the mechanism is negative in all 60 cells with zero gross (D-885/886/887). Passive exit: the
   closing limit fills 89% of the time, and **the unfilled 10% carries −52 to −86bp each** (D-891). A closing limit
   fails to fill precisely when price has run away from the position, so a passive exit converts a bounded gain into
   an unbounded loss tail. Executed returns land 6 to 11bp below assumed and are negative on all five perps.
2. **Hold longer so the fee amortises — closed.** Accuracy decays monotonically with horizon and reaches its own
   shuffled control by 72 hours (D-888). The signal decays faster than the fee amortises.
3. **A better fee tier — underpowered, and this is the one number worth keeping.** At a 4-hour hold the gross edge is
   **4.0 to 10.5bp per trade**, so the breakeven round trip is at or above real schedules: XRP (10.5bp) and BNB
   (9.5bp) exceed the full 10bp VIP0 taker round trip. But the round trip needed for the t-statistic to clear the
   deflation ceiling is −9.3 to +2.0bp, which no published schedule reaches (D-890). The mean clears; the confidence
   does not.

**Breadth does not rescue it either.** Information ratio scales as IC × √breadth, so the same model was run
cross-sectionally over 97 survivor-free names, dollar-neutral, across three horizons and three portfolio splits. NULL
in all nine cells, and not even sign-consistent across them (D-889). √97 multiplies nothing when the IC is zero.

**The honest ceiling as of today.** Best holdable Sharpe on the record is 1.29 (the pair, D-873b/875) and 0.83 for the
single best book (D-872). Tenfold in a year needs roughly Sharpe 1.5 sustained at 40% vol with leverage nobody has
measured a route to. Tenfold over a decade is arithmetic at the numbers we hold. The one place tenfold-in-a-year is
real is rung 0, it is per head, and it does not repeat.

**How long from here, computed (D-892, docs/GROWTH_TO_TARGET.md).** The $10-to-$1M question is a two-barrier
first-passage problem and it now has numbers. At the best measured book (Sharpe 1.29) at **purchasable** leverage the
median is **70 years**. At the growth-optimal leverage it is **12.2 years** — but that leverage is **12.9x** and every
route measured here caps at 3x, where the perp route delivers 30% of the Sharpe rather than 3× of it. The identity
that matters: at full Kelly the volatility **cancels**, and growth is `rf + S²/2` — **a function of the Sharpe alone**.
Leverage has an optimum; past it, more leverage *lowers* growth and raises the chance of ruin, and the crypto book at
3x goes outright negative. **Chasing leverage has been chasing the wrong variable.**

Inverted, which is the useful direction: the Sharpe needed is **1.04 for a twenty-year run — already inside what this
record has measured** — and **1.49 for ten years**, a gap of **0.20 of Sharpe** from today's 1.29. Not an order of
magnitude. The stated target of 100% a week requires a Sharpe of **8.49**, against roughly 2.5 net for the best
documented fund in history; doubling once a year requires **1.14**, which is inside the record. And a prop firm's ~10%
drawdown rule costs **59 percentage points** of P(reaching the target) on an unchanged strategy.

**The 1× rung, corrected and priced (D-904/905/906).** Two corrections landed here. First, every growth-to-target
figure this record published described a book scaled to **10% volatility** — about **2.9× leverage** on a 3.4%-vol
book, with no financing charged, in a rung whose own text says *"ISA 1x only"*. At genuine unlevered size the timed
book takes **149 years**, not 77. Second, the timed book does **not** beat simply holding the same assets: a
vol-matched long basket has **higher geometric growth** (8.13% against 7.64%) and the **same time underwater**. What
the timing buys is drawdown depth, −6% against −31%.

And a train-chosen holdable ETF beats the whole construction: **MTUM reaches the target in 94 years against the timed
book's 149**, with six other train-chosen entries also ahead of it. The timing's price is now stated: **55 years of
time-to-target in exchange for a fivefold smaller worst loss.** See `docs/GROWTH_TO_TARGET.md` §10.

**How to not wait so long, with numbers (D-907/908).** Two levers, and **neither is the strategy**.
**(1) The financing route.** Every leverage route measured here charges financing *on top of* the risk-free rate and
every one failed — CFD spread (D-866), perp funding (D-880). **Exchange-traded futures embed the carry in the price**,
so net financing excess is ≈0. Same book: at 5× the futures route reaches the target in **54 years against the CFD
route's 125** and unlevered's 150. **D-897's "1× dominates" was a statement about those routes, not about leverage.**
Conditional — this record holds no index futures, so that is an ingest task, not a measurement.
**(2) The starting stake, which is worth more.** £10 → £1M is 100,000×; £50,000 → £1M is 20×. Time scales with
`log(target/stake)`, so the same book at 8× futures takes **11 years from £50,000** against 44 from £10.
**The prop route is a different object entirely** — a bounded-loss bet on a fixed notional, where your loss is the fee
and the notional does not depend on your stake, so none of the above arithmetic applies. I could not price it: the
simulation failed its own zero-edge control and is recorded UNTESTED pending one firm's actual terms.
See `docs/GROWTH_TO_TARGET.md` §11.

**The bar any future direction work must clear**, so that it is not re-litigated: beat **52.87% at 1 hour** against a
per-step shuffled control, or beat the fee — and if it claims to beat the fee through execution, it must measure the
**EXIT** leg, not only the entry. That last clause is D-891's contribution and it is the one that would have caught
this programme's own near-miss.
