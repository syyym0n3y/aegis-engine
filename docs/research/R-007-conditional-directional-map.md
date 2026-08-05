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

---

## FALSIFIED (2026-08-06, D-146) — read this before using anything above

The four candidates above were pre-registered (D-145) and then put through the full audit the operator
demanded ("account for everything"). **All four failed. None reached the forward test with capital.**

1. **Random-entry control (decisive).** For each setup we fired 5× random entries in the SAME instrument,
   SAME regime, SAME direction, SAME stop/target. **No setup beat its control** — every |t| < 2, and 3 of 6
   market×setup combos were *worse* than random (S&P meanrev-long-calm: setup +0.093R vs random +0.171R).
   → What R-007 discovered was **the REGIME, not the setup**. In calm VIX a random long earns +0.15–0.25R
   because equities drift up. The sweep/RSI triggers were decoration on drift.
2. **Universe breadth (survivorship).** On 50 instruments (sectors, singles, bonds, commodities, intl):
   stress-short positive in **0/50** (mean −0.217R); calm-long **25/50 = coin flip** (mean +0.001R), working
   on tech/growth (GOOGL, META, AMZN, XLK) and failing on commodities/rate-sensitives (DBC, SLV, GLD, USO,
   XLE) — the signature of **long-equity beta**, not a setup.
3. **Era walk-forward.** stress-short positive in only 4/6 eras and concentrated in 2021 (+1.97R) while the
   2020 crisis was **negative** (−0.09R) — a one-era artifact. (calm-long was 11/11 eras, but §1 and §2 show
   that persistence is drift, not edge.) BTC lowvol candidate: 4/8 eras, negative 2022–2024 = decaying.
4. **Gap risk** (the one they survived): charging adverse overnight gaps cost ~0.03R; not the killer.

**Standing conclusion:** the corpus verdict (D-070…D-144) is unchanged and now stronger — no mechanical
setup, on any timeframe, in any regime, across any instrument set, beats a random entry in the same regime.
The durable value remains the **risk/sizing engine + regime awareness**, which is real, measured, and live.
The lesson to carry: *conditional expectancy must always be compared against a matched random control* —
without it, regime drift reads as a setup edge. That control is now a permanent gate.
