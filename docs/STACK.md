# STACK.md — the interconnected Aegis architecture (so no session loses context)

> One map of the whole engine: every layer, how they connect, what flows between them, what runs autonomously, and where
> the provenance lives. Read this + `DECISIONS.md` (append-only ledger) + `trd_lineage` (per-edge provenance) to reconstruct
> the entire engine without re-deriving it. The design principle: **each layer reads from the one below through a stable
> store, so a layer can be rebuilt without touching the others, and context is never lost between them.**

## The layer stack (bottom → top), and the store that connects each pair

```
 L0 DATA ─────────────────────────────────────────────────────────────────────────────────────
    keyless deep daily  → trd_bars_deep      (Yahoo period1=0, 1970→, all asset classes incl crypto)
    Databento intraday  → trd_bars_intraday  (minute bars, US equities — the below-daily layer)
    SEC bulk Form-4     → trd_insider         (240k open-market buys 2010→2026, keyless)
    survivorship-free   → trd_universe        (9,431 delisted names + dates, 1997→2026)
    market GEX/DIX      → SqueezeMetrics (2011→, keyless) ; per-name GEX → trd_gex_name (Nasdaq chain, free)
    funding/OI/liq      → Binance keyless ; macro/vol → Yahoo ^TNX/^VIX/^IRX ; short-vol → FINRA
        │  (every datum carries the date it was legally KNOWABLE — no look-ahead is structural, not a hope)
 L1 POINT-IN-TIME STORE ──────────────────────────────────────────────────────────────────────
    trd_factor_value  (effective_date CHECK ≥ ts — the materialized no-leak feature store)
        │
 L2 FACTOR ENGINE ─────────────────────────────────────────────────────────────────────────────
    trd_factor (pre-registered registry: mechanism + hypothesized SIGN before testing)
    trd_factor_ic (marginal IC per horizon × regime × era, trial-deflated via trd_trial_counter)
        │
 L3 ATTRIBUTION ENGINE (the "why") ─────────────────────────────────────────────────────────────
    trd_attribution — per instrument: multi-factor OLS onto its cluster's forces → R², adj-R², residual,
      per-force betas (the drivers), per_era (cross-cycle stability), per_tf (daily/weekly/monthly MTF),
      per_tf_intraday (min1/min5/min60 — the Epps effect). Clusters: equity, sector, fx, commodity,
      foreign_index, crypto — each with mechanism-backed forces.
        │
 L4 UNDERSTANDING + ENGAGEMENT GATE ────────────────────────────────────────────────────────────
    understanding = best-timeframe adj-R² × era-stability   (do we explain it, consistently, at some timeframe)
    directional   = a cycle-stable directional edge          (momentum/etc — currently none clears)
    ENGAGE = directional AND understanding ≥ threshold       (both required; neither alone trades)
    SIZE   = GEX vol-regime overlay (trd_gex_state, IC −0.49 proven) — vol-target sizing, NOT selection (D-352)
        │
 L5 SIGNAL + SURFACE ────────────────────────────────────────────────────────────────────────────
    aegis-signals — joins attribution + momentum + GEX; emits per-instrument lean/understanding/residual/
      drivers/gate-reason + the GEX regime overlay + the intraday ladder. Operator-gated (engaged signals
      redacted public). trd_signal (leans) + cron refresh.
    web/index.html (Vercel, origin/main) — the live Causal-engine cockpit reads aegis-signals.
```

## The compute node (the substrate every heavy job runs on)
- `scripts/aegis-worker.ts` — standalone UNCAPPED worker (own IP, self-pacing). Talks ONLY to the `trd-compute`
  broker (credential-free). Job types: `deep_factor_ic`, `attribution`, `intraday_attribution`, `insider_ic`
  (worker-paced price fetching that evades the edge fn's Yahoo IP rate-limit).
- `trd-compute` (broker) — the worker's I/O: claim jobs, serve deep/intraday bars + the insider sample, accept
  results/signals/attribution. The 2s edge cap stays on light I/O; the worker holds the heavy compute.
- `trd_compute_jobs` — the job queue (skip-locked claim). Results land back in `.result`.

## Provenance — where context is preserved (never lost)
- `DECISIONS.md` — append-only decision log (D-070 … D-355+), the narrative of every build + verdict.
- `trd_lineage` / `trd_lineage_roster` — one row per edge/factor: hypothesis, test method, key metric, verdict,
  status, decision_refs. The queryable spine — reconstruct any edge's history in SQL.
- `trd_trial_counter` — every IC/backtest increments it; DSR deflation reads it. No Sharpe/IC without its N.

## What runs autonomously (crons — the engine keeps working with no operator/me)
- `trd-bars-deep-drain` (*/2) — refresh deep bars.        · `trd-signal-refresh` (6h) — refresh signal leans.
- `trd-gex-state-refresh` (daily) — market GEX → sizing.   · `trd-gex-name-daily` (daily) — per-name GEX snapshot.
- `trd-insider-backfill` (*/5) — SEC bulk keeps filling.   · `trd-insider-ic-weekly` (Mon) — re-test as coverage grows.
- `trd-risk-officer` (*/10) — exposure caps + kill-switch. · plus the legacy factory/forward crons.

## The honest state of the mission (the verdict layer)
- **Understanding: complete.** Every asset class × every timeframe (minute→monthly) is attributed with an honest residual.
- **Directional edge: none clears.** Grammar, momentum, funding, cross-sectional, auction-imbalance, GEX-directional,
  DIX, VIX-TS, insider (every powered read) — all null or decayed. This is D-070's designed SUCCESS state.
- **One signal decisively clears: GEX → vol** (IC −0.49, every era) — wired as the SIZING overlay, not a trade.
- Survivorship membership fixed; per-name GEX + insider decades accumulating for future backtests.

## How to extend without losing context
Add a data source → L0 store. Add a force → `trd_factor` (pre-register the sign) + a cluster in the worker's `buildForces`.
Add a heavy test → a worker job type + a `trd-compute` broker path. Record the verdict → `DECISIONS.md` + `trd_lineage`.
Every layer reads the one below through its store; nothing reaches across layers; the provenance ledger captures the why.
