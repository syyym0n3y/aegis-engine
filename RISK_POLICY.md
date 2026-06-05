# RISK_POLICY — enforced invariants, not a report

> Encoded as a deterministic, fail-closed pre-trade check (`agent-trd-risk-gate`,
> Stage 3+) + a durable kill-switch (`trd_kill_switch`). Constants live in
> `trd_gate_thresholds.risk_policy` (decision-locked, D-070). If the gate cannot
> compute remaining budget, it VETOES. No order — manual or auto — bypasses it.

## The numbers (solved simultaneously — adversarial-pass fix)

The original sketch was internally inconsistent (2% daily kill vs 5–10 trades ×
0.5% = up to 5% at risk). Resolved so the kill-switch is **reachable but not
chronic**:

| Constant | Value | Why |
|---|---|---|
| Per-trade risk | **0.5%** of equity (hard cap 1%) | fixed-fractional, vol-normalized; never fixed-dollar |
| Max **concurrent** open risk | **1.5%** | so the 2% daily kill is reachable but doesn't fire on a normal day |
| Daily-loss kill-switch | **2%** (realized) | flatten + cancel + lock to next session |
| Weekly trailing kill | **6%** | ratchets up on EoD equity, locks at start balance (Topstep MLL); breach ⇒ Architect veto + account lock |
| Max trades/day | **8** | overtrading guard |
| Max concurrent positions | **5** | + correlated-names (>0.6) share ONE budget |
| Kelly | **quarter-Kelly ceiling** | Kelly inputs come from a likely-overfit backtest ⇒ fractional is the safety margin |

## Sizing
`size = risk$ / (ATR_multiple × ATR)`, then `position = min(fixed_fractional,
quarter_kelly)`. Vol-targeted: size falls as realized vol rises, and auto-
deleverages as equity falls.

## Kill-switch (durable, two paths)
- **Realized path:** intraday realized loss ≥ 2% ⇒ trip.
- **Mark-driven path (adversarial-pass fix):** unrealized mark-to-market loss
  checked on a timer, so a single overnight gap can't blow past 2% before any
  fill triggers it.
- On trip: FLATTEN all + CANCEL all open orders + LOCK until next session.
- State is a Postgres row surviving daemon restarts — a crash must NOT re-enable
  trading. (Stage 3+ also requires a broker-state reconciliation loop before the
  flatten can be trusted: verify broker truth vs DB, halt on mismatch.)

## Exposure / correlation
- Cap net exposure to the **congressional-disclosure basket** and to any single
  sector — STOCK Act disclosures cluster in a handful of mega-cap/tech names, so
  "one position per disclosure" silently stacks correlated risk.
- Correlation > ~0.6 ⇒ names share one risk budget (five "0.5% independent"
  long-tech bets = one 2.5% bet).
- Use a **stressed** correlation assumption (correlations converge toward 1 in a
  selloff), not the calm-period matrix.

## Low-volatility-first, with the honest caveat
Train/validate on low-vol, liquid instruments first (operator's plan; the low-vol
anomaly has a real factor basis). BUT a calm-market model degrades in regime
shifts, and a low-vol-trained correlation matrix UNDERSTATES crisis correlation.
Vol-targeted sizing + the daily kill-switch are the non-negotiable backstops that
bridge calm→storm. Promotion past SMALL requires samples spanning ≥1 adverse
regime.

## Leverage
Hard-cap leverage AND per-session loss **in code**, regardless of what the broker
permits. (The 2026 PDT elimination / dynamic intraday margin hands retail MORE
rope — treat that as a hazard, not a feature.)

## Evidence / reversibility ($B mitigation)
Every pre-trade decision (sized/vetoed/scaled) and every fill writes to
`trd_risk_ledger` append-only with an idempotency key + per-lot basis + holding
period (wash-sale / 475(f)). Every sizing decision is reproducible from the
ledger. Broker creds in Vault (`cc_trd_*`), not provisioned until gates pass.

## Capital
Fully-losable R&D budget only ($20–50/week test phase), **never operating cash**.
Fund the live broker account with ONLY the losable amount so the broker balance
is the final backstop a software bug can't exceed.
