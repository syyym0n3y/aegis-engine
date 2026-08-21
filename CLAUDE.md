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
- **A null is only a market finding if the data could have detected it** (COVERAGE LAW is an invariant):
  before writing any null, verify the required input is actually loaded; if not the verdict is UNTESTED. Enforced by
  `scripts/coverage-guard.ts`, which exits RED on inadequate coverage.
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


## THE COVERAGE LAW (2026-08-21) — binds every conclusion
**A null result is evidence about the MARKET only if the data was adequate to detect the effect; otherwise it is evidence
about our DATA.** Absence of data is not evidence of absence.
Origin: Aegis reported program-level "no edge" conclusions while holding 5 of hundreds of available EDGAR concepts — accruals,
cash-flow-to-price, gross profitability and NOA were never tested because their inputs were never fetched, and that absence
was narrated as a market property. Inverted burden of proof; nearly closed the program on a false premise.
Rules: (1) no null verdict without a coverage statement (instruments, observations, span, required inputs); (2) check whether
the INPUT exists before blaming the market — if it does not, the verdict is **UNTESTED**, not NULL; (3) underpowered is its
own verdict, with the n required stated; (4) an unfetched free dataset is a RESEARCH failure, not a market finding;
(5) enforced by `scripts/coverage-guard.ts` (exits RED on inadequate coverage — verified to fail, not just to pass).


## THE LIQUIDITY LAW (2026-08-21) — binds every promotion
**A cross-sectional result is a claim about a TRADABLE strategy only if the edge survives in the LIQUID tercile. Otherwise it
is a claim about names that cannot absorb size.**
Origin: two independent panels reached it by different routes — D-419 (price/volume, 367 months) and D-423 (fundamentals,
103 months). Headline returns of 11-19%/yr decomposed into liq:LOW 20-40%/yr and **liq:HIGH 0.9-5.7%/yr (SR 0.04-0.26)** —
i.e. nothing where size can actually go. Every strong cross-sectional number this program has produced has had this shape.
Rules: (1) no strategy number is reported without its liquidity decomposition; (2) the promotable number is the LIQUID
tercile's, never the pooled one; (3) a headline whose edge vanishes above the liquidity floor is recorded as CAPACITY-BOUND,
not as an edge; (4) enforced by `scripts/liquidity-guard.ts` — no lineage row may sit in a promoted state without a recorded
liquid-tercile Sharpe clearing the floor (verified RED on a below-floor row, RED on a row that never states one, PASS on a
compliant row, and exit-code-checked in both directions).


## THE EFFECT-SIZE LAW (2026-08-21) — binds every "we found something"
**A significance test answers "is it there". Only effect size measured in MULTIPLES OF THE ROUND-TRIP COST answers "is it
worth acting on". No signal is reported as an edge without that number.**
Origin: D-426, perp order flow — the most statistically convincing result this program has produced. Residual aggressor
imbalance had rank IC negative on **20 of 20 instruments** (P ~ 2e-6 under the null), |t| to 4.9, holding out-of-sample, on
BTCUSDT clearing **$523M per hour** — capacity was emphatically not the constraint. Effect size: **0.02x-0.14x the maker
round-trip fee.** The same data gives OLS |t| < 1.3, because in fat-tailed hourly returns a RANK statistic orders the 99%
of small moves that carry no money while the money sits in a tail where the relationship is absent.
Rules: (1) every reported signal states bp-of-expected-return per 1sd of signal, beside the round-trip cost it must beat;
(2) **rank IC on fat-tailed high-frequency data is NOT evidence of tradability** — pair it with an OLS/mean effect, and if
the two disagree, the mean one decides; (3) an effect below 1.0x its cost is recorded as SUB-FEE, never as an edge;
(4) enforced by `scripts/effect-size-guard.ts` (verified RED on sub-fee, RED on significance-without-magnitude, PASS on
compliant, exit-code-checked both directions).


## THE BREADTH LAW (2026-08-22) — binds every cross-sectional result
**A cross-sectional statistic computed on a thin universe is a statement about a few names, not about a factor. Report
breadth beside every cross-sectional Sharpe; treat any cross-section under ~50 names as UNTESTED, not as evidence.**
Origin: three separate concentration artifacts. D-415 — funding crowding, IC 0.1404 at t 38.35, a POOLING artifact across
180 heterogeneous perps, retracted in full. D-423 — score-weighted construction showing 72.1%/yr at SR 1.49 from ~160 names
normalised to gross 2, flagged as concentration rather than alpha. D-443 — crypto momentum at 94.2%/yr, SR 1.13, alpha
t 2.93, computed on **fourteen** perps, where quintiles mean 3 long and 3 short; at 162-name breadth the identical rule
gives **SR 0.34, t 0.86**. In all three the t-stat was large and the number was not real.
Rules: (1) every cross-sectional result states the mean number of names per rebalance; (2) under ~50 names the verdict is
UNTESTED; (3) when a result is large, EXPAND BREADTH before believing it — that test is cheaper than the retraction;
(4) survivorship and breadth are different problems and must be fixed separately (in D-443 the survivorship effect was
small and POSITIVE at +5.2pp while breadth accounted for the entire collapse); (5) enforced by `scripts/breadth-guard.ts`
(verified RED on a thin cross-section, RED on one that never states breadth, PASS on a broad one, exit-code-checked).
