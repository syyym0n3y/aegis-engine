# PROP-FIRM PLAN — the capital-access route, operationalised (D-796 / D-797)

> Status 2026-09-06 (D-807): **CLOCK SIGNED AND REGISTERED** (`fwd-prop-ftmo100k-utc16-0p5x-v1`, immutable, operator sign-off). Still NO FEE PAID — the registration is the pre-commitment, the fee is the operator's spend. The clock is scored only from the operator's ledger: `scripts/prop-ledger.ts` (`SET_FEE=…`, then `ADD=1 DATE=… PHASE=eval1|eval2|funded EQUITY=… [PAYOUT=…] [BREACH=1]` per statement day). Empty ledger = not-yet-computable, never inconclusive.
> This document exists so that decision can be made with the rule written first (PRE-COMMITMENT LAW, D-571) and the
> verification done before money moves (PRECONDITION LAW, D-598). Everything below is reproducible from
> `scripts/prop-firm-ev.ts` (`EQUITY=1`), 4,000-path block bootstrap on the day-clustered series the live clocks score.

> **REVISED 2026-09-06 (D-802) — read this before §1.** The equity rows below were priced on the unfiltered (9% non-equity), pre-refresh panel and are RETRACTED: on the equity-only, refreshed universe the equity route is **−EV in 2026** (0.5×: P(pass) 8% vs 19% no-edge, EV −0.57). The combo is downgraded (2026: EV +3.5, 44% vs 39% no-edge, 18% blow-up). **utc16 alone at 0.5× is the best single configuration (2026: EV +3.8, 48% vs 34%, 9% blow-up).** If exercised: one account, utc16 alone, clock-registered first. Futures props remain −EV.

## 1. What the math says (all at the "0.5×" label, FTMO-style 100k, two phases, 10% static DD, 5% daily, 80% split)

| configuration | P(pass) OOS / 2026 | no-edge | funded $/mo | P(blow, 6 mo) | EV per fee $ | day-t OOS / 2026 |
|---|---|---|---|---|---|---|
| equity liquid-dips alone (clock #18 cell, stock CFDs) | 36% / **80%** | 26% / 35% | $800 / $1,240 | **4–5%** | +2.0 / +9.3 | 1.05 / 1.11 |
| utc16 index+crypto alone (clock utc16 cell) | 73% / 48% | 38% / 34% | $1,250 / $970 | 9–11% | +8.5 / +3.8 | 2.15 / 0.51 |
| **combo, both streams, one book** (r = 0.083) | **74% / 78%** | 44% / 46% | **$1,450 / $1,550** | 15–19% | **+10.1 / +11.5** | **2.30** / 1.11 |
| futures props (Topstep/Apex/Lucid) on NQ+SPX cells | 10–20% | 23–35% | — | ~100% | negative | −1.25 / −0.41 |

**Revised rows (D-802 — equity-only, refreshed panel; these supersede the table's equity and combo rows):**

| configuration | P(pass) OOS / 2026 | no-edge | funded $/mo | P(blow, 6 mo) | EV per fee $ | day-t OOS / 2026 |
|---|---|---|---|---|---|---|
| equity liquid-dips alone, EQUITY-ONLY | 21% / **8%** | 18% / 19% | $659 / $535 | 2–4% | +0.4 / **−0.6** | 0.72 / −0.06 |
| combo, utc16 + equity-only dips (r = 0.042) | 72% / 44% | 44% / 39% | $1,380 / $997 | 17–18% | +9.3 / **+3.5** | 2.19 / 0.40 |
| **utc16 alone** (unchanged) | 73% / **48%** | 38% / 34% | $1,250 / $970 | **9–11%** | +8.5 / **+3.8** | 2.15 / 0.51 |

- **Futures props: do not pay.** The futures-compatible series is negative at the day level; P(pass) is below the coin-flip the firm prices.
- **Equity-alone: not a candidate.** On the honest universe it is −EV in 2026 and passes less often than a no-edge trader. It returns to the table only if clock #18's forward record earns it back.
- **If exercised: utc16 alone at 0.5×.** The combo adds +EV over utc16-alone on the long window but almost nothing on 2026 (44% vs 39% no-edge) at roughly double the blow-up.
- **What every positive row rests on**: 2026 day-t 0.51 (utc16) / 0.40 (combo). Positive expectation, wide error bars. Not an established edge. A fee here is a *forward experiment with a stake*, not a deployment.

## 2. Before ANY fee — the verification checklist (each item can flip the answer)

1. **Exact current terms** of the chosen firm (target per phase, static vs trailing DD, daily loss, min days, consistency, time limit, fee, split, scaling) → set as knobs and re-run `prop-firm-ev.ts`. The presets are typical published terms, not facts.
2. **Instrument list intersection.** Equity stream: which of the ~1,226 liquid-decile names are offered as stock CFDs (typically 100–500 large caps)? Re-run the D-785 cell on THAT list only before trusting the equity row. utc16 stream: which of the 10 crypto perps / 3 indices / 4 FX are offered, at what hours, with what weekend rules?
3. **Costs as charged**: spread + commission per instrument class, **overnight swaps** on the 5-day equity hold (unmodelled — could remove several bp/trade), crypto weekend swaps.
4. **Rules that void payouts**: news-trading windows, max lot/position, "gambling" clauses, copy-trading across firms (**not doing this — cross-firm hedging is ToS fraud**), account-count caps.
6. **Payout currency and rails** (D-823c): the operator's base is GBP, trading is USD, payouts must land outside the UK. FTMO's pages state methods (wire, Visa Direct/Mastercard Send ≤ $20k, Skrill ≤ $3k, crypto USDC/USDT ≥ $50) and the 14-day reward claim, but NOT the payout currency — read it from the terms or support, and measure the GBP→USD conversion cost (it replaces the ledger's 130bp default).
7. **Residency and destination restrictions** (D-823c): FTMO's payout pages state none; the firm's terms of service must be read for restricted countries on BOTH the trader's residency and the payout destination before a fee.
5. **Sizing sanity**: at the 0.5× label the combo runs 0.75× book on both-stream days; confirm the daily-loss rule (5%) is not reachable by a single crypto gap at that exposure — if it is, drop utc16 to 0.25×.
6. **The clock exists first** (§3), so the outcome cannot be narrated afterwards.

## 3. Ready-to-sign forward clock (numeric, two-sided — register BEFORE the first trade)

```
id:            fwd-prop-ftmo100k-utc16-0p5x-v1          (D-802: utc16 ALONE — the combo and equity variants are not candidates)
spec:          ONE FTMO-style 100k two-phase evaluation, fee = the stake. Trades exactly the registered clock
               `fwd-utc16-abovePDH-long-K6-panel17`'s rule: utc16 close>PDH -> long K=6h on the offered subset of
               the 17-panel at 0.5x/N per event-day. No discretion, no other trades, no cross-firm positions.
clock_started: <date of first trade>
horizon:       evaluation to pass/fail (max 6 months), then 6 funded months
promote_if:    evaluation PASSED AND funded payouts over 6 months >= 3 x fee AND realised funded day-clustered mean
               >= +5bp/day AND no rule breach
kill_if:       evaluation FAILED OR funded account breached max DD OR funded payouts over 6 months < 1 x fee
inconclusive:  passed but 6 funded months not yet complete, OR payouts between 1x and 3x fee
NOT evidence against: a fail on a single market-wide drawdown day IS a fail (rules are rules) but says little about
               the edge — the no-edge baseline already fails 54–56% of the time; the informative number is the
               funded-phase day-clustered mean vs the +8.4bp/day (OOS) / +4.2bp/day (2026) priced for utc16 alone.
```
REGISTERED 2026-09-06 (D-807) with `clock_started` = registration date; the first-trade date is the ledger's first entry.
Scorer: `forward-score-specs.ts` → `fwd-prop-ftmo100k-utc16-0p5x-v1` reads `data/prop-ledger.json` only; horizon 365 days in
`forward-scorer.ts`. Without ledger entries the clock reports not-yet-computable (CONTINUITY LAW, D-613).

## 4. Sequencing — why one account, not "every prop firm"

N accounts trading the same two signals are one bet at N× size: their pass/fail realisations are ~perfectly correlated.
Two accounts double the expected payout AND double the fee loss with the SAME probability; they do not diversify the
pass risk. So: one account → recorded outcome → then decide on a second with a real data point in hand. The combo
already IS the diversification (r = 0.083 across the two streams inside one book).

## 5. What would change the answer

- Firm terms materially tighter than the presets (trailing DD, ≤3% daily) → re-run; expect P(pass) to drop toward no-edge.
- Instrument-list intersection removing most of the liquid decile → equity row may not survive (re-run on the subset).
- Clock utc16 hitting KILL (D-782 tracks it) → there is no prop-firm candidate left; the plan closes until a clock earns one.
- Clock #18's forward record turning positive on the equity-only series → the equity row re-enters the table; until then it is −EV in 2026 and stays out.
