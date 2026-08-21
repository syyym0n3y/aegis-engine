# RESEARCH_GAPS.md — what Aegis has NOT tested, ranked honestly

> Written 2026-08-21 after the operator correctly challenged a premature "markets are efficient" conclusion. The prior
> position generalised from a NARROW test set with SHALLOW data. This file is the honest map of what remains — and how much
> of the gap is self-inflicted (data we never bothered to fetch) versus structural (capability we genuinely cannot buy).

## The correction that prompted this

Aegis had **5 fundamental concepts** loaded (Assets, Liabilities, Equity, NetIncome, Shares) while EDGAR's XBRL frames API
exposes **hundreds**. Entire documented factor families — accruals, cash-flow-to-price, gross profitability, net operating
assets, inventory/receivable growth — were never tested **because the data was never fetched**, then the absence of findings
was reported as evidence about markets. That is a research failure, not a market law. Closing it is D-406+.

## Tier 1 — SELF-INFLICTED gaps: free data we simply never loaded (highest priority)

| gap | what it unlocks | status |
|---|---|---|
| **Deep EDGAR concepts** (AssetsCurrent, LiabilitiesCurrent, Cash, Inventory, Receivables) | **ACCRUALS (Sloan 1996)** — among the most robust anomalies ever documented; net operating assets; working-capital dynamics | **LOADING (D-406)** |
| **13F institutional holdings** (EDGAR bulk, free) | institutional ownership + flow; crowding; smart-money concentration | not started |
| **Crypto on-chain data** (public blockchains, free) | exchange in/outflows, whale movements, active addresses, realised cap — genuinely non-price, and crypto is the least efficient market we can reach | not started |
| **Crypto funding rates / perp basis** (exchange APIs, free) | the documented crypto CARRY signal — distinct from the trend work already done | not started |
| **Options chains: IV surface, skew, term structure** (Nasdaq chains free; we used them only for GEX) | skew/term-structure signals, vol-of-vol, put-call ratios — a whole asset class of information | only GEX touched |
| **ETF flows / creation-redemption** | primary-market flow pressure | not started |
| **Analyst estimates** (the true PEAD driver) | D-393 used NetIncomeLoss as a weak SUE proxy; real estimate revisions are the documented signal | no free source identified |

## Tier 2 — METHOD gaps: things we can do with data already held

- **Machine learning / non-linear models.** Every test so far is a linear rank-IC or a decile sort. Gradient boosting on the
  existing factor panel is a genuinely different hypothesis class and has never been run.
- **Conditional / interaction models.** Signals were tested standalone; regime-conditioning was tried only crudely.
- **Longer horizons (6-24 months).** Almost everything was tested at 1-63 days. Slow-moving edges are exactly where retail can
  compete, because latency advantages do not apply.
- **Portfolio construction beyond decile sorts** — mean-variance, risk parity, Kelly-optimal blends of weak signals.
- **Cross-asset lead-lag** — does one asset's move predict another's, at horizons long enough to trade?

## Tier 3 — STRUCTURAL gaps: capability we genuinely cannot buy (be honest about these)

- **Colocation / microsecond latency** — the market-making tier. D-070 explicitly refuses this game; it is not a research gap,
  it is a capital-and-regulatory wall.
- **Prime-broker financing + securities lending** — short borrow at institutional rates; our short tests all carry retail
  borrow assumptions that may be too pessimistic (or too optimistic on availability).
- **Paid alt-data** (satellite, credit-card panels, web-scrape at scale) — where a large share of modern institutional alpha
  now lives. Costs 6-8 figures/yr.
- **Full survivorship-free history (CRSP/Compustat)** — D-386: our equity universe is currently-listed-only, so every equity
  number is an upper bound. This is the single biggest correctness gap and it is paid-only.

## The honest framing on "why are we behind Wall Street"

We do NOT have identical capability: colocation, financing, lending desks, and alt-data budgets are structurally unavailable.
But that argues for hunting **where those advantages do not apply** — longer horizons, less-covered assets (crypto,
micro-caps), and data nobody bothers to parse (filings text, on-chain) — NOT for concluding the market is closed. Every Tier-1
gap above is FREE and unexploited by us. Until Tier 1 is exhausted, any claim about market efficiency from this program is
premature.


---

## GAP STATUS as of 2026-08-21 (updated as they close)

| Tier-1 gap | status | outcome |
|---|---|---|
| Deep EDGAR concepts | **CLOSED** | 700,684 rows, 5 -> 10 concepts (D-406) |
| Accruals / NOA / working-capital | **CLOSED — tested** | real in-sample (t 2.51), **decays to zero OOS** (D-408) |
| Crypto funding / basis | **CLOSED — tested** | carry real (1.9%/yr, t 18); crowding signal DOWNGRADED, see below (D-409/410/411/414) |
| Options: VIX term structure | **CLOSED — tested** | backwardation pays MOST; contango-gating gives ZERO tail protection (D-412) |
| Volatility risk premium | **CLOSED — tested** | real (t 48.8) but paid for in a -83% day (D-404) |
| 13F institutional holdings | **BLOCKED — UNTESTED** | filings parse; **no free CUSIP->ticker map at scale** (D-413) |
| Options: full IV surface / skew | open | needs per-name chains at scale |
| Crypto on-chain | open | hosts allowlisted, not yet built |
| ETF flows | open | no free source identified |

### Tier-2 method gaps — still entirely open, and now the highest-value remaining work
Every test in this program is a **linear rank-IC or decile sort**. Untried: gradient boosting / non-linear models on the
existing panel, conditional & interaction models, **longer horizons (6-24 months, where retail latency disadvantage does not
apply)**, portfolio construction beyond decile sorts, cross-asset lead-lag. The data is already loaded for all of these.


## Tier-2 hunt log (2026-08-21)

### CLOSED — cross-asset lead-lag (D-417/418): **NULL**, coverage adequate
1,404 ordered pairs over 27 instruments x 6,519 common days. 286 pairs "survived OOS" at |t|>2 — and that number is exactly
what a scan over correlated series manufactures. Two artifact classes had to be filtered before anything could be read:
non-synchronous foreign closes (US -> ^N225, beta 0.51 t 40) and non-synchronous futures settlement (equity -> SI=F/GC=F,
COMEX 13:30 ET vs equity 16:00 ET). What remained was short-horizon reversal, and the **disagree-day test** — restricting to
the ~17-28% of days where "follow the lead" and "follow the asset's own prior move" predict OPPOSITE signs — showed a coin
flip (3 pairs favour lead, 2 favour own, every |t| < 1.25). No cross-asset information exists in this panel.
**Method now doctrine:** (a) multiple-testing bar sqrt(2 ln N), not 2; (b) exclude non-synchronous pairs BEFORE reading a
lead-lag result; (c) when a candidate signal is correlated with a known effect, find the observations where they DISAGREE —
that is the only clean separation.

### OPEN — remaining Tier-2
- **non-linear / conditional models** — IN PROGRESS (`scripts/nonlinear.ts`, D-419). Gradient-boosted trees vs linear
  baselines, strict walk-forward, on the monthly cross-sectional equity panel. Pre-registered null: if GBM does not beat the
  linear composite OOS on a paired t, non-linearity adds nothing to THIS panel.
- **portfolio construction beyond decile sorts** — mean-variance / risk-parity / turnover-constrained optimisation over the
  measured signals, rather than equal-weight top-decile.

### COVERAGE NOTE (raised by this hunt, unresolved)
`StockholdersEquity`, `Assets`, `Liabilities`, `NetIncomeLoss` in `trd_fundamentals` **stop at 2023-07**; only the 5
deep-loaded balance-sheet concepts run to 2026. Every value/quality/profitability conclusion in this program is therefore
measured on a panel that ENDS IN MID-2023. Under the COVERAGE LAW that is a stated limit on those verdicts, not a market
finding about 2024-2026. Refreshing those four concepts is a free EDGAR fetch and is now the top Tier-1 item.
