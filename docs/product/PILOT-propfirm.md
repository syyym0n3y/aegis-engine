# PILOT SPEC — Prop-firm wedge ("Edge Verification & Risk Monitoring")

> The first monetising deployment of the Verify/Protect engines
> ([`trd-verify.ts`](../../supabase/functions/_shared/trd-verify.ts),
> [`trd-protect.ts`](../../supabase/functions/_shared/trd-protect.ts)), live as
> `trd-api-verify` / `trd-api-protect`. B2B, high-ARPU, **no Investment-Adviser
> licence needed** (we sell analytics on the firm's own data, not advice or signals).

## Why prop firms first

The modern prop-firm ("funded trader") model is a two-sided market drowning in exactly
the problem our engine solves:
- **The firm's core risk:** it funds traders who *passed a challenge*, but a challenge is
  a small sample — most "passers" were **lucky, not skilled**, and blow up the firm's
  capital. The firm cannot currently tell skill from luck rigorously.
- **The trader's core risk:** they pay eval fees on **overfit strategies** that can't
  actually pass live, and they blow accounts by **overbetting**.

Both are the same question — *is this edge real, and is this risk survivable?* — which is
literally `verifyTrackRecord()` + `riskXray()`.

## The product (two SKUs, one engine)

### SKU 1 — Applicant Edge Score (sell to the FIRM)
For every trader applying to be funded (or up for a scaling decision), ingest their trade
history and return:
- **Authenticity Score (0–100)** + verdict (LIKELY REAL / UNPROVEN / OVERFIT-LUCK) from
  Deflated-Sharpe (deflated by the trader's likely search), PSR, and MinTRL.
- **Selection-overfit (PBO)** if they submitted multiple systems — did they just pick
  their luckiest?
- **Ruin projection** at the firm's risk limits — probability this trader breaches the
  drawdown rule in 12 months (Monte-Carlo).
- Plain-English one-pager the risk desk can act on.
**Value to firm:** fund fewer blow-ups → directly protects their capital. Priced per
evaluation or as a monthly seat for the risk desk.

### SKU 2 — "Will I Pass?" pre-check (sell to the TRADER, via the firm or direct)
Before a trader pays an eval fee, they run their strategy through VERIFY + PROTECT:
- "Your backtest is overfit — deflated for the ~200 variations you tried, the edge is
  luck. Don't waste the eval fee." (This has *integrity*: we reduce fees they'd lose.)
- "Real-ish edge, but you're overbetting 3× — at this size you have a 77% chance of
  hitting the drawdown limit. Here's the size that passes."
**Value to trader:** stop wasting eval fees + stop self-sabotaging. Freemium → subscription.

## Integration (low-lift for the firm)

- **Input:** a CSV / API push of a trader's closed trades (timestamp, P&L or R-multiple).
  We derive the return series + win-rate + payoff ratio.
- **Call:** `POST /trd-api-verify { returns, periodsPerYear, claimedTrials }` and
  `POST /trd-api-protect { winRate, winLossRatio, riskPerTradeFrac, ... }`.
- **Output:** JSON report (already live, CORS-enabled) + a rendered PDF/one-pager.
- **Deploy modes:** hosted API (we run it) or on-prem/VPC (they run the container) for
  firms sensitive about trader data.

## Pricing (hypotheses to test in the pilot)

| SKU | Model | Anchor |
|---|---|---|
| Applicant Edge Score | $X per evaluation OR $Y/mo risk-desk seat | Cheaper than one funded blow-up (their blow-ups cost $k–$10k+ each) |
| "Will I Pass?" pre-check | Freemium → $Z/mo trader sub | Cheaper than one wasted eval fee (~$100–$500) |

## Pilot structure (8 weeks, 1–2 design-partner firms)

1. **Wk 1–2:** ingest one firm's *historical* funded-trader outcomes. Back-test our
   Authenticity Score: **do low-score traders blow up more than high-score?** This is the
   proof-of-value — and it's just our engine on their labelled data. (If it doesn't
   predict blow-ups, we learned that cheaply and honestly.)
2. **Wk 3–4:** wire the live API into their applicant flow (shadow mode — score, don't
   gate).
3. **Wk 5–8:** compare scored-vs-actual on new applicants; quantify capital saved; convert
   to paid.

**Success metric:** Authenticity Score is monotonically related to realised blow-up rate
on the firm's own history (AUC / lift). That's a falsifiable, honest pilot — same
discipline as the whole engine.

## Guardrails (unchanged)

- We provide **analytics on the firm's/trader's own numbers** — no market predictions, no
  buy/sell signals, no performance promises. Clear of IA registration.
- We never claim a trader *will* be profitable — only whether their record is
  statistically distinguishable from luck, and how survivable their sizing is.
- Trader data handled per the firm's DPA; on-prem option for the sensitive.

## What's ready now vs to build

- **Ready:** both engines, live APIs, tested (85/85). A pilot can start on historical data
  with the current endpoints.
- **To build for pilot:** a CSV→returns adapter, the PDF one-pager renderer, and a thin
  auth/billing layer (the APIs are currently open for demo; production needs per-firm keys).
