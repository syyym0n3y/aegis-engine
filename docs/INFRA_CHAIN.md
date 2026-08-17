# INFRA_CHAIN.md — own the chain (honest map to market-disruptor)

> **The uncomfortable framing first.** "No limitations whatsoever" is the wrong objective. Owning the chain to
> zero latency = becoming an HFT firm, a game decided by colocation, FPGAs and capital we cannot win and do not
> need to. Modularity + causality applied to the STACK say: **own every link in the causal chain of the edges
> that are ours to take; deliberately refuse the one link (sub-second latency) whose physics we cannot own, and
> build our own substrate everywhere that link is within reach.** Our disruption is the **completeness and
> honesty of the find→prove→exploit chain across every asset at seconds-to-days horizons** — not speed. On the
> links that decide TRUTH (point-in-time discipline, falsification, risk) we are already ahead of most funds;
> the gaps are compute-at-scale, the multi-factor combiner, and equity-data ingestion — all buildable.

## The chain, link by link — OWN / BUILD-NOW / REFUSE

| # | Link (causal role) | State | Verdict | Gap → action |
|---|---|---|---|---|
| 1 | **Data acquisition** — the root of every causal chain | Crypto: Binance OHLCV/funding/OI/**liquidations**, keyless, 24/7 — chain **fully owned**. Equities/futures: Yahoo/Stooq (bars), SEC EDGAR (filings), CBOE (VIX), FINRA (short vol), Deribit (crypto IV) — all keyless. **Databento** (institutional MBO/MBP/trades/options/**auction-imbalance**) — PAID, key owned, **dormant** (pulling 1% = ohlcv-1m on 2 futures). **AlphaVantage** (earnings/fundamentals/options-greeks) — key not even stored. | **OWN (crypto) / HAVE-BUT-DORMANT (equity)** | The equity gap is **ingestion, not access.** BUILD ingestors for Databento auction-imbalance + trades and AlphaVantage EARNINGS/options. This is the highest-leverage data build. |
| 2 | **Point-in-time store** — makes look-ahead structurally impossible | `trd_factor_value` + `pit_no_leak` CHECK (`effective_date ≥ ts`), built D-331. The `trd_features` store CLAUDE.md always assumed but never had. | **OWN** ✅ | Disruptor-grade. Most retail has zero PIT discipline; this is a moat. |
| 3 | **Factor computation** — data → causal factor | Modular engine `trd_factor`/`trd_factor_value`/`trd_factor_ic`, 12 factors pre-registered, built D-331. | **OWN** ✅ | Extend with each new force. The registry is open by design — no rewrite to add a force. |
| 4 | **Validation / falsification** — the thing with positive EV | Honest gauntlet: rank-IC, DSR, walk-forward, trial-count deflation, matched random control, cross-market pooling, effective-N. Pre-registered sign kills fishing. | **OWN — our actual moat** ✅ | Arguably better than most funds. This is where we ALREADY disrupt. It just killed our own best lead (funding IC-null, D-332) — working as designed. |
| 5 | **Signal generation** — combine factors → position | Single-factor only. No orthogonalizing multi-factor combiner, no regime-conditional weighting, no IC-weighted sizing. | **BUILD-NOW** 🔨 | Build the combiner: orthogonalize surviving factors, weight by conditional IC, size ∝ conditional-IC × conviction / instrument-risk. This is where IC×√breadth becomes dollars. |
| 6 | **Execution** — signal → fill | Crypto: internal keyless paper broker (real Binance marks + funding). Equity: Alpaca paper. | **OWN paper / crypto real-ownable / equity intermediated** | Crypto: we can BUILD our own real execution on direct exchange REST/WS (~100ms, free, no broker) — **own the full crypto chain end-to-end.** Equity: full DMA = broker-dealer/regulatory wall → **use Alpaca, refuse becoming a broker.** |
| 6b | **Sub-second / microstructure latency** — colocation, DMA, FPGA | Not owned; Alpaca fills in seconds. | **REFUSE (structural)** ⛔ | We cannot own the physics. **Do not build microstructure-latency edges** (raw OBI, Hawkes, iceberg). Measure them for research only; never gate them to live. Build only factors executable at seconds-to-days. |
| 7 | **Risk / capital management** — sizing, caps, kill-switch | Risk Officer (per-edge 6 / global 24 / $80k gross, autonomous trim, D-322), durable kill-switch, exposure caps. | **OWN** ✅ | Disruptor-grade. Extend caps to per-factor once the combiner ships. |
| 8 | **Monitoring / forward-decay** — live truth | Forward validator, completion heartbeats, cron-health views, IC-decay flag on `trd_factor_ic`. | **OWN** ✅ | Wire factor-IC decay detection into the same forward loop. |
| 9 | **Compute substrate** — where every test runs | Supabase edge functions, **~2s CPU/invocation**. This is the REAL "we're slow" bottleneck: every factor test must be bounded to 2s, so scale mining + ML combiners can't run. | **BUILD-NOW — highest impact** 🔨 | Stand up our OWN compute worker (a container/VPS running Deno/Python, no CPU cap) that we own, pulling work from the same queue. Removes the bound that makes discovery a months-long crawl. This single build is what turns the engine from a crawler into a scale factor-miner. |
| 10 | **Capital** — the fuel | Paper; real gated behind staged rungs (by design). | **STAGED (not a gap)** | Not an infra gap — a safety decision. Real capital only after the gates, per the ladder. |

## How much infra do we lack? (honest scorecard)
- **Truth layer (data-PIT-validation-risk-monitor): ~90% owned.** This is where disruptors are actually made and where retail/most-funds are weakest. We are already ahead here.
- **Scale layer (compute-at-scale): ~40%.** The 2s edge limit is the real speed gap. **Build our own compute node.**
- **Exploitation layer (combiner + equity ingestion + crypto direct-execution): ~25%.** All buildable, no walls.
- **Latency/HFT layer: ~0% and deliberately REFUSED.** Not our game; building it would burn capital for a structurally-lost fight.

**Verdict:** we are ~2 builds away from a genuinely disruptive find→prove→exploit machine — (1) our own uncapped compute worker, (2) the equity-data ingestors + multi-factor combiner. We are NOT one HFT-colocation away from anything; that door is correctly closed.

## Modularity + causality across the whole stack
- **Causality per link:** each link exists because it is a *cause* in the chain from raw force → measured factor → sized position → realized P&L → decay signal. A link with no causal role (e.g. candle-geometry mining) is removed, not optimized.
- **Modularity per link:** each link is independently replaceable — swap the compute substrate without touching the factor engine; add a data source without touching validation; add a factor without touching the combiner. That is what lets the map GROW toward the destination without a rewrite — the structural answer to "there's a lot we still haven't accounted for."

## Prioritized build order (removes the real gaps, in impact order)
1. **Own compute worker** (kills the 2s bound → scale factor-mining, ends "slow"). Link 9.
2. **Databento + AlphaVantage ingestors** (light up the dormant paid assets → equity factors). Link 1.
3. **Multi-factor combiner** (orthogonalize + regime-condition + IC-size → IC×√breadth becomes dollars). Link 5.
4. **Direct crypto execution** (own the full crypto chain end-to-end at exchange latency). Link 6.
5. Everything at link 6b stays research-only, forever gated out of live. ⛔
