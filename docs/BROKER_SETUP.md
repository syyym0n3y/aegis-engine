# BROKER_SETUP.md (D-957) — the operator runway to autonomous execution

The executor (`scripts/executor.ts`) is built, gated, and DORMANT. Between it and a
self-running book sit exactly the steps only the operator can legally perform. In order:

## 1. Open the account (operator only — Claude cannot create accounts or enter credentials)

**Recommended: Interactive Brokers UK** — the one venue that covers the deployed book:
- equities long + short (IVOL both legs, distress shorts) with **SLB borrow
  availability/cost data** — this also closes the ledger's pending IVOL-borrow
  instrument gate the moment we can read real borrow on the 33 short names;
- API access (Client Portal Web API / TWS);
- basket orders (the distress sleeve is a BREADTH edge, D-954 — 279 names needs a
  basket, not hand-fills).
Checklist when applying: margin account (not cash), API enabled in settings,
market data subscriptions minimal (we own our data), UK entity (COBS rules apply:
**no crypto derivatives for UK retail** — the cryptomom sleeve is SPOT-only, D-823f).

## 2. Creds + allowlist (operator acts; Claude may not edit the allowlist)

```bash
# after the account exists — IBKR Client Portal gateway runs LOCALLY (localhost:5000)
echo '^https?://localhost:5000/' >> ~/.claude/hooks/endpoints.allowlist
# if/when the Polymarket data vertical is worked (assay row 11 — research only, $0):
echo '^https?://gamma-api\.polymarket\.com/' >> ~/.claude/hooks/endpoints.allowlist
echo '^https?://clob\.polymarket\.com/' >> ~/.claude/hooks/endpoints.allowlist
```
Creds live in env (`IBKR_*`) sourced from a local untracked file — never committed,
never typed by Claude, never pasted into chat.

## 3. Then the adapter gets built and verified

Against the real gateway: one 1-share order, kill-switch honoured (trip it, prove the
order is refused), fill logged to `trd_manual_trades`, INTENDED vs FILL slippage
recorded. Only after that clean record does SUBMIT=1 mean anything — and the LADDER
still governs size: paper → MICRO (capped, fully-losable) → SMALL → SCALED, each rung
promoted only on its gate.

## The standing line (does not move)

No LLM in the order path, ever. The executor is deterministic; Claude edits its code
in git where every change is reviewable, and never holds the keys. Arming, funding,
and rung promotion are operator acts. "At all costs" stops at these because they are
why the account survives its first bad month.
