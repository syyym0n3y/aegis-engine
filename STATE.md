# STATE.md — current live state

_Rewritten 2026-09-23 (D-970 audit: the previous version had stopped at 2026-09-13 with seven
competing "(LATEST)" sections; this file is now a single current page, and staleness relative
to DECISIONS.md is a named audit check)._

## The deployed candidate (DORMANT, $0, no broker path)

- **5-sleeve risk-parity blend** — trend, long, cryptomom, distress short (D-930/935/936),
  IVOL q20 concentrated (D-939/953; 33/leg, hand-fillable). Excess Sharpe **2.08 raw /
  ~1.92 leverageable (D-939e pin — all leverage math uses 1.92)**. De-gross squeeze overlay
  DEPLOYED (D-953b). Daily paper marks via `io.aegis.paper`; clock `fwd-distress-ivol-blend-5`.
- Execution layer built and gated (D-957): `deploy-sheet.ts TICKET=` → `executor.ts`
  (fresh-ticket / kill-switch / caps, all verified firing; SUBMIT structurally refused until
  the operator completes docs/BROKER_SETUP.md). Runbook: docs/DEPLOY_RUNBOOK.md.
- **Binding constraint: operator NI number → IBKR UK (API+SLB) + ISA.** Then: 1-share
  adapter verification, micro→small ladder, real fills into the (deliberately empty)
  micro/trade/wealth ledgers.

## Research state

- **FROZEN (D-823)** — sessions end only when a position/ledger/gate/clock moves; ceiling
  split mined 5.46 vs pre-registered ~2.9. **34 forward clocks**, all with live inputs and
  scorers; two showing early positive forward reads (utc09to10, utc16 families) — watch,
  never re-mine. London window closed BOTH directions (D-958 fade, D-960 corroboration
  t −17.6). Gamma: vol-damping validated in 3 regimes (D-967, pooled t −17.3), sizing gain
  measured (D-968: +6.7% OOS forecast), adoption pre-registered (`D-970-gex-sizing-calibration`);
  CROWD_DC adoption pre-registered with a 2026-10-07 deadline (`D-970-crowd-dc-adoption`).

## Infra

- Night-shift architecture (D-959): heavy daemons on 02:10–04:40 calendar at Background QoS
  (VM CPU measured 206%→18%). `boot-triage` absorbs host reboots. **Parked 2026-09-23
  (D-970, audit): autopilot, discovery, positioning** — mining inflated the ceiling under
  the freeze; positioning contradicted the deployed book. Running: daily, coverage, paper,
  cryptofwd, micro (hourly), ballast/assay up-daemons.
- Owned node: aegis-db :54329 + aegis-rest :33000; 32-guard board; `_notify.sh` escalation
  FIXED 2026-09-23 (cwd-relative path had broken it — audit gap #6).
- Verticals: **ballast** (:54330/:33010, wealth ledger — EMPTY, waiting on operator rows);
  **assay** (:54331/:33011, 18 claims, memecoin tests blocked on operator allowlist lines).
- Feeds accruing free/keyless: CBOE options surface + per-strike SPX (D-969), SqueezeMetrics,
  Blockchair bc_* (consumer question pre-registration pending), CoinGecko snapshot,
  estimate revisions, FRED/BLS. Databento credit ~$0–3 left; **free-first is binding**
  (D-967) — no purchases without fresh operator authorization AND a linked payment method.

## Operator front door

docs/OPERATOR_QUEUE.md (regenerated daily) + the 14-row bottleneck register in the
2026-09-23 ecosystem audit. Top of queue: NI→IBKR; ballast seeding (minutes); two allowlist
lines (binance.vision, Solana); TRACE credential.
