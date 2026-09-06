# PROP-FIRM PLAN — the capital-access route, operationalised (D-796 / D-797)

> Status 2026-09-06: PRICED, NOT EXERCISED. No fee has been paid. Paying one is real spend and the operator's decision.
> This document exists so that decision can be made with the rule written first (PRE-COMMITMENT LAW, D-571) and the
> verification done before money moves (PRECONDITION LAW, D-598). Everything below is reproducible from
> `scripts/prop-firm-ev.ts` (`EQUITY=1`), 4,000-path block bootstrap on the day-clustered series the live clocks score.

## 1. What the math says (all at the "0.5×" label, FTMO-style 100k, two phases, 10% static DD, 5% daily, 80% split)

| configuration | P(pass) OOS / 2026 | no-edge | funded $/mo | P(blow, 6 mo) | EV per fee $ | day-t OOS / 2026 |
|---|---|---|---|---|---|---|
| equity liquid-dips alone (clock #18 cell, stock CFDs) | 36% / **80%** | 26% / 35% | $800 / $1,240 | **4–5%** | +2.0 / +9.3 | 1.05 / 1.11 |
| utc16 index+crypto alone (clock utc16 cell) | 73% / 48% | 38% / 34% | $1,250 / $970 | 9–11% | +8.5 / +3.8 | 2.15 / 0.51 |
| **combo, both streams, one book** (r = 0.083) | **74% / 78%** | 44% / 46% | **$1,450 / $1,550** | 15–19% | **+10.1 / +11.5** | **2.30** / 1.11 |
| futures props (Topstep/Apex/Lucid) on NQ+SPX cells | 10–20% | 23–35% | — | ~100% | negative | −1.25 / −0.41 |

- **Futures props: do not pay.** The futures-compatible series is negative at the day level; P(pass) is below the coin-flip the firm prices.
- **Choose by what you can hold**: equity-alone if a single-digit blow-up matters more than income; combo if EV per fee $ matters more.
- **What every positive row rests on**: day-t ≈ 1.1 in 2026 for both streams. Positive expectation, wide error bars. Not an established edge. A fee here is a *forward experiment with a stake*, not a deployment.

## 2. Before ANY fee — the verification checklist (each item can flip the answer)

1. **Exact current terms** of the chosen firm (target per phase, static vs trailing DD, daily loss, min days, consistency, time limit, fee, split, scaling) → set as knobs and re-run `prop-firm-ev.ts`. The presets are typical published terms, not facts.
2. **Instrument list intersection.** Equity stream: which of the ~1,226 liquid-decile names are offered as stock CFDs (typically 100–500 large caps)? Re-run the D-785 cell on THAT list only before trusting the equity row. utc16 stream: which of the 10 crypto perps / 3 indices / 4 FX are offered, at what hours, with what weekend rules?
3. **Costs as charged**: spread + commission per instrument class, **overnight swaps** on the 5-day equity hold (unmodelled — could remove several bp/trade), crypto weekend swaps.
4. **Rules that void payouts**: news-trading windows, max lot/position, "gambling" clauses, copy-trading across firms (**not doing this — cross-firm hedging is ToS fraud**), account-count caps.
5. **Sizing sanity**: at the 0.5× label the combo runs 0.75× book on both-stream days; confirm the daily-loss rule (5%) is not reachable by a single crypto gap at that exposure — if it is, drop utc16 to 0.25×.
6. **The clock exists first** (§3), so the outcome cannot be narrated afterwards.

## 3. Ready-to-sign forward clock (numeric, two-sided — register BEFORE the first trade)

```
id:            fwd-prop-ftmo100k-combo-0p5x-v1          (or ...-equity-0p5x-v1 if equity-alone is chosen)
spec:          ONE FTMO-style 100k two-phase evaluation, fee = the stake. Trades exactly the two registered clocks'
               rules: utc16 close>PDH -> long K=6h on the offered subset of the 17-panel at 0.5x/N per event-day;
               equity liquid-decile close<prior-20d-low -> long K=5d on the offered stock-CFD subset at 0.1x per
               event-day (0.5x concurrent). No discretion, no other trades, no cross-firm positions.
clock_started: <date of first trade>
horizon:       evaluation to pass/fail (max 6 months), then 6 funded months
promote_if:    evaluation PASSED AND funded payouts over 6 months >= 3 x fee AND realised funded day-clustered mean
               >= +5bp/day AND no rule breach
kill_if:       evaluation FAILED OR funded account breached max DD OR funded payouts over 6 months < 1 x fee
inconclusive:  passed but 6 funded months not yet complete, OR payouts between 1x and 3x fee
NOT evidence against: a fail on a single market-wide drawdown day IS a fail (rules are rules) but says little about
               the edge — the no-edge baseline already fails 54–56% of the time; the informative number is the
               funded-phase day-clustered mean vs the +9.7–11.0bp/day priced here.
```
Register via the same `trd_forward_rules` POST used for clocks 15–18 (see D-786), then add a scorer that reads the
firm's statement export (or a manually-kept `data/prop-ledger.json`) — the scorer is the ONLY way this clock ever
gets a mark; without it the experiment is an anecdote (CONTINUITY LAW, D-613).

## 4. Sequencing — why one account, not "every prop firm"

N accounts trading the same two signals are one bet at N× size: their pass/fail realisations are ~perfectly correlated.
Two accounts double the expected payout AND double the fee loss with the SAME probability; they do not diversify the
pass risk. So: one account → recorded outcome → then decide on a second with a real data point in hand. The combo
already IS the diversification (r = 0.083 across the two streams inside one book).

## 5. What would change the answer

- Firm terms materially tighter than the presets (trailing DD, ≤3% daily) → re-run; expect P(pass) to drop toward no-edge.
- Instrument-list intersection removing most of the liquid decile → equity row may not survive (re-run on the subset).
- Clock utc16 hitting KILL (D-782 tracks it) → combo becomes equity-alone.
- Clock #18's forward day-t staying ~1 → the equity row's +EV is a coin-flip with a positive drift, priced correctly as such.
