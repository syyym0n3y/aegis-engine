# PROJECT PLAN — The Risk X-Ray (working name)

> **A harm-reduction layer for retail traders who will trade regardless.** It does not
> give signals, entries, or "passive income." It makes the *invisible risk they are
> already taking* visible, visceral, and personal — at the moment they're taking it —
> so they can choose differently. Charity-owned R&D; Innovator-Founder monetisation path.
> Built on the Aegis substrate. Default posture: honest, REJECT-by-default, no order path.

---

## The one truth that determines success

**Computing risk is trivial. Making people act on it is the entire game.** [Likely —
behavioural-finance evidence] The traders who most need the warning are the most prone to
ignore it (overconfidence, loss-chasing, disposition effect, gambling cognition). Every
design decision is therefore judged by a single question: *does this change what the user
does next?* — not "is it accurate," not "is it engaging." A risk tool optimised for
engagement becomes a trading-engagement product, which means *more* trading and *more*
harm. **The success metric is reduced harm (lower leverage, fewer blow-ups, smaller
drawdowns), never time-on-app or trade count.** This is also the exact evidence the
Innovator Founder endorsing body needs to see.

## Who it serves FIRST

**Synthetics / forex retail traders (emerging-market-heavy, Deriv/MT5).** [Recommended]
Rationale: (1) highest harm — extreme leverage (1:500), B-book brokers that profit when
the user loses, RNG instruments sold as if readable; (2) most underserved — the
institutional risk tools don't even apply here, and *no honest tool exists*; (3) it's the
poverty-adjacent audience the charity exists for; (4) plausibly within the operator's
existing distribution reach. The institutional regime layer (VIX/GFC/gamma) serves the
*more advanced* user and comes later. The five `.ex5` indicators the operator already has
ARE what this audience uses — we analyse them honestly ("here's why this repaints, here's
the real risk") rather than build on them.

---

## How many aspects can we help in? — the risk taxonomy (~11 surfaces, 3 tiers)

### Tier 1 — kills accounts fastest, easiest to make visible, most differentiated (the v1)

| # | Risk surface | What we make visible |
|---|---|---|
| 1 | **Leverage & liquidation** | "You're at 1:500 — a 0.2% move against you wipes the account. Liquidation price is *here*, X pips away." |
| 2 | **Position size / risk-of-ruin** | "At this size, 6 losing trades = gone. Given your real win rate, that's ~X% likely *this month*." |
| 3 | **Behavioural patterns (from trade log)** | Martingale/size-up-after-loss, revenge-trading, overtrading, time-of-day tilt, cutting winners / holding losers — detected and named. |
| 4 | **True all-in cost** | spread + swap/overnight + commission + slippage: "You pay ~X% per round trip; you must be right ~Y% just to break even." |
| 5 | **Broker conflict (B-book)** | "On synthetics your broker is your counterparty — it profits when you lose. That is a structural conflict, not a conspiracy." |

### Tier 2 — real, slightly more advanced

| # | Risk surface | What we make visible |
|---|---|---|
| 6 | **Instrument-structure risk** | RNG spike skew on Boom/Crash: "Your drift-selling has negative skew — one spike erases a month. This is a random process with a *known* distribution, not a chart you can read." |
| 7 | **Correlation / concentration** | "Your 5 'diversified' positions are one bet (all USD / all the same vol factor)." |
| 8 | **Strategy-validity (falsification)** | Run the user's 'strategy' through the Aegis gate (deflated Sharpe, real costs, trial counter): "no edge net of cost — here's the receipt." Education by falsification. |

### Tier 3 — for wealth-builders / sophisticated users (the verified regime research)

| # | Risk surface | What we make visible |
|---|---|---|
| 9 | **Regime / macro fragility** | The verified protect-the-core flags: VIX/Global-Financial-Cycle state, dealer net-gamma sign, funding stress. "The system is fragile now; your leverage is dangerous *today*." |
| 10 | **Sequence-of-returns / leverage timing** | For those borrowing against a portfolio: don't be levered into a deleveraging cascade. |
| 11 | **Tax / cross-border** | CGT, wrapper efficiency, the US-situs estate trap (operator-specific + advanced users). |

---

## Phased build plan

### Phase 0 — Verified spine (NOW, $0, offline, visa-safe)
- Reuse the Aegis honest-stats core. Build deterministic risk calculators: leverage/
  liquidation, position-size & risk-of-ruin (Monte-Carlo over the user's own win-rate/RR),
  true-cost drag. All run on *hypothetical inputs* — no personal data, no broker access yet.
- Unit-tested, `deno check` clean. This is the thing we can start today.

### Phase 1 — The behavioural layer (the actual innovation)
- **Trade-log ingestion** — user pastes/uploads MT5/broker history (CSV). Read-only.
  *No order access, ever.* (Decision: CSV-paste first — zero broker integration, fastest.)
- **Pattern detection** — martingale sizing, revenge-trading, overtrading, time tilt,
  disposition effect — from the user's own history.
- **The Risk Report Card** — one visceral, personalised, *shareable* readout of what risk
  they're actually running.
- **Behaviour-change design** — friction/loss-framing at the decision moment. The hard part.

### Phase 2 — Honest scoreboard + literacy
- The REJECTED list / falsification lab (reuse the Aegis backtest engine).
- Instrument-structure truth: synthetics-RNG explainer, B-book conflict, true-cost calc.
- Honest analysis of the popular `.ex5` indicators (repaint detection, real risk profile).
- Education-by-falsification — feeds the creator/YGS distribution channel.

### Phase 3 — Distribution + the pay-it-forward loop
- **Free core, always** — harm reduction is not paywalled (and aligns with charity owner).
- **Shareable Report Cards** — "this showed me I was 1 trade from zero" → viral, social proof.
- **Peer accountability** — helped users flag risk for newcomers; mentorship loop.
- Measure *behaviour change*, not engagement.

### Phase 4 — Viability / endorsement evidence (the visa dossier)
- Track the only metric that matters: did users de-risk? (lower leverage, smaller
  drawdowns, fewer blow-ups, reduced overtrading).
- Testimonials + harm-reduction data → Innovator Founder endorsement package
  (innovation + viability + scalability, all evidenced).

---

## The pay-it-forward / distribution model

A user gets a Report Card that genuinely helps them → it's *built to be shared* (a stark,
honest one-screen summary) → social proof pulls in the next person → helped users become
flaggers/mentors for newcomers. Growth is the *harm-reduction itself* spreading, not a
referral bribe. Free to the vulnerable by design.

## The honest success metric (non-negotiable)

**Did users lose less / blow up less / de-risk?** If we ever find ourselves optimising
time-on-app or trade volume, we've become the thing we're fighting. Behaviour change is
both the mission metric AND the endorsement evidence.

## Open decisions (operator's call)

1. **Funding / sustainability** — free-to-vulnerable + charity-owned needs a money source.
   Grants? A "pro" tier for non-vulnerable/institutional users that cross-subsidises the
   free core? This is the one genuinely unresolved question and it's yours + legal/charity
   structure to settle.
2. **Audience-first** — confirm synthetics/forex retail as v1 (recommended) vs equities/options.
3. **Naming / brand** — "Risk X-Ray" is a placeholder.

## What reuses the existing Aegis substrate (research already paid for)
- Honest-stats core (deflated Sharpe / ruin / Monte-Carlo) → the risk calculators.
- Backtest + falsification engine → the strategy-validity lab + REJECTED list.
- The verified regime research ([R-001](../research/R-001-conditional-edge.md)) → Tier-3 fragility flags.
- Supabase + Deno substrate → the app backend; CC → the oversight cockpit.

## Invariants (unchanged — these protect the user AND the venture)
- No published buy/sell signals; no "we trade your money"; no passive-income promise.
- No LLM in any order path; no real money before the gates; signals single-operator.
- Free harm-reduction core is never paywalled.
