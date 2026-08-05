# R-007 — Conditional Directional Map (data-first discovery)

**Method (operator directive, 2026-08-05):** stop imposing a system on the data. Run ONE setup per trade
(non-overlapping, one position at a time) across markets × timeframes, tag EVERY instance with its full
condition vector, then DISCOVER where winners cluster — don't pool-and-deflate. `scripts/trd-instance-discovery.ts`.

**Scale:** 1,973,680 trade instances. 4 markets (S&P500, Nasdaq — Dukascopy 1m 15y; BTC, ETH — Binance 1m
full-history 9y, 4.7M bars each from bulk dumps). 6 timeframes (5m/15m/30m/1h/2h/4h). 6 setups (meanrev
long/short, breakout long, breakdown short, sweep-reversal long/short). 3,989 condition-cells.

**Anti-snoop rule:** a condition counts as a "winner" only if positive IN-SAMPLE *and* OUT-OF-SAMPLE on the
SAME slice (a lucky slice is random OOS). Then compare persistent-winner COUNT vs chance, and require
COHERENCE (repeats across ≥3 independent market×TF) to call it signal.

## Verdict

- **Aggregate is ~chance:** 18.4% of cells persistent vs 14.5% chance baseline (IS+ 38% × OOS+ 39%). No
  blanket mechanical edge — confirms D-070…D-142 at 2M-instance scale.
- **But coherent CONDITIONAL directional structure is real** (repeats across independent markets/TFs + has a
  mechanism; calendar slices — month/dow, incl. impossible index-CFD "Sunday" — discarded as noise):

| Condition | Direction | Independent market×TF combos | Avg OOS expectancy | Mechanism |
|---|---|---|---|---|
| VIX **stress** (>25) | **SHORT** (sweep-rev, breakdown) | 10, 9 | **+0.354R, +0.252R** | vol expansion / overshoot |
| VIX **calm** (<15) | **LONG** (sweep-rev, meanrev, breakout) | 10, 9, 11 | +0.200, +0.207, +0.153R | upward drift |
| **Low-vol** (atr bottom tercile) | **LONG** sweep-rev | 16 (broadest) | +0.150R | range mean-reversion |
| **Asia** session | **LONG** sweep-rev | 12 | +0.184R | quiet-tape reversion |

## What this means for the system

The system's directional contribution is a **regime-conditioned LEAN**, not a mechanical trigger: in stress
→ lean short; in calm / low-vol / Asia → lean long. It is the *refined data the co-pilot QUERIES at decision
time* ("in conditions like now, which setups/directions have persistently won?"), sized by the risk engine
(vol-regime / GEX / per-asset implied-vol de-risk). These remain **CANDIDATES** — modest expectancy,
fat-tailed, low win-rate — and must clear a pre-registered forward test before any real capital. The honest
frame is unchanged: the edge is conditional awareness + risk sizing, not a high-Sharpe mechanical signal.
