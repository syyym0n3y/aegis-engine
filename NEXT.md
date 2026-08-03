# NEXT — work queue

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
