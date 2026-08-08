# PRODUCT SPEC — Verify · Protect · Allocate (the Aegis edge, productised)

> **Built 2026-08-03**, on the evidence of ~15,000 backtests + a free global factor
> validation (D-071 → D-077). Engine modules shipped & tested (85/85 green):
> [`trd-verify.ts`](../../supabase/functions/_shared/trd-verify.ts),
> [`trd-protect.ts`](../../supabase/functions/_shared/trd-protect.ts),
> [`trd-allocate.ts`](../../supabase/functions/_shared/trd-allocate.ts).

## The one-line thesis (why this can win)

**We do not sell an edge in the market — no such edge survives honest testing for
retail (proven). We sell the _truth about edges_ + the _risk discipline to survive_ +
the _disciplined harvest of real risk premia_.** Our advantage over day-traders (regular
*and* experienced) is **epistemic and structural, not predictive**: we know what's real
and they don't, and we can prove it with a rigor no retail tool offers. That is an
un-copyable moat because it's built on being *honest* in a market that sells lies.

---

## The three layers

### LAYER 1 — VERIFY (the wedge)
**"Is this edge real, or overfit/lucky noise?"** — for any strategy, EA, signal service,
or a trader's own track record.
- **Engine:** `verifyTrackRecord()` → Deflated Sharpe (deflated by the multiple-testing
  surface), PSR, MinTRL, an `authenticityScore` (0–100), a `verdict`
  (LIKELY REAL / UNPROVEN / LIKELY OVERFIT-LUCK), flags, and a plain-English report.
  `selectionOverfitProbability()` (PBO) scores whether a trader's *selection* of "their
  best system" is itself overfit. Hard sample floor (n≥100) so a lucky streak can never
  read as "proven" — the exact trap that fools retail.
- **Why it's defensible:** it's the same honest-stats core that killed 15,000 of our own
  backtests. It tells people the thing every vendor hides.
- **API surface:** `POST /verify { returns[], periodsPerYear, claimedTrials? } → VerifyReport`.
  Batch/matrix mode for a portfolio of candidates → PBO.

### LAYER 2 — PROTECT (the trust engine / mass funnel)
**The risk X-ray** — make the invisible risk a trader is *already* taking visible.
- **Engine:** `riskXray()` → expectancy (the sign that decides everything), Kelly &
  half-Kelly, **overbet ratio**, Monte-Carlo **probability of ruin** and of a 30% drawdown
  over a year, **liquidation distance** at their leverage, true annual cost drag, and a
  verdict (SURVIVABLE / FRAGILE / RUIN-LIKELY) with a plain-English "here's how you blow
  up, here's the size that survives."
- **Why it's defensible + safe:** it does *arithmetic on the trader's own numbers*, never
  a market prediction or a buy/sell call — it stays clear of the investment-advice line
  while delivering the one thing the whole session validated as durably +EV: **risk
  reduction turns a −75%/yr crash into −2%.**
- **API surface:** `POST /protect { equity, riskPerTradeFrac, winRate, winLossRatio,
  leverage?, costPerTradeBps? } → RiskReport`.

### LAYER 3 — ALLOCATE (the harvest)
**The disciplined global multi-factor book** that harvests the risk premia validated in
D-077 (value/quality/momentum × US/intl/EM) — the *other side* of retail's
momentum-chasing and panic-selling.
- **Engine:** `buildFactorBook()` → inverse-vol (risk-parity-lite) blend of factor / 
  factor-ETF return streams, vol-targeted, with weights, correlation matrix, realized
  Sharpe/drawdown, and an honest "expect multi-year droughts" note.
- **Why it's defensible:** it's what AQR/DFA run, deployable via cheap factor ETFs
  (VLUE/QUAL/MTUM/AVUV + international/EM equivalents) — low turnover, no shorting, no
  paid data (free FF/EDGAR pipeline already built).
- **Regulatory:** run as *own capital* first; productise as licensed advice/fund later.

---

## TAM alignment — each layer serves multiple segments; together they compound

| Segment (TAM) | VERIFY | PROTECT | ALLOCATE | Wedge / model |
|---|---|---|---|---|
| **Prop firms** ⭐ (thousands of firms, millions of challenge-takers) | Score every funded-trader applicant: real edge vs luck (DSR/PBO) | Live risk-of-ruin monitoring of funded traders | — | **B2B SaaS, highest ARPU, no IA licence needed.** The flagship. |
| **Serious / experienced traders** (high-intent slice of ~100M accounts) | Validate *their own* track record; kill their illusions | Optimal sizing (half-Kelly), ruin odds | optional side-book | Prosumer subscription. Expands TAM beyond "the 97% who lose." |
| **Regular / retail** (the global long tail) | "Is this EA/signal you're about to buy real?" | The Risk X-Ray (free tier) — harm reduction | — | **Freemium + grant/charity (D-073)** → mass trust, feeds the funnel. |
| **Brokers / fintechs / regulators** (few buyers, enterprise) | White-label VERIFY; scam-signal detection | White-label PROTECT (pre-trade risk) | — | B2B licensing, highest deal size, pure tools. |
| **Self / RIA / wealth** ($1T+ AUM, crowded/regulated) | — | — | The global factor book | Personal capital first; licensed later. Deprioritise. |
| **Creator / education** (finance creator economy) | "We ran 14,000 backtests — the truth about edges" | "Here's how much risk you're really taking" | "Boring, real, diversified" | **The funnel + moat = trust.** Funds everything. |

**The compounding:** VERIFY earns *credibility* (we're the ones who tell the truth) →
PROTECT converts that trust into *daily-use utility* (and mass reach via freemium) →
ALLOCATE monetises the *graduates* (traders we've convinced to stop gambling) → the
education layer feeds all three and is uncopyable because the moat is honesty.

---

## Go-to-market sequence

1. **VERIFY-as-a-service → prop firms + serious traders.** The wedge: highest willingness
   to pay, no licensing wall, directly monetises the engine we already built.
2. **PROTECT (Risk X-Ray) freemium + honest education funnel.** Mass trust, harm-reduction
   framing, feeds VERIFY. Charity/grant-funded to avoid the "profit from addicts" trap.
3. **ALLOCATE as own capital**, proven live, productised/licensed only later.

## Non-negotiable guardrails (inherited invariants + D-073)

- **No published buy/sell signals, no "take profit" calls, no accuracy/performance
  claims.** Accuracy is promised ONLY on the knowable facts (risk / cost / ruin /
  a signal's *realised historical* hit-rate). This is what keeps us the honest party and
  clear of Investment-Adviser registration.
- **No managing other people's money without licences** — ALLOCATE is own-capital first.
- **The product's promise is "stop the bleeding," never "beat the market."** Every layer
  reduces the customer's loss or reveals their truth; none sells a forecast. That is both
  the ethical line and the durable business.

## What's built vs next

- **Built + tested (this session):** all three engines (`trd-verify` / `trd-protect` /
  `trd-allocate`), 85/85 green; the free data pipelines (Fama-French, EDGAR, Yahoo,
  Alpaca) feeding them.
- **Next:** thin API edge functions wrapping the three engines + a report UI in Command
  Centre; the combined-global-factor-book backtest for ALLOCATE; a prop-firm pilot spec.
