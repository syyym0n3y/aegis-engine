# CLAUDE.md — Aegis (CC trading vertical)

> **Governed by Command Centre.** This is a new CC vertical in its OWN repo + OWN
> Supabase project, deliberately blast-radius-isolated from YGS so a trading
> kill-switch bug can never touch the YouTube factory. CC keeps oversight +
> Architect veto. The global `~/.claude/CLAUDE.md` Hard Rules bind here in full
> (sequential cost-bearing calls, endpoint allowlist, cost confirmation,
> honest-advisor protocol).

## The one-paragraph thesis

This is **not a trading bot. It is a falsification engine that is allowed to
trade only after it has repeatedly tried and failed to disprove an edge.** The
only component with near-certain positive expected value is the risk gate. Every
signal (congressional, Form-4, 13F, SMC) is — on the peer-reviewed evidence —
crowded, lagged, or capacity-bound. The base rate is brutal (~97% of retail
lose; <1% beat fees over 15y). So the system's default verdict on any strategy
is REJECT, and **the most likely terminal state is "nothing cleared the gates" —
which is a SUCCESS of the engine, not a failure.** See [`DECISIONS.md`](./DECISIONS.md) D-070.

## Session-resume protocol — read in order

0. [`ANALYSIS_CONTRACT.md`](./ANALYSIS_CONTRACT.md) — **binds every analysis: report the measurement not
   the feeling; real over approximate; built over projected; consistent over convenient.** No bias by mood.
0b. [`OPERATING_DOCTRINE.md`](./OPERATING_DOCTRINE.md) — **research before you defer (never claim
   impossible/paid without a verified search); prove before you claim; scale the product not the promise;
   free-first, paid-on-ROI.** Proactivity + trust + growth/scale doctrine.
1. [`STATE.md`](./STATE.md) — current live state, what's built, what's blocked.
2. [`NEXT.md`](./NEXT.md) — the Stage-1 work queue.
3. [`DECISIONS.md`](./DECISIONS.md) — D-070 + append-only decision log.
4. [`LADDER.md`](./LADDER.md) — the staged-autonomy ladder + promotion gates.
5. [`RISK_POLICY.md`](./RISK_POLICY.md) — the enforced risk invariants.
6. [`docs/trd/STAGE1.md`](./docs/trd/STAGE1.md) — the Stage-1 build spec.

## Non-negotiable invariants (fail closed)

- **No real money before the gates.** Auto-execution is disabled below the SMALL
  rung. Stage 1 touches $0 and has no broker order path at all.
- **No LLM in the order path, ever.** Execution is deterministic rules + the
  risk gate only. LLMs may reason about strategy *specs*, never place orders.
- **Look-ahead is structurally impossible**, not a code-review hope — every
  feature carries the `effectiveDate` it was legally knowable (`trd_features`),
  and the backtest may only read via `asOf()`. The 45-day STOCK Act lag lives in
  that column and cannot be engineered away.
- **Every Sharpe is reported next to N** (its trial count). A Sharpe without its
  N is a lie. `trd_trial_counter` increments on EVERY backtest run, including
  failed/iterated ones.
- **Resolve on history FIRST; forward-testing is background confirmation, never
  the bottleneck.** Every lead is verdicted on ALL available history with
  walk-forward + trial-count deflation *now* — decades of bars and thousands of
  trades beat waiting months for a 30-trade forward counter (D-104: btc-sweep-rr3
  killed on 4,673 historical trades vs 2/30 forward). Forward data is the final
  signature on something history already cleared. Only genuinely history-poor
  signals (short-history weekly macro) legitimately wait on forward weeks.
- **Costs are pessimistic by default.** Paper P&L is never read as "has edge".
- **Gate thresholds are decision-locked.** Changing DSR>0.95 / PBO<0.5 / sample
  floors requires a NEW `trd_gate_thresholds` row naming a DECISIONS.md entry —
  a motivated operator must not be able to quietly loosen a gate to force a
  promotion.
- **Signals are single-operator and never published** (publishing specific
  buy/sell recs for value triggers Investment-Adviser registration).
- **Idempotency end-to-end + append-only evidence.** Re-runs are no-ops; the
  ledger is immutable. Broker creds live in Vault (`cc_trd_*`), NOT provisioned
  until staged gates pass.
- **Every edge decision updates `trd_lineage`** (the provenance ledger, D-272)
  alongside its DECISIONS.md entry — one row per lead with its hypothesis, test,
  key metric, verdict, status, and decision trail. `trd_lineage_roster` is the
  queryable current state; the whole development is auditable in SQL, not prose.
- **The kill-switch is durable state** (a Postgres row) that survives daemon
  restarts — a crash must never silently re-enable trading.

## Stack

- Supabase (Postgres + Deno edge fns + Auth + Vault/pgsodium) — its OWN project
  (ref TBD; operator provisions). Namespacing: tables `trd_*`, fns
  `agent-trd-*` / `cc-trd-*`, migrations `000N_*.sql`, vault `cc_trd_*`.
- Oversight/reporting UI lives in **Command Centre** (read-only, via a
  service-role bridge) — this repo is the engine; CC is the cockpit.
- `deno test supabase/functions/_shared/` — the honest-stats core (offline, no deps).
- `deno check supabase/functions/**/*.ts` — must pass before commit.

## What "done" means here (inherits global doctrine)

Works in its real environment; reproducible by the operator via a script/UI she
owns; doesn't break what worked; source committed with `deno check` passing;
STATE.md / DECISIONS.md updated. A strategy is NEVER "done/profitable" on a
backtest — only after it clears paper → micro → small with REAL samples and a
clean kill-switch record.
