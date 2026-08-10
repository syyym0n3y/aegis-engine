# CONSISTENCY_AUDIT.md — one uniform standard for every edge (D-261)

> Operator directive (2026-08-10): "make sure by the time real money is at play, we know everything
> across all markets, timeframes and observable metrics… integrate historical data uniformly to the
> tests we have already done… highest % certainty anybody can be on every trade."
>
> **The honest translation:** we cannot know "everything." We CAN force every edge through the SAME
> gauntlet so results are comparable and no edge is trusted on a weaker test than another. Certainty is
> impossible; **uniform, adversarial, cost-pessimistic, out-of-sample calibration** is achievable. This
> file is the checklist. An edge that fails any column is NOT cleared for real money — no exceptions.

## The 7-column uniform standard (every edge, every market, every timeframe)

| # | Column | Definition | Why it's non-negotiable |
|---|---|---|---|
| C1 | **Same geometry** | Identical entry/stop/target rule tested and traded (bracket, R-defined) | A backtest that doesn't match the executor is measuring a different strategy |
| C2 | **vs-random control** | Edge measured as (strategy R − matched random-entry R), not absolute | Absolute R is inflated by market drift; only vs-random is skill |
| C3 | **Pessimistic cost** | Spread + slippage + commission subtracted, worst-case fill assumed | Paper P&L is never "edge"; costs kill most intraday edges |
| C4 | **OOS survival** | Holds POSITIVE in split-half AND walk-forward, trial-count deflated | In-sample selection over N windows manufactures fake edges (killed the fade) |
| C5 | **Per-instrument attribution** | Edge reported per symbol/asset-class, not pooled | Gold ≠ Nasdaq ≠ crypto; a pooled average hides which instrument carries it |
| C6 | **Trial-counted** | Every run increments `trd_trial_counter`; Sharpe/edge always reported with N | A Sharpe without its N is a lie (RISK_POLICY invariant) |
| C7 | **Regime/metric gate** | The conditions under which the edge is ON are measured, not assumed | "When does it work?" is the difference between an edge and a coin flip |

## Scorecard — where each edge stands TODAY (verified 2026-08-10)

| Edge | C1 geom | C2 vs-rand | C3 cost | C4 OOS | C5 per-instr | C6 trials | C7 regime | Verdict |
|---|---|---|---|---|---|---|---|---|
| **bblo** (MR long) | ✅ | ⚠️ partial | ⚠️ | ✅ 47yr 30/30 | ✅ 16/16 | ⚠️ | ❌ none | **strongest, but cost+regime unproven** |
| **xsec 12-1 mom** | ✅ | ❌ | ⚠️ | ⚠️ t=6 NASDAQ | ⚠️ | ❌ | ❌ | real factor, not gauntlet-run |
| **futures ORB-follow** | ✅ | ✅ | ❌ **none** | ✅ 21/21 both halves | ✅ 4 instr | ❌ | ⚠️ session only | **validated direction; cost + broker gap** |
| **crypto momentum** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | deployed on thesis only — UNPROVEN |
| **pairs** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | deployed on thesis only — UNPROVEN |
| **vrp (SVXY proxy)** | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ term-struct | ⚠️ contango gate | proxy, thesis-gated — UNPROVEN |
| **rip-short** | ✅ | ✅ | — | ❌ fails 47yr | ✅ | — | — | **DISABLED (correctly)** |

Legend: ✅ done · ⚠️ partial/weak · ❌ missing. **The pattern is stark:** only two edges (bblo, futures
ORB-follow) have cleared vs-random + OOS. The three "live" thesis edges (crypto/pairs/vrp) have NOT been
put through the gauntlet at all — they are running on plausibility, which is exactly what D-070 forbids.

## Verified structural gaps (the "what's missing" answer)

1. **The skill metric and the equity metric live in different engines.** `trd-backtest-instances` =
   absolute equity curve, NO random control, NO cost (its own comment: "not the vs-random skill metric").
   `trd-futures-backtest-hist` = vs-random, NO cost. **Neither computes both. Nothing computes cost.**
   → Build ONE harness that emits {absolute R, vs-random edge, cost-net R, trial N} for every edge.
2. **Cost/slippage MODEL EXISTS but is not wired into the backtests.** CORRECTION (verified 2026-08-10):
   `_shared/trd-cost-model.ts` (pessimistic prior) AND `_shared/trd-cost.ts` (Corwin-Schultz MEASURED
   spread) both exist and are tested — my earlier "nowhere" was wrong; it's true only for the two ENGINES
   I'd inspected (trd-backtest-instances, trd-futures-backtest-hist), which bypass the library. The entire
   honest-stats core (evaluateStrategy/DSR/minTRL, gateVerdict, edgeVsRandom) also exists and is imported by
   NOTHING except trd-copilot. → The gap is WIRING, not creation: one runner that drives every edge through
   these cores cost-net. (This is D-263, trd-edge-backtest.)
3. **Random control is uneven.** Only futures + (partially) bblo. crypto/pairs/vrp have none.
   → Port the matched-random-entry control (already in futures-hist) into the unified harness.
4. **No regime/metric matrix (C7).** We measure IF an edge works, never WHEN. This is the whole of the
   operator's "observable metrics that inform favourable conditions." → For each edge, bucket results by
   regime (trend/chop via ADX or MA-slope), volatility (ATR percentile / VIX), session, and range-width;
   report edge-per-bucket. The edge's tradeable window is where it's positive net-of-cost OOS.
5. **Trial counting not wired into the new backtests.** `trd_trial_counter` exists but instances/futures
   don't increment it. → Every backtest run bumps it; every reported edge carries N.
6. **No provenance ledger.** DECISIONS.md is prose, not queryable. → `trd_lineage` table: one row per lead
   with {hypothesis, test, verdict, killed_by/survived, decision_ref} so the entire development of the
   system — every fork and why — is auditable in SQL. This is the "track the entire development" ask.

## Build queue (priority order — each is a gate, not a nicety)

- **P0** Unified backtest harness (`trd-edge-backtest`): {C1,C2,C3,C6} for ALL edges in one place, cost-net.
- **P0** Cost model per instrument/asset-class (tick, typical spread, slippage) — feeds every backtest.
- **P1** Regime/metric bucketing (C7) — the per-trade calibration layer; turns "an edge" into "an edge
  that fires only in its favourable regime," which is the real path to lower loss-rate.
- **P1** Put crypto/pairs/vrp through the harness — expect most to REJECT (that's success, per D-070).
- **P2** `trd_lineage` provenance table + backfill from DECISIONS.md.
- **P2** Per-trade probability score surfaced in the cockpit (calibrated, OOS-validated — NOT "win rate").

## The certainty question, answered honestly

"Highest % certainty anybody can be on every trade" = **positive expectancy, net of pessimistic cost,
that survives OOS, traded only in its measured-favourable regime, sized so no single loss can hurt.**
That is the ceiling. It is NOT a 100% win rate and NOT foreknowledge of every tick. An edge that wins 45%
at +1R (like bblo) makes money forever; one that wins 95% at +0.1R with a −10R tail goes to zero. We
optimize expectancy × calibration × bounded risk — never win-rate. Anyone promising more is lying.
