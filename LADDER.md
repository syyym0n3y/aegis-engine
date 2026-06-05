# LADDER — staged autonomy, where capital is EARNED out-of-sample

> Autonomy and money flow DOWN this ladder only as out-of-sample proof
> accumulates. The default is RESEARCH. Failing any gate auto-demotes. Most
> strategies will and SHOULD die at Stage 0–1 — that is the engine working.
> Thresholds live in `trd_gate_thresholds` (decision-locked, see D-070).

| Stage | Name | Capital at risk | Auto-exec? |
|------|------|-----------------|-----------|
| 0 | RESEARCH / BACKTEST | **$0** — no broker connection | no |
| 1 | PAPER (Alpaca paper) | **$0** — cost-haircut applied | no |
| 2 | MICRO-LIVE (manual) | capped, fully-losable R&D budget | **no — operator places every fill by hand** |
| 3 | SMALL-LIVE | small fixed allocation, per-session hard cap | first autonomous orders, risk-gated |
| 4 | SCALED | scaled, still kill-switch-bounded | yes, governed |

## Stage 0 — RESEARCH / BACKTEST  ($0, ever)
**Goal:** ingest legal free data, build the point-in-time feature store, run the
falsification engine. Prove the SUBSTRATE kills bad strategies before any
strategy is trusted. Use congressional + Form-4 as a low-vol CALIBRATION
dataset, not a profit engine.
**Promotion gate (Stage-1 self-test):**
- (a) a deliberately-overfit / random strategy is correctly REJECTED by DSR/PBO;
- (b) the congressional copycat, when it "beats SPY", is shown by the
  factor decomposition to be sector beta, not residual alpha → killed;
- (c) trial counter, point-in-time enforcement, and the pessimistic cost model
  are all live and unit-tested.
- **No strategy may advance until at least one candidate has been correctly killed.**

## Stage 1 — PAPER  ($0, optimistic — cost haircut applied)
**Goal:** route only stats-surviving signals to Alpaca paper; document the real
(still optimistic) forward success rate out-of-sample on data the backtest never saw.
**PAPER → MICRO gate:** ≥30 independent OOS trades · Deflated Sharpe > 0 at 95%
(penalized by trials) · PBO < 0.5 · realized maxDD < 6% · net-of-modeled-cost
positive. Fail any ⇒ REJECT/demote.

## Stage 2 — MICRO-LIVE  (real money, MANUAL only — Claude never executes)
**Goal:** smallest tradeable real size, fills the operator places themselves.
Capture the live-vs-backtest gap: true slippage, fills, borrow, psychology. This
is the operator's "small manual trades to document the real success rate" phase,
logged in `trd_manual_trades`.
**MICRO → SMALL gate:** ≥50 REAL-money trades · live results within ~1 std of the
backtest expectation · measured slippage logged and folded back into the cost
model · daily kill-switch never breached. Still ZERO autonomous execution.
**Hard prerequisites before ANY Stage-3 auto order (see D-070 addendum):**
broker-state reconciliation + cancel-on-disconnect + deterministic
`client_order_id`; mark-driven kill-switch; position-level catastrophe cap;
observability/alerting tier.

## Stage 3 — SMALL-LIVE  (first autonomous execution, hard-capped)
**Goal:** the earliest point any order may be auto-placed — only after passing the
deterministic risk gate. Small fixed capital, quarter-Kelly ceiling, full
circuit-breaker enforcement.
**SMALL → SCALED gate:** ≥100 live trades positive across ≥2 independent
regimes/quarters (at least one must include a drawdown/vol-spike — calm-only
samples don't count) · MinTRL satisfied for the realized Sharpe · zero
risk-invariant violations. Any violation auto-demotes.

## Stage 4 — SCALED  (governed growth)
**Goal:** increase capital within risk invariants only as OOS proof accumulates.
Never the starting state; always earned.
**Continuous gate:** rolling DSR > threshold · drawdown inside budget ·
regime-shift detector quiet. Demote on any breach.

## Project-level kill criterion
After `shelve_after_families` (25) strategy-families OR `shelve_after_compute_hours`
(200h) with zero promotions past PAPER, the honest conclusion is **there is no
accessible edge → shelve the trading vertical.** `null_result_is_success = true`.
The engine kills strategies; this kills the project so it can't become a
multi-year zero-revenue sink.
