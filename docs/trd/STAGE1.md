# STAGE 1 — build spec (research/backtest only, $0, no broker order path)

Each step has a VERIFY. Stage 1 is done when the self-test (step 9) is green in
CI and the operator can see, on the CC reporting surface, that the engine kills
bad strategies.

| # | Deliverable | Verify |
|---|---|---|
| 1 | `supabase/migrations/0001_trd_substrate.sql` — all `trd_*` tables, append-only triggers, RLS, decision-locked thresholds seeded | `list_tables` shows all; INSERT-twice of a `source_id` is a no-op; UPDATE on an append-only table raises |
| 2 | `agent-trd-ingest-congress` — poll House Clerk + Senate eFD, parse PTRs → `trd_raw_filings` (trade_date AND disclosed_date), sequential + idempotent | re-run adds 0 rows; a known recent PTR shows the ~45-day lag |
| 3 | `agent-trd-ingest-edgar` — Form 3/4/5 + 13F-HR, **10 req/s + descriptive User-Agent**, → `trd_raw_filings` by accession_no | a known 3+-insider cluster-buy is detectable; no 403 |
| 4 | `agent-trd-ingest-prices` — free OHLCV from Alpaca paper creds (Vault `cc_trd_alpaca_paper_*`), delisting-inclusive, bitemporal `as_of` → `trd_price_bars` | a delisted ticker's bars are present (survivorship check) |
| 5 | `agent-trd-features` — derive the point-in-time store, stamping each feature's legally-knowable `effective_date` (congressional carries `disclosed_date`) | a query as-of D returns ONLY data disclosed ≤ D; a look-ahead query returns nothing (`asOf()` enforced) |
| 6 | `agent-trd-backtest` — walk-forward, bar-N+1 fills, mandatory cost model, delisting-inclusive; full honest stats panel (DSR/PBO/Sortino/maxDD/Calmar/turnover/capacity/hit+payoff/MinTRL/net), increments `trd_trial_counter` on EVERY run, decomposes edge into factor-zoo (mkt/size/value/mom/quality/**BAB**) + sector-beta vs SPY AND NANC | a random + a deliberately-overfit strategy are BOTH rejected; the congressional copycat's "outperformance" resolves to sector beta and is killed |
| 7 | `agent-trd-architect-gate` — deterministic stats veto: DSR>0.95 AND PBO<0.5 AND walk-forward-OOS AND net-of-cost-positive AND MinTRL satisfied; default REJECT; writes `trd_ladder_state` | feeding step-6's killed strategies returns REJECT with the failing metric named |
| 8 | CC oversight panel `cc-trd-report` (read-only, service-role bridge) — per-strategy full panel with every Sharpe next to its N, the factor decomposition, the trial count, and a prominent **REJECTED list** | operator sees on the live CC app that most candidates were killed and WHY |
| 9 | CI self-test harness — injected overfit MUST be rejected; a look-ahead feature query MUST return empty; a duplicate filing INSERT MUST be a no-op; the `_shared` stats/cost/PIT unit tests | CI red if any invariant regresses (fix-the-instance-then-enforce-the-class) |
| 10 | `D-070` in DECISIONS.md + STATE.md updated | done; NO real money, NO broker order path, NO Vault live creds in Stage 1 |

## Already built (this session)
- ✅ Step 1 SQL written (not yet applied — needs the Supabase project).
- ✅ `_shared/trd-stats.ts` — erf/normalCdf/invNorm, moments, Sharpe/Sortino/
  maxDD/Calmar, **PSR / Deflated Sharpe / MinTRL / PBO-via-CSCV**. 20 unit tests green.
- ✅ `_shared/trd-cost-model.ts` — pessimistic-by-default round-trip costs + haircut.
- ✅ `_shared/trd-point-in-time.ts` — `asOf()` / fail-closed `assertHasEffectiveDate`
  / `lookaheadViolations` / `disclosureLagDays`.
- ✅ Tests offline (no jsr/std fetch); `deno test` + `deno check` green.

## Blocked on operator (can't do — account/spend/legal)
- Provision the new Supabase project (own ref) + apply `0001`.
- Create Alpaca **paper** account → put creds in Vault `cc_trd_alpaca_paper_*`
  (free, no money — paper only for Stage 1).
- Sign off the gate thresholds (D-070 seeds: DSR>0.95, PBO<0.5, floors 30/50/100).
- ~~Brand/name for the vertical~~ → **Aegis** (chosen 2026-06-06).

## Explicitly OUT of Stage 1
The risk gate, paper executor, broker reconciliation, and any execution path.
Stage 1 proves the engine kills bad strategies. Nothing trades.
