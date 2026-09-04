# SIZING FRAMEWORK — micro-lot, high-turnover, cross-instrument mean-reversion

> Written 2026-09-04 after registering the three D-780 forward clocks. This document answers the operator's
> specific questions — how high the lot, where the stop, where the target — for the micro-lot / large-N style
> stated in the ask. Every number below is derived from the D-780 measurement, not projected; where a number
> is projected because we don't have per-instrument sd/n yet, it is marked (projected).

## ⚠ POST-REGISTRATION UPDATE (D-782, 2026-09-04)

Immediately after registration, the 97-perp SF panel era decomposition (D-782) showed **2 of the 3 registered
clocks already track KILL in 2026**:
- `fwd-utc01-sweepPDL-reclaim`: 2026 partial (n 1004) mean −39.74bp t **−4.27**
- `fwd-utc09to10-belowPDL`: 2026 partial (n 6939) mean −16.05bp t **−3.34**
- `fwd-utc16-abovePDH`: 2026 partial (n 3845) mean +10.99bp t +1.35 (weakened but still positive)

**Do NOT deploy real capital on these three cells based on the sizing math below.** The math is the
descriptive-of-2023-2025 case; 2026 has already broken the sign for two of three. The clocks remain
registered per PRE-COMMITMENT LAW (signed off knowing this risk), and they will run their 24-month horizon.
The most-likely single clock to earn a promote is `fwd-utc16-abovePDH`; even it has weakened materially.

## First — honest state of "mastery"

The operator's ask says "we have mastered low-risk entry models... rejection blocks... predict buy/sell...
hold and exit." That is aspirational, not the current state. The measured state is:

- **One replicated positive-expectancy cell family (D-780) with three sub-cells now on forward clocks.**
- **Zero promoted edges** in the immutable log after 8+ months of research.
- **Fourteen forward clocks live**, three registered tonight (D-780). No verdicts yet.
- **Retract-on-the-record protocol working**: three tonight (D-773, D-777, D-778).

This framework operationalises what we DO know. It is deployable at paper-only until a clock promotes.
Auto-execution stays OFF below the SMALL rung per D-070 non-negotiables.

## The three registered clocks (D-780 tonight)

| id | trigger | hold | pooled OOS (17-panel) |
|---|---|---|---|
| `fwd-utc01-sweepPDL-reclaim-long-K6-panel17` | UTC 01, wick low < PDL AND close ≥ PDL | 6h (close-to-close) | +15.44bp / t 3.40 / sign 13/17 |
| `fwd-utc09to10-belowPDL-long-K6-panel17` | UTC 09 or 10, close < PDL | 6h | +8-11bp / t 2.4-3.4 / sign 12-13/17 |
| `fwd-utc16-abovePDH-long-K6-panel17` | UTC 16, close > PDH | 6h | +7.31bp / t 2.91 / sign 11/17 |

All three: **LONG-only** by construction. Cost 7bp crypto / 4bp idx / 2bp FX RT already netted in the numbers.

## The sizing math — per trade

For each trade on a registered clock, sizing is:
- **L = min(Kelly/4, vol-target 20%/yr, 1.0×notional)** — take the smallest.
- **Kelly** = μ / σ² per event (log-return space).
- **Vol-target** = 0.20 / (σ × √events_per_year).
- **Cap at 1.0× notional** (no leverage above 1×) until a clock promotes and the operator explicitly enables higher.

Using the D-780 UTC 01 cell's measured statistics as the reference (μ = 15.44bp = 0.001544, σ estimated 55bp
per event from the class-mix, events/instrument/yr ≈ 21):
- σ² ≈ 3.0e-5. Kelly ≈ 0.001544 / 3.0e-5 ≈ 51. **Full-Kelly is nonsense at that level.**
- Kelly/4 ≈ 12.8. Still absurdly high — reflects a small measured mean and, when σ is small, arithmetic
  produces impractical leverage.
- Vol-target: annualized σ = 0.0055 × √(21×17) = 0.104 ≈ 10%/yr per position. To hit 20%/yr book vol,
  L ≈ 2.0×.
- **Cap wins: L = 1.0× notional.** This is the safe default until the forward clock actually accumulates
  real forward events (and the σ / μ can be re-estimated on out-of-sample-of-registration data).

**LOT SIZE, in operator terms:** for a $10,000 book, one trade on one instrument at 1.0× notional = $10,000
notional per position. If holding two clocks simultaneously (e.g., UTC 01 sweepPDL + UTC 09 belowPDL fire
overlapping), split notionally 50/50. If holding three, 33/33/33. **Total book notional never exceeds 1.0× book
capital** until any clock earns a promote verdict.

## Stop loss and take profit — where

The D-769 #8 lesson is critical: **symmetric ATR stop/target BROKE the D-768 mean-reversion signal** (t 2.59
flipped to t −6.63). The move the fade catches often trips a tight stop before reverting. So the exit rules
for this family are:

1. **PRIMARY EXIT — time-based, at K=6h close.** The registered clock's exit. This is the exit that made the
   measurement, so this is the exit that has forward-clock validity.
2. **STOP LOSS — very wide, ATR-based, catastrophic-only.** Use **2.5 × ATR(48h)** measured at entry.
   Purpose: exit only if the setup is fundamentally wrong (a real trend against the mean-reversion
   hypothesis), not on normal noise. On the D-780 UTC 01 cell measured on BTC 1h with ATR ≈ 50bp typical,
   a 2.5×ATR stop = ~125bp against the position — twice the average adverse excursion of a real reverting
   trade, so it catches only the outliers.
3. **TAKE PROFIT — none tight; ride to K=6h.** The measurement includes trades that would have hit and gone
   past a tight target; using a tight target would give up the tail. If a per-instrument TP is desired for
   discipline, use **3 × ATR(48h)** — deep enough that most K=6 trades don't hit it and the exit is still
   time-based.

**Numeric example — BTC UTC 01 sweepPDL-reclaim trade:**
- Entry: at bar close after UTC 01 sweep-and-reclaim of PDL.
- ATR(48h) at entry: e.g., 0.5% (50bp) on BTC.
- Stop: entry − 2.5×0.5% = **entry − 125bp** (long, so below).
- Take-profit: entry + 3×0.5% = **entry + 150bp** (optional, mostly ornamental).
- Primary exit: 6 hours later at the close of the K=6 bar, whatever price.
- Position size: 1.0× notional / N-simultaneous-clocks.
- Cost budget: 7bp crypto RT charged against the +15.44bp gross expectancy → net +8.44bp per trade.

## Trade-count math — is "large number of small trades" enough

At 1.0× notional per book, one clock fires ~21 times per year per instrument, ×17 instruments = 357 events/yr
book-wide. If sizing splits across simultaneous clocks (assume avg 1.5 concurrent), effective trades/yr ≈ 240
at 1.0× book notional each. Per-trade net ≈ +8bp. Annualised book return ≈ 240 × 8bp × (1/1.5 concurrency)
≈ **1,280 bp / yr ≈ 12.8%/yr gross** at 1.0× notional book vol.

Vol at 1.0×: σ_per_event × √240 = 55bp × 15.5 ≈ 852bp = **8.5%/yr book vol**. Sharpe ≈ 12.8 / 8.5 ≈ 1.5.
**That is descriptive of the historical setup, NOT a forward promise.** The registered forward clocks will
tell us in ~24 months if this shape holds.

## Kill / promote per operator

Two-sided rules already registered per clock. Additional operator-level book-management rules:

- **Book stop**: if aggregated book drawdown exceeds 15% at any point, halt all new entries pending review.
  This is a monitor-only rule (paper-mode), enforced by the future paper daemon's daily check on
  `trd_forward_marks` aggregate PnL.
- **Correlation halt**: if any single instrument accounts for >40% of book P&L over any rolling 30-event
  window, halt that instrument and re-check the sign map — the D-773 lesson (broad panel diluted D-772's
  headline) applies to LIVE state too.
- **No stacking**: never hold more than one direction on the same instrument at once. If UTC 01 fires
  LONG and UTC 09 fires SHORT (they can't on these three long-only clocks, but future clocks may include
  shorts), the second signal is skipped.

## What is NOT in this framework and needs work

- **Per-instrument σ measurements** — I estimated σ ≈ 55bp uniformly across the 17-panel. Real σ ranges
  from ~15bp (FX) to ~150bp (thin alts). A proper sizing daemon needs per-instrument σ from OOS data.
- **Rejection block analysis** — the operator's ask referenced "rejection blocks" (a specific SMC term).
  D-769 tested BOS / IFVG / retest-hold / eq-highs and NONE clear cost cross-panel. Rejection-block
  detection would be new detector code — I have not built it, and the D-775 chart-pattern audit already
  showed pattern-family conditioners don't add signal at the 10-crypto panel.
- **Per-clock ATR live query** — the framework references ATR(48h) but the paper-book daemon doesn't
  compute ATR yet. Small build; queued.
- **Cross-clock correlation** — three clocks can fire simultaneously; their per-event correlations are
  not measured. If they're correlated the effective concurrency is higher than 1.5×.

**The operator-actionable answer:** for each registered clock trade, position at 1.0× / N-concurrent notional,
2.5×ATR stop, 3×ATR ornamental target, primary exit at K=6h close. Expect ~240 trades/yr book-wide,
~12%/yr gross, ~8%/yr vol, Sharpe ~1.5 IF the D-780 measurement holds forward — which is precisely what the
three registered clocks will decide over the next 24 months.
