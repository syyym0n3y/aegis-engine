# METHODOLOGY_AUDIT.md — where we've been wrong, and what removes the bottleneck (D-173)

> Written because the operator asked, correctly, "analyse what our flaws in methodology have been" and "identify
> when you're the problem." This is the honest self-audit. It is governed by ANALYSIS_CONTRACT (report the
> measurement, not the feeling) and OPERATING_DOCTRINE (research before you defer). It names the confounds in our
> own results and the infrastructure that ends me-as-per-analysis-bottleneck.

## Part 1 — Methodology flaws, ranked by how much they distort the verdict

1. **Survivorship bias (HIGH).** The 123-instrument Yahoo universe contains only names that still trade. Every
   long backtest is inflated by the absence of the dead (Enron, Lehman, Wirecard, thousands of delisted small
   caps). D-173's "long optimal cap 6-10R, positive across every class" is largely this artifact + secular drift,
   NOT a harvestable edge. The short side (no drift tailwind) is the cleaner read and it is mostly negative.
   FIX: survivorship-free, point-in-time data (Norgate, CRSP). Cannot be fixed with Yahoo.

2. **Universe breadth (HIGH).** 123 daily + 4 intraday series ≠ "every stock in every market" (~50k+ globally).
   We cannot claim a market-wide verdict from a convenience sample. The class-level PATTERN (equities drift-long,
   commodities/FX/crypto fat-tailed) is structural and trustworthy; any single-instrument "winner" is not.
   FIX: a data vendor + a sandbox with the full universe built in (below).

3. **In-sample parameter selection (HIGH).** Picking "best cap" or "best cell" on the same data that scores it is
   the classic overfit. We caught it once (D-149 selection contamination) and re-committed a milder version in the
   cap sweep (argmax-k in-sample). Only the survivor (BTC/5m/short) has true OOS + forward. Everything else is a
   LEAD until it clears walk-forward.
   FIX: mandatory train/validate/test split in ONE enforced harness, not per-script discipline.

4. **Inconsistent deflation across scripts (MEDIUM-HIGH).** The gate is DSR>0.95 / t≈3.1 at 92 trials, but several
   exploratory scripts print t≥2 verdicts. A reader skimming sees "EDGE" at t=2.1 that the trial count kills. We
   corrected this inline (D-170 dismissed the S&P cells) but the tooling should refuse to print an un-deflated pass.
   FIX: a single `assertDeflated(t, nTrials)` that every script imports; no ad-hoc thresholds.

5. **Look-ahead re-implemented ad hoc (MEDIUM).** asOf/causality is enforced correctly in places (S/R pivots
   confirmed after W bars; trd_features.effectiveDate) but re-coded each script — one slip = a lying backtest.
   FIX: a shared, unit-tested causal-indicator primitive; scripts may not index future bars directly.

6. **Transaction cost is estimated, not measured (MEDIUM).** Corwin-Schultz spread + researched fee tiers, never
   real fills. At size, slippage + market impact are unmodeled. The survivor's ≤5bp survival gate is a knife-edge
   that only real fills settle. FIX: paper→micro with a real broker API records true fills (the LADDER already
   specifies this; we just haven't reached the rung).

7. **Fragile, geo-blocked data pipes (MEDIUM).** Binance is geo-blocked from the Supabase datacenter (forced the
   forward tracker onto Yahoo, a discrepancy the tracker itself will expose); FRED's CDN blocks it too; Yahoo is
   unofficial + rate-limited. FIX: a proper vendor with a stable API and datacenter reachability.

8. **Single-laptop, CSV-bound compute (MEDIUM).** Hand-rolled CSV loaders, in-memory arrays, O(n) rescans. Fine
   for 5M bars; impossible for 50k instruments × tick. This is the literal reason "chart every stock" cannot run
   here. FIX: columnar store (DuckDB/Parquet locally; ArcticDB/kdb+ at scale) + a vectorized or event-driven engine.

9. **Regime-conditioning is shallow (LOW-MEDIUM).** We know the BTC edge degrades on curve inversion (D-084) but
   don't systematically condition each cap/edge on regime. FIX: regime as a first-class dimension in the harness.

## Part 2 — Where I (Claude) have been the bottleneck, by the operator's own thesis test

- **Musk (first-principles / "the best part is no part" / delete the process step):** I have hand-rolled ~10
  bespoke analysis scripts. Each answered its question, but re-authoring the loader + ATR + random-control every
  time IS the expensive part that should be DELETED. The fix is not me writing an 11th script faster — it is one
  reusable engine so the marginal analysis costs near-zero. When I reach for a new one-off instead of the substrate,
  I am the problem.
- **Thiel (secrets / definite optimism / monopoly):** returning "limitation" without a verified search or a
  concrete path is indefinite pessimism — the failure mode. A $100 retail edge is also not a MONOPOLY (no moat,
  capacity-bound). The honest secret we DID find (crypto short mean-reversion tail) is exactly the unglamorous,
  small-capacity, disbelieved kind Thiel predicts survives — that is the direction, not "test everything and hope."
- **Karp (ontology / results-not-narrative / hard defensible ground):** our moat, if any, is the GATE (random
  control + deflation + forward ledger) as an enforced ontology the machine won't let a motivated operator loosen.
  When I present a number without naming its confound (drift, survivorship, selection), I choose narrative over
  ground truth — and I am the problem. This audit is me paying that debt.

**Self-diagnosis rule (adopt):** I am the bottleneck the moment I (a) say "can't" without a search + a next step,
(b) hand-roll what should be substrate, or (c) report a result without its confound. Any reviewer can hold me to
these three.

## Part 3 — Recommended sandboxes / data (the ceiling-removers), with what each unlocks

**Primary recommendation — one platform that removes me as per-analysis bottleneck:**
- **QuantConnect / LEAN** — cloud backtesting with survivorship-free US equities+options+futures+crypto+FX
  BUILT IN, event-driven (no look-ahead by construction), multi-asset, paper + live brokerage. Free tier; ~$20–60/mo
  for more data/compute. Python. THE fit: it has the universe + the engine + the point-in-time discipline we keep
  re-implementing. Our job becomes porting the GATE (honest-stats core) on top — that is our IP, not the plumbing.

**Data vendors (if we stay partly local):**
- **Norgate Data** (~$40–80/mo) — survivorship-free US equities + futures with delisted names. Directly fixes flaw #1.
- **Polygon.io** (~$29–199/mo) — all US equities/options, tick + aggregates, stable API, datacenter-reachable.
- **Databento** (pay-per-use) — institutional tick, futures + equities, point-in-time.
- **Tiingo** (cheap) EOD + fundamentals; **Alpaca** (free equities data + paper API); **Dukascopy** (free FX/CFD tick — already used); **CCXT** (unified crypto). **CRSP via WRDS** = academic gold standard if institutional access appears.

**Storage / compute upgrade (kills flaw #8):**
- **DuckDB + Parquet** locally (columnar, SQL, 10–100× over CSV) → **ArcticDB** (tick store) → **kdb+/DolphinDB** at scale.
- **Polars / vectorbt** for fast vectorized sweeps; **NautilusTrader** (Rust core) for event-driven at scale.

**Recommended concrete next move (definite, not "keep digging"):** stand up LEAN (free tier) + port the honest-stats
gate; run the D-170 full-sweep protocol (random control + deflation + both-halves + walk-forward) across the
survivorship-free universe with the per-market cap from D-173; feed survivors into the existing `trd_forward` tracker.
That is the version of "chart every market" that is real, runs without me, and cannot be faked. The bottleneck was
never effort — it was substrate. This is the substrate.
