# STATE — Aegis (live state)

## Last updated
**2026-06-06 (Opus 4.8 [1m]) — Aegis vertical bootstrapped; honest-stats core + falsification self-test built & verified; $0 local-dev path chosen.**

## Where we are
- New CC vertical **Aegis**, own repo `/Users/ona/Projects/aegis`. D-070 locked.
  Target re-anchored to "prove a real positive edge net of costs, then scale only
  what's proven" (operator-confirmed).
- **Provisioning: $0 LOCAL-DEV path chosen (operator).** No cloud Supabase project
  created (would be **$10/mo** in the operator's org — NOT free as I'd wrongly
  guessed). Stage 1 runs against local Supabase (`supabase start`) once Docker is
  running; the paid cloud project is deferred until there's a hosted/scheduled
  backtest worth $10/mo. **Nothing billed.**
- **Built + verified this session (25 unit tests green, `deno check` clean, all offline):**
  - Honest-stats core (`_shared/trd-stats.ts`): PSR / **Deflated Sharpe** / MinTRL /
    **PBO-via-CSCV** + Sharpe/Sortino/maxDD/Calmar + erf/normalCdf/invNorm.
  - **Falsification self-test (`_shared/trd-backtest-core.ts`):** OLS factor
    decomposition + walk-forward + the REJECT-by-default gate. Proven offline:
    noise → REJECTED; the congressional copycat → unmasked as sector beta
    (`residual_alpha <= 0`) → REJECTED; genuine factor-independent alpha → detected.
    **This is the D-070 Stage-1 success metric, demonstrated.**
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
1. Build the declarative strategy-spec interpreter that feeds price/feature panels
   into `trd-backtest-core` (still offline-testable with synthetic panels).
2. Local DB up (Docker → `supabase start` → apply `0001`) → wire `agent-trd-ingest-*`
   (congress → edgar → prices) once the data-source endpoints are allowlisted.
3. `agent-trd-features` (point-in-time store) → `agent-trd-backtest` (wraps
   `trd-backtest-core`) → `agent-trd-architect-gate` → `cc-trd-report` (REJECTED list).

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
