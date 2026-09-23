> **ARCHIVED 2026-09-23 (D-970, audit).** This page is built on a superseded era of the record (pre-5-sleeve, ~0.45-1.60 Sharpe arithmetic, or a register that now lives in trd_gap_register). Current truth: docs/BIG_PICTURE.md + docs/DEPLOY_RUNBOOK.md + the D-939e leverageable pin (~1.92).
# WHY THE STAKE DOMINATES THE EDGE (D-916)

`T = ln(W/S) / g`. Target W = £1,000,000. The book's honest leverageable excess Sharpe is ~0.45
(D-913); leverage is capped at 9.1x by a −50% drawdown floor on its 3.4% vol (D-897), not Kelly.

## Years to £1M — stake (rows) × edge Sharpe (columns)

| stake \\ Sharpe | 0.30 | 0.45 (ours) | 0.60 | 0.90 | 1.30 | 2.50 (Medallion) |
|---|---|---|---|---|---|---|
| £10 | 135y | 88y | 65y | 43y | 29y | 15y |
| £100 | 108y | 70y | 52y | 34y | 23y | 12y |
| £1,000 | 81y | 53y | 39y | 26y | 18y | 9y |
| £10,000 | 54y | 35y | 26y | 17y | 12y | 6y |
| £50,000 | 35y | 23y | 17y | 11y | 8y | 4y |
| £200,000 | 19y | 12y | 9y | 6y | 4y | 2y |

## The two levers, priced against each other at our edge (Sharpe 0.45, from £10)

- Base case, £10 at Sharpe 0.45: **88 years.**
- **Raise the stake 100× (£10 → £1,000):** 53 years — a **35-year** cut, and the stake is a lever you *control*.
- **Raise the stake to £50,000** (income/capital): 23 years.
- **Improve the edge +0.2 Sharpe (0.45 → 0.65)** — a 44% edge gain, near the limit of what the record could ever add: 60 years, a 28-year cut.
- **Double the edge (0.45 → 0.90)** — essentially impossible on this record: 43 years.

## Per unit, the levers are comparable — the stake matters more because of RANGE

At our Sharpe 0.45, a 100× stake (£10→£1,000) cuts 35 years and a +0.2 Sharpe cuts 28 — **comparable per unit.**
So the stake does not out-punch the edge one-for-one. It matters more for a different, decisive reason:

- **The edge is CAPPED and this record proved the ceiling.** 900+ tests found ~0.45 leverageable excess Sharpe and
  no more; a holdable retail Sharpe tops out near 1.0–1.3 anywhere. You cannot move it by an order of magnitude.
- **The stake is UNBOUNDED and movable by orders of magnitude.** £10 → £200,000 is 20,000×; income, savings and
  capital formation move it freely. The table's realisable improvement down each column dwarfs the one across each row.
- So the *achievable* gain from the stake (many multiples) vastly exceeds the *achievable* gain from the edge (maybe
  +0.1–0.2 Sharpe, at the limit of possibility). The stake is the lever you can actually pull, and pull hard.

## The uncomfortable truth the model makes explicit

**Both levers are weak at retail scale, and the stake matters more only because the edge is weak and capped.** `g`
at capped leverage is ~0.31·S, so a big edge changes everything: at Medallion Sharpe 2.5 any stake reaches £1M in
~15 years and the EDGE becomes the lever. At our honest 0.45, g is ~13%/yr and £1M from a coffee is ~88 years no
matter how you cut it. Stake-dominance is a SYMPTOM of a ~0.45 edge, not a law — and the strategic consequence is
that value creation must come from CAPITAL FORMATION (the stake), with the book as a survival-and-compounding vehicle,
because the record has proven the edge cannot be the engine.

