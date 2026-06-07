# STATE — Aegis (live state)

## Last updated
**2026-06-07 (Opus 4.8 [1m]) — D-072 SECOND POND PASS: ~16/16 securities strategies rejected; the real edge is the operator's OWN creator business (Pond H), not a trade. Barbell direction: Ireland-UCITS index core (US-situs estate-tax trap is LETHAL for a SA national) + ISA/SIPP tax wrapper (highest-certainty edge) + tiny finite UK-trust-discount tilt + BUILD the creator substrate (unmonetized on the visa; Graduate Route before 31 Dec 2026, then monetize). Aegis pivots: alpha-finder → folklore-falsifier + core-protector. (D-071: first pass, 3/3 real-data kills incl. 18yr trend.) 42 tests, $0.**

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
The insider cluster-buy backtest is BUILT + executes (`./scripts/trd-insider-backtest.ts`)
but reports INSUFFICIENT DATA — it needs two inputs:
1. **Real prices (OPERATOR, 2 min):** Stooq is dead (JS anti-bot). Create a free
   Alpaca PAPER account (no money) → `APCA_API_KEY_ID/SECRET` → `./scripts/trd-ingest-prices.ts`.
   (Or authorize a different free feed — Yahoo chart API — for the allowlist.)
2. **Buy-event backfill (CLAUDE, free/slow):** our 1-day EDGAR sample had 0
   open-market buys (they're rare). Run `./scripts/trd-ingest-edgar.ts` over ~10-15
   recent days to surface real cluster-buys → rebuild features → real signal.
3. Then: run `trd-insider-backtest` → real verdict (expect REJECTED — small n / no
   significant edge — the honest likely outcome).
4. **Hosted path (cloud-time, deferred — NOT half-built):** thin `agent-trd-*` edge-fn
   wrappers + `cc-trd-report` CC panel + CI `runSelfTest()` ratchet — only matter once
   the $10/mo cloud project exists. Congress ingestion deferred (House PTRs are messy
   PDFs; EDGAR/Form-4 is the cleaner + stronger signal).

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
