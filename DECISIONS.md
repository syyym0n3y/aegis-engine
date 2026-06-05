# DECISIONS — append-only architectural decision log (Trading Substrate)

> New decisions at the top. Never edit a past entry; supersede with a new one.

---

## D-070 — Trading substrate: a FALSIFICATION ENGINE governed by CC, where autonomy + capital are EARNED out-of-sample; congressional/Form-4 are ONE legal feature, not the thesis

**Date:** 2026-06-06

**Context:** Operator wants to "make money autonomously in my sleep" with a
per-session max-loss guardrail, live buy/sell signals, congressional-portfolio
tracking as a legal leading signal, and a start of small MANUAL trades on
low-volatility regimes to document the real success rate. The uncomfortable
truth, led with: the congressional copycat trade is mostly priced out — the two
ETFs built to do exactly this (NANC, KRUZ) do NOT beat the market risk-adjusted
(Economics Letters 250, 2025), and NANC's headline lead is a tech-sector
overweight you could replicate with QQQ. The 45-day STOCK Act lag is not a
tunable parameter, it is the entire problem: the abnormal returns happen in the
days right after the politician trades, and you legally cannot see the trade
until weeks later — you are structurally buying the echo. Enforcement is a
routinely-waived $200 fine (zero prosecutions ever), so the real lag is often
worse than 45 days. Form-4 cluster-buys are a better legal signal but live in
microcaps you cannot deploy size into. Options-flow/short-squeeze signals are
closer to astrology than alpha for an autonomous retail system. The base rate is
brutal: ~97% of retail traders lose, <1% beat fees over 15 years; realistic
ceiling is Sharpe 0.5–1.0 before costs, collapsing toward zero after. Medallion's
~Sharpe-2 is closed and unattainable. A backtester that never kills a strategy is
lying.

**Decision:** Build the trading vertical as a FALSIFICATION ENGINE on the CC
substrate (Supabase + Deno edge fns + 3-tier + Architect-veto + Vault), in its
OWN repo + OWN Supabase project for blast-radius isolation (operator's call,
overriding the design's same-repo recommendation), NOT a trading bot.
1. **A STAGED-AUTONOMY LADDER** — RESEARCH → PAPER → MICRO (manual) → SMALL
   (first auto) → SCALED — where each rung is unlocked only by out-of-sample
   proof (≥30/50/100 trades, DSR>0.95, PBO<0.5, net-of-cost-positive, MinTRL);
   live/auto execution is the LAST stage, never the first; failing a gate
   auto-demotes.
2. **An HONEST backtest engine** — point-in-time bitemporal features (look-ahead
   structurally impossible), walk-forward, delisting-inclusive universe,
   bar-N+1 fills, mandatory pessimistic cost model, Deflated Sharpe penalized by
   a substrate-level trial counter, every Sharpe printed next to N, edge
   decomposed into (sector-beta | size | residual-alpha) vs SPY AND NANC — so it
   readily KILLS strategies without edge.
3. **Congressional + Form-4 + 13F are ONE legal feature family among many**, used
   in Stage 1 as a low-volatility CALIBRATION dataset, never the profit engine;
   options-flow/short-interest demoted to no-trade-without-OOS-proof.
4. **The risk policy is ENFORCED invariants:** a deterministic pre-trade
   Architect veto (fixed-fractional 0.5%, quarter-Kelly ceiling, correlation/
   exposure caps, vol-targeted sizing) + a 2% daily-loss circuit breaker
   (flatten+cancel+lock) as a durable object surviving restarts — fail-closed,
   mirroring how CC enforces classes via CI ratchets/DB triggers.

STAGE 1 touches NO real money: legal free ingestion (House Clerk + Senate eFD +
SEC EDGAR + Alpaca paper data), the point-in-time feature/price store, the
falsification backtest engine, the stats/reporting surface with a visible
REJECTED list. The risk-gate fn is the FIRST thing dogfooded through the 7-agent
factory.

**Alternatives ruled out:** (a) make the congressional signal the profit engine —
refused, the literature already killed it and the lag is unrecoverable; (b) trade
options-flow/short-squeeze "unusual activity" — refused, folklore without OOS
proof; (c) autonomous execution early ("money in my sleep" now) — refused,
manual-first must win until paper+micro+small clear with real samples; (d) a
from-scratch stack — refused, reuse the CC substrate; (e) buy paid alpha/options
vendors as a moat — refused, they resell the same public filings, the moat is the
synthesis+honesty layer; (f) trust paper P&L as proof of edge — refused,
micro-live real money is a mandatory rung; (g) fund trading from operating cash —
refused, it's speculative R&D from a capped, fully-losable budget; cross-subsidy
only audience→trading, never reverse.

**Framework lens:** Thiel/Karp (the durable monopoly is the lag-aware, cost-net,
self-killing synthesis substrate) + Architect hard-veto (default-REJECT on stats
AND a fail-closed pre-trade risk gate) + 3-tier autonomy (Strategist proposes,
Architect vetoes, Orchestrator dispatches, workers execute; no LLM in the order
path) + Musk (question residual-alpha-after-costs → delete losers → simplify to
declarative specs → automate LAST) + $B mitigations (idempotency end-to-end,
append-only evidence, durable kill-switch, vault-gated live creds) +
honest-advisor (led with the uncomfortable base rate, refused to overstate
returns).

**Success metric:** Stage 1 — the substrate correctly KILLS a deliberately-overfit
strategy and shows the congressional copycat's apparent edge is sector beta not
residual alpha, on the live CC reporting surface, with the REJECTED list visible;
a look-ahead feature query returns empty; duplicate ingestion is a no-op; ZERO
real money touched. Whole-system — no strategy ever reaches auto-execution without
clearing paper+micro+small with real samples + a clean kill-switch record; the
operator can document the real, post-cost manual success rate; most candidates
are correctly rejected.

### Adversarial-hardening addendum (verify-phase fixes folded in)

The design workflow's skeptic + completeness critic returned **sound-with-fixes**.
The following are now first-class, not someday-forks:
- **Manual-trade logging in STAGE 1** (`trd_manual_trades`) — the operator's
  stated entry point; needs no broker; produces the real post-cost hit rate that
  calibrates the cost model. Was missing from the original Stage-1 plan.
- **Project-level kill criterion** (`trd_gate_thresholds.project_kill`) — after
  N strategy-families / M compute-hours with zero promotions past PAPER, the
  honest conclusion is "no accessible edge; shelve the vertical." The engine
  kills strategies; this kills the project. `null_result_is_success=true`.
- **Decision-locked gate thresholds** — changing DSR/PBO/floors requires a new
  `trd_gate_thresholds` row naming a DECISIONS entry. No quiet loosening.
- **Price-revision bitemporality** — `trd_price_bars` stores `as_of` versions, so
  split/dividend re-adjustments don't retroactively leak into a backtest.
- **DSR benchmark must be > 0** (SPY's Sharpe, not 0); sample floors are
  UNDER-POWERED for DSR/PBO, so promotion also requires MinTRL *satisfied* and
  the honest framing that real money is far away.
- **Factor zoo in the decomposition** — residual-alpha must be net of market,
  size, value, momentum, quality, AND low-vol (BAB), or "low-vol-first"
  manufactures fake alpha by construction.
- **Signal-exfiltration invariant** — `trd_signals.single_operator` + service-role-
  only; no browser read path (IA-registration boundary).
- **Pre-SMALL execution hard requirements (logged for Stage 2+):** broker-state
  reconciliation loop (`agent-trd-reconcile`) + cancel-on-disconnect +
  deterministic `client_order_id` (broker-side dedup); mark-to-market (unrealized)
  kill-switch path on a timer, not only fill-driven; position-level catastrophe
  cap via bracket orders (gap/halt risk); stressed-correlation assumption in the
  exposure cap; an observability/alerting tier (heartbeat-miss, kill-switch-tripped
  push, data-staleness) — "wake me when it breaks" is the precondition for "run
  while I sleep"; fund the live broker account ONLY with the losable amount so the
  broker balance is the final backstop.
- **YGS finance-channel financier link** — the REJECTED list + "we tried to copy
  Congress, here's why it fails, with receipts" becomes honest, differentiated
  finance content for a YGS channel that FUNDS the R&D budget. Cross-vertical
  synthesis (the Thiel/Karp moat). Tracked as the parallel financier track.

### Re-anchored target (operator-confirmed, 2026-06-06)

The original ask ("$1–2k/day from $20–50 trades, 4 trades/day, multiply accounts
to $1M/mo") implies a 500–2,500% return per trade — only reachable via account-
destroying leverage, and unscalable because EV scales linearly (negative edge ×
N accounts = N× the loss). **Operator agreed to re-anchor the target to "prove a
real positive edge net of costs, then scale only what's proven."** No daily-dollar
quota (quotas force overtrading). Test capital: **$20–50/week, fully losable**;
daily-loss kill-switch ≈ one session's contribution.
