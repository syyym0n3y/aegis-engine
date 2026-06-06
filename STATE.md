# STATE — Aegis (live state)

## Last updated
**2026-06-06 (Opus 4.8 [1m]) — Aegis Stage-1 pipeline LIVE end-to-end on REAL data: SEC EDGAR Form-4 ingest → point-in-time features → falsification backtest → operator report, on local Postgres via Colima. 37 tests green. $0.**

## Where we are
- New CC vertical **Aegis**, own repo `/Users/ona/Projects/aegis`. D-070 locked.
  Target re-anchored to "prove a real positive edge net of costs, then scale only
  what's proven" (operator-confirmed).
- **Provisioning: $0 LOCAL-DEV — DB IS UP.** Docker wasn't installed → installed
  **Colima** (free FOSS runtime, `brew install colima docker`; analytics disabled
  in `config.toml` for the Colima docker.sock quirk). `supabase start` runs the
  local stack; **`0001` applied + VERIFIED on live Postgres** (12 tables;
  append-only UPDATE/DELETE both raise; idempotency dup→unique-violation,
  on-conflict→no-op; 4 gate thresholds seeded). **Nothing billed.** Cloud ($10/mo,
  always-on) still required before any real autonomy — local is laptop-only dev.
  Stop the stack with `supabase stop` + `colima stop` (a VM runs while up).
- **Built + verified this session (30 unit tests green, `deno check` clean, all offline, $0):**
  - Honest-stats core (`_shared/trd-stats.ts`): PSR / **Deflated Sharpe** / MinTRL /
    **PBO-via-CSCV** + Sharpe/Sortino/maxDD/Calmar + erf/normalCdf/invNorm.
  - **Backtest core (`_shared/trd-backtest-core.ts`):** OLS factor decomposition
    with per-coef **t-stats** (residual alpha must be statistically SIGNIFICANT,
    not just positive), expanding walk-forward, and the REJECT-by-default gate.
  - **Strategy interpreter + orchestrator (`_shared/trd-strategy.ts`):** declarative
    JSON specs (universe/signal/sizing), point-in-time decision loop (asOf INSIDE
    the loop), bar-N+1 fills, turnover cost, idempotent content-addressed runKey.
  - **Runtime self-test (`_shared/trd-selftest.ts`):** proves the engine still kills
    bad strategies (overfit→PBO, noise→reject, look-ahead→blocked, **congressional
    copycat→unmasked as sector beta & REJECTED**) — the eventual `agent-trd-backtest`
    refuses to run if it fails. **This IS the D-070 Stage-1 success metric, demonstrated.**
  - Pessimistic cost model + point-in-time (look-ahead-fail-closed) modules + tests.
  - `0001_trd_substrate.sql` — 12 `trd_*` tables incl. `trd_manual_trades`
    (manual log), `trd_gate_thresholds` (decision-locked), price-revision
    bitemporality. Append-only triggers + RLS + seeded thresholds. **Written, not
    yet applied** (needs local Docker or the cloud project).
  - Governance: CLAUDE.md, DECISIONS.md (D-070 + adversarial addendum), LADDER.md,
    RISK_POLICY.md, docs/trd/STAGE1.md. Committed (`8291225` + rebrand/backtest-core).
- Design hardened by an 8-agent research+adversarial workflow (`wf_720b2865-2f3`);
  both verify passes returned **sound-with-fixes**; all fixes folded into D-070.

## Stage-1 pipeline — DONE + verified on real data (operator-owned CLIs)
`./scripts/trd-ingest-edgar.ts [YYYYMMDD] [limit]` → `./scripts/trd-build-features.ts`
→ `./scripts/trd-backtest.ts` (self-test gate + persists verdict) → `./scripts/trd-report.ts`.
Proven: 28 real Form-4s → 18 PIT features → copycat REJECTED (r2=0.96, β=0.85,
residual-α t=−0.85). The honest engine, on live data, $0.

## Next moves
1. **Real prices** to run real-ticker backtests (not just the synthetic self-test):
   either the free **Alpaca paper** account → `agent-trd-ingest-prices`, OR authorize
   a free no-auth feed (e.g. Stooq) — operator's allowlist call. Until prices exist,
   backtests run on the self-test synthetic panel only.
2. **First real strategy spec**: an insider-cluster-buy strategy on the EDGAR
   features (needs prices) — run it through the gate; expect most variants REJECTED.
3. **Hosted path (cloud-time, deferred — NOT half-built):** thin `agent-trd-*` edge-fn
   wrappers + `cc-trd-report` CC panel + CI `runSelfTest()` ratchet. The CLIs already
   ARE the verified operator surface; edge fns only matter once the $10/mo cloud
   project exists (local can't host always-on). Congress ingestion deferred (House
   PTRs are messy PDFs; EDGAR/Form-4 is the cleaner + stronger signal anyway).

## Blocked on operator (free actions / config)
- ✅ ~~Start Docker~~ — Colima installed + local DB up + `0001` verified.
- ✅ ~~Allowlist the 4 legal data-source endpoints~~ — added (House/Senate/SEC/Alpaca).
- **Alpaca paper** account → creds for Vault `cc_trd_alpaca_paper_*` (free, paper only).
  Needed only for `agent-trd-ingest-prices`; congress + EDGAR ingestion don't need it.
- (Later) cloud project for always-on autonomy; broker/budget/475(f) for real money.
- Sign off / amend gate thresholds (D-070 seeds) via a decision-ref row (optional).
- (Later, real-money only) broker choice, R&D budget $ for MICRO/SMALL, IRS
  475(f) timing — flagged in D-070, not blocking Stage 1.

## Parallel track (the financier)
YGS finance channel (honest "we tried to copy Congress, here's why it fails, with
receipts" + the REJECTED list) — funds the R&D budget. Audience → trading, never
reverse. Not yet started; lives in the YGS/CC substrate, consumes
`trd_backtest_runs` as content input.
