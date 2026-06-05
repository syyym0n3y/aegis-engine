# STATE — Trading Substrate (live state)

## Last updated
**2026-06-06 (Opus 4.8 [1m]) — workspace bootstrapped; honest-stats core built + tested; Stage-1 schema written.**

## Where we are
- New CC vertical, own repo `/Users/ona/Projects/trading-substrate`, own (not-yet-
  provisioned) Supabase project. D-070 locked. Target re-anchored to "prove a real
  positive edge net of costs, then scale only what's proven" (operator-confirmed).
- **Built + verified this session:**
  - Honest-stats core (`_shared/trd-stats.ts`): PSR / Deflated Sharpe / MinTRL /
    PBO-via-CSCV + Sharpe/Sortino/maxDD/Calmar + erf/normalCdf/invNorm. **20 unit
    tests green, `deno check` clean.**
  - Pessimistic cost model + point-in-time (look-ahead-fail-closed) modules + tests.
  - `0001_trd_substrate.sql` — 12 `trd_*` tables incl. `trd_manual_trades`
    (manual log), `trd_gate_thresholds` (decision-locked), price-revision
    bitemporality. Append-only triggers + RLS + seeded thresholds. **Written, not
    yet applied** (needs the project).
  - Governance: CLAUDE.md, DECISIONS.md (D-070 + adversarial addendum), LADDER.md,
    RISK_POLICY.md, docs/trd/STAGE1.md.
- Design hardened by an 8-agent research+adversarial workflow (`wf_720b2865-2f3`);
  both verify passes returned **sound-with-fixes**; all fixes folded into D-070.

## Next 3 moves (engineering, no money)
1. Operator provisions the Supabase project + applies `0001` → then build Stage-1
   ingestion fns (`agent-trd-ingest-congress` → `-edgar` → `-prices`).
2. `agent-trd-features` (point-in-time store) → `agent-trd-backtest` (the
   falsification engine, reusing `_shared/trd-stats`) → `agent-trd-architect-gate`.
3. CC oversight panel `cc-trd-report` with the visible REJECTED list + the CI
   self-test harness (overfit-must-be-rejected, look-ahead-must-be-empty).

## Blocked on operator (account / spend / legal / brand)
- Provision new Supabase project (own ref); apply `0001`.
- Alpaca **paper** account → Vault `cc_trd_alpaca_paper_*` (free, paper only).
- Sign off gate thresholds (D-070 seeds) or amend via a decision-ref row.
- Brand/name the vertical.
- (Later, real-money only) broker choice, R&D budget $ for MICRO/SMALL, IRS
  475(f) timing — flagged in D-070, not blocking Stage 1.

## Parallel track (the financier)
YGS finance channel (honest "we tried to copy Congress, here's why it fails, with
receipts" + the REJECTED list) — funds the R&D budget. Audience → trading, never
reverse. Not yet started; lives in the YGS/CC substrate, consumes
`trd_backtest_runs` as content input.
