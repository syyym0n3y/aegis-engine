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

**What the direction work narrowed (D-881/884/885/886/887).** The gap is no longer "can direction be predicted" — it
can, at 1 hour, in crypto, on every perp tested. The gap is the **fee**, and the three ways past a fee are all now
either measured or named:
1. **Pay less per trade.** Passive execution is closed (D-885/886/887). What is NOT closed is fee tier: the same trade
   at a maker rebate rather than a maker fee changes the sign of the arithmetic, and that is an account-status
   question the operator can answer, not a research question.
2. **Trade less often for more per trade.** The conviction threshold does exactly this and turns 4 of 5 perps positive
   at taker, but it was chosen after seeing the sweep, so it is not claimable until it is registered fresh and run
   forward. That registration is the obvious next move and it costs nothing.
3. **Hold longer so the fee amortises.** The model's edge is measured at a one-bar horizon. Whether the same features
   predict a 6-hour or 24-hour move — where a 9bp round trip is a smaller fraction of the move — is untested and is
   the single cheapest open question on this page.

**The honest ceiling as of today.** Best holdable Sharpe on the record is 1.29 (the pair, D-873b/875) and 0.83 for the
single best book (D-872). Tenfold in a year needs roughly Sharpe 1.5 sustained at 40% vol with leverage nobody has
measured a route to. Tenfold over a decade is arithmetic at the numbers we hold. The one place tenfold-in-a-year is
real is rung 0, it is per head, and it does not repeat.
