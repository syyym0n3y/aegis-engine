# NEXT — work queue

## PLATFORM (D-078 — built + live; the queue to productionise)
- [x] Verify/Protect/Allocate engines + live APIs + public Terminal.
- [x] Risk Firewall + Setups + adaptive Bot + Paper-Broker bridge (119/119 tests).
- [x] Capstone proof: allocator concentrates on the real edge (factor book) → compounds.
- [x] **Cleanup (worked around)**: 5 disposable probe fns on command-centre are now INERT +
      JWT-locked (return 410) — no operator dashboard-delete needed. `trd-cred-probe`(qpck/rrjr
      copies remain, read-only booleans, harmless). Keepers: `trd-api-*`, `trd-platform`,
      `aegis-terminal`, `trd-paper-tick`, the data pumps.
- [x] **Macro-regime overlay (D-079)**: `trd-macro.ts` fragility engine → `trd-macro-pump`
      (Yahoo curve+vol, keyless) → `trd_macro_state` → `trd-paper-tick` throttles size → cockpit
      cycle view. pg_cron 4×/day. Live: EXPANSION, de-risk 1.0. Macro = fragility, NOT direction.
- [x] **Strategy algebra + mass search (D-081)**: trd-grammar.ts (2160 combos, 4 trigger classes) +
      trd-strategy-search.ts (deflation-aware, 4 real markets). trd_strategies corpus on CC.
- [ ] **Extend the algebra**: more triggers (order-block, BOS/CHoCH, RSI-divergence, VWAP, engulfing),
      multi-component AND/OR composites, more timeframes/markets; keep DSR+PBO deflation on every run.
- [ ] **Corpus ingest loop**: each strategy the operator feeds -> decompose to grammar point -> log to
      trd_strategies with verdict. (Bulk YouTube transcript scrape is gated; feed screenshots/text.)
- [ ] **Macro enrichment**: get FRED credit-spread/unemployment(Sahm)/CPI into the edge path
      (FRED blocks the SB datacenter → currently best-effort via `scripts/trd-macro-refresh.ts`);
      add EA/UK/JP/CN economies (blend is already contagion-dominated).
- [ ] **Close risk-inventory gaps**: slippage/gap-through-stop stress, fat-tail/black-swan,
      cross-account exposure, durable kill-switch state, disconnect/reconcile.
- [x] **Autonomous live PAPER loop (worked around, running)**: `trd-paper-tick` edge fn +
      `trd_paper_state` + **pg_cron every 6h** advances a real paper account on keyless crypto,
      autonomously, $0. This IS the forward 'keep + compound over time' test, live now.
- [ ] **Live REAL-MONEY bridge** — HELD behind the gates by invariant (paper-first until the
      risk record is clean). Not a tooling limit; the one boundary that must not be bypassed.
- [ ] **Productionise**: auth + per-firm keys + billing on the APIs; PDF report; branded domain
      (Vercel create-permission OR custom domain on the edge fn).
- [ ] **Prop-firm pilot** ([`docs/product/PILOT-propfirm.md`](./docs/product/PILOT-propfirm.md)) — the monetising wedge.

## Active (Stage 1 — research/backtest, $0)
See [`docs/trd/STAGE1.md`](./docs/trd/STAGE1.md) for the full spec + VERIFY per step.

- [x] 0. Bootstrap workspace + governance + honest-stats core (`_shared/*`, 20 tests green).
- [x] 1a. Write `0001_trd_substrate.sql`.
- [ ] 1b. **OPERATOR:** provision Supabase project + apply `0001`.
- [ ] 2. `agent-trd-ingest-congress` (House Clerk + Senate eFD, idempotent).
- [ ] 3. `agent-trd-ingest-edgar` (Form 3/4/5 + 13F, 10 req/s + User-Agent).
- [ ] 4. `agent-trd-ingest-prices` (Alpaca paper OHLCV, bitemporal, delisting-inclusive).
- [ ] 5. `agent-trd-features` (point-in-time store; `effective_date` enforced).
- [ ] 6. `agent-trd-backtest` (walk-forward + cost model + full stats panel + factor decomp).
- [ ] 7. `agent-trd-architect-gate` (deterministic stats veto, default REJECT).
- [ ] 8. `cc-trd-report` CC oversight panel (REJECTED list visible).
- [ ] 9. CI self-test harness (overfit rejected / look-ahead empty / dup no-op).

## Wyckoff evolutionary track (D-074 — built + verified offline, $0)
- [x] `_shared/trd-wyckoff.ts` — point-in-time Wyckoff events + confidence levers (evr, cvd-proxy). 8 tests.
- [x] `_shared/trd-evolve.ts` — trial-honest genetic search (DSR-deflated by true N + PBO). 7 tests incl. noise-safety.
- [x] `scripts/trd-wyckoff-evolve.ts` — runner (offline `BARS_FILE` mode verified → REJECTED as expected; DB mode ready).
- [ ] **OPERATOR (unblocks real-data sim):** `supabase start` + Alpaca paper creds → `./scripts/trd-ingest-prices.ts`,
      then `BARS_FILE=… ` unset + `UNIVERSE=… deno run scripts/trd-wyckoff-evolve.ts` for a real verdict.
- [ ] Data-feed gate for TRUE CVD/OI: tick (Databento/Polygon/Rithmic) + futures OI — replaces the bar proxies.

## Deferred (Stage 2+ — needs the gates passed first; NOT now)
- `agent-trd-paper` (Alpaca paper executor, cost-haircut).
- `trd_manual_trades` capture UI + slippage fold-back (operator's MICRO phase).
- `agent-trd-risk-gate` (pre-trade Architect veto) + durable kill-switch enforcement.
- `agent-trd-reconcile` (broker-state reconciliation + cancel-on-disconnect) — HARD
  prerequisite before any auto order.
- Observability/alerting tier (heartbeat-miss / kill-switch-tripped push / staleness).

## Parallel (financier track — separate, in YGS/CC)
- YGS finance channel consuming the REJECTED list as honest content; funds R&D.

## FORWARD-WIRE bbfade_lo/bear — ✅ DONE (D-198): detector band-mode + SPY-bear regime gate + 8 legs registered + deployed; 0 fires in bull (correct)
- [ ] Extend `_shared/trd-forward-setup.ts` detectTrades: add optional band entry
      (`entry:"band"`, `bandLen:20`, `bandK:2` → fire long when close < lowerBB) alongside the RSI path;
      keep RSI default so existing candidates are untouched. Mirror the file into `trd-forward-tick/`.
- [ ] Add a REGIME gate: tick fn fetches SPY daily once, computes SPY<200MA per date, passes a
      `regimeOk(date)` predicate into detectTrades; bbfade_lo/bear only fires when SPY<200MA.
- [ ] Migration `0015_*`: insert one `trd_forward` row — candidate `bbfadelo-bear-1d`, symbol basket
      (register per-name or a representative liquid set), timeframe `1d`, direction `long`,
      setup `{entry:"band",bandLen:20,bandK:2,maLen:200,atrLen:14,stopAtr:2,tpMult:3,maxBars:20,dir:1,regime:"bear"}`,
      in_sample_evidence `{n:9142,edgeRough:0.091,tRough:5.73,bothHalves:true,ref:"D-197"}`.
- [ ] `deno check` + deploy `trd-forward-tick`; confirm bull-regime tick reports 0 fires (correct — dormant until SPY<200MA).
  NOTE: won't fire in the current bull regime — that is the POINT; registered_at starts the immutable forward
  clock now so the forward sample is legitimate when the bear regime arrives. Do as its own focused pass (touches the
  evidence ledger — must be right, not crammed).
