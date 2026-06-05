# Trading Substrate

> Working name — brand TBD. A new **Command Centre** vertical (own repo, own
> Supabase project) for legal, evidence-based trading research.

**This is not a trading bot. It is a falsification engine that is allowed to
trade only after it has repeatedly tried and failed to disprove an edge.**

The only component with near-certain positive expected value is the risk gate.
Every signal (congressional disclosures, SEC Form 4, 13F, "smart money concepts")
is — on the peer-reviewed evidence — crowded, lagged, or capacity-bound, and the
retail base rate is brutal. So the engine's default verdict is **REJECT**, and the
most likely outcome is "nothing cleared the gates" — which is a success, not a
failure: it means the system saved your capital from a negative-EV slot machine.

Read [`CLAUDE.md`](./CLAUDE.md) → [`DECISIONS.md`](./DECISIONS.md) (D-070) →
[`LADDER.md`](./LADDER.md) → [`RISK_POLICY.md`](./RISK_POLICY.md) →
[`docs/trd/STAGE1.md`](./docs/trd/STAGE1.md).

## Status: Stage 1 (research/backtest only — $0, no broker order path)

Built + verified:
- `supabase/functions/_shared/trd-stats.ts` — Probabilistic & **Deflated Sharpe**,
  **MinTRL**, **PBO via CSCV**, Sharpe/Sortino/maxDD/Calmar, normal-dist primitives.
- `supabase/functions/_shared/trd-cost-model.ts` — pessimistic round-trip costs.
- `supabase/functions/_shared/trd-point-in-time.ts` — fail-closed look-ahead guard.
- `supabase/migrations/0001_trd_substrate.sql` — the `trd_*` schema.

## Dev

```bash
deno test  supabase/functions/_shared/      # 20 tests, offline, no deps
deno check supabase/functions/**/*.ts       # must pass before commit
```

## Hard invariants

No real money before the gates · no LLM in the order path · look-ahead is
structurally impossible · every Sharpe reported next to N · costs pessimistic by
default · gate thresholds decision-locked · signals single-operator & never
published · idempotent + append-only evidence · durable kill-switch.
