# STATE — Aegis (live state)

## Last updated
**2026-06-06 (Opus 4.8 [1m]) — Aegis offline Stage-1 BRAIN complete: stats + cost + PIT + factor-decomp + strategy interpreter + orchestrator + runtime self-test (30 tests green). $0 local-dev.**

## Where we are
- New CC vertical **Aegis**, own repo `/Users/ona/Projects/aegis`. D-070 locked.
  Target re-anchored to "prove a real positive edge net of costs, then scale only
  what's proven" (operator-confirmed).
- **Provisioning: $0 LOCAL-DEV path chosen (operator).** No cloud Supabase project
  created (would be **$10/mo** in the operator's org — NOT free as I'd wrongly
  guessed). Stage 1 runs against local Supabase (`supabase start`) once Docker is
  running; the paid cloud project is deferred until there's a hosted/scheduled
  backtest worth $10/mo. **Nothing billed.**
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

## Next 3 moves (engineering, no money)
The offline brain is DONE (interpreter + orchestrator + self-test). Everything
below needs the operator's free unblock actions (Docker / allowlist / Alpaca paper).
1. Local DB up (Docker → `supabase start` → apply `0001`) → wire `agent-trd-ingest-*`
   (congress → edgar → prices) once the data-source endpoints are allowlisted.
2. `agent-trd-features` (persist the point-in-time store) → `agent-trd-backtest`
   (thin edge-fn wrapper calling `runSelfTest()` then `backtest()`; writes
   `trd_backtest_runs` + increments `trd_trial_counter`) → `agent-trd-architect-gate`.
3. `cc-trd-report` CC oversight panel (the visible REJECTED list) + CI wiring of
   `runSelfTest()` as the deploy ratchet.

## Blocked on operator (free actions / config)
- **Start Docker** so `supabase start` can apply `0001` locally ($0).
- **Allowlist the 4 legal data-source endpoints** (I can't edit the allowlist):
  `disclosures-clerk.house.gov`, `efdsearch.senate.gov`, `www.sec.gov` (EDGAR),
  `data.alpaca.markets` / `paper-api.alpaca.markets`. Until then ingestion can't run.
- **Alpaca paper** account → creds for Vault `cc_trd_alpaca_paper_*` (free, paper only).
- Sign off / amend gate thresholds (D-070 seeds) via a decision-ref row (optional).
- (Later, real-money only) broker choice, R&D budget $ for MICRO/SMALL, IRS
  475(f) timing — flagged in D-070, not blocking Stage 1.

## Parallel track (the financier)
YGS finance channel (honest "we tried to copy Congress, here's why it fails, with
receipts" + the REJECTED list) — funds the R&D budget. Audience → trading, never
reverse. Not yet started; lives in the YGS/CC substrate, consumes
`trd_backtest_runs` as content input.
