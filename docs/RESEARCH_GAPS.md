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
### CLOSED — non-linear / conditional models (D-419): **POSITIVE**, the first Tier-2 gap that was not a null
GBM beats the linear composite OOS by delta IC +0.0098 (paired t 2.13-2.49), and the delta is IDENTICAL on the loose and the
strict ($5 / $10M/day) universes — so it is signal linear rank-IC cannot represent, not a microcap artifact. **Every prior
null verdict in this program was measured with a method that leaves this much on the table.** Economics do NOT clear the bar:
16 consecutive years (2005-2020) are flat-to-negative net of cost, and the strong window (2021-2026, SR 1.42) is the one our
currently-listed universe measures least honestly. Methodological gap closed; nothing promoted.

### CLOSED — portfolio construction (D-421)
Conviction (score-proportional) weighting beats equal-weight decile at identical turnover: SR 0.35 -> 0.57. The no-trade band
FAILS — cutting turnover 40% costs more gross than it saves, proving the signal decays inside the month, which retires
turnover-reduction as a cost lever for month-horizon signals here.

### OPEN — Tier-2 remaining
- **conditional/interaction models with FUNDAMENTAL features** — D-419 used price/volume only. The fundamentals panel is now
  fresh to 2026-08 (D-420) and has never been run through a non-linear model.
### CLOSED — regime conditioning (D-422): **does not rescue D-419**
Dispersion (the natural hypothesis) is falsified — it INVERTS in both dead eras (-9.1%, -9.1%). Breadth looked promotable
pooled (SR 0.71, t 2.66, n=106) and turned out to be era selection: it revives 2005-2012 on only 20 months, leaves 2013-2020
dead, and puts 54 of its 106 months in 2021-2026. **New doctrine: a regime filter is only real if it revives the era where
the signal was dead. If it concentrates the months that already worked, it is fitting the calendar.**

### COVERAGE NOTE (raised by this hunt, unresolved)
`StockholdersEquity`, `Assets`, `Liabilities`, `NetIncomeLoss` in `trd_fundamentals` **stop at 2023-07**; only the 5
deep-loaded balance-sheet concepts run to 2026. Every value/quality/profitability conclusion in this program is therefore
measured on a panel that ENDS IN MID-2023. Under the COVERAGE LAW that is a stated limit on those verdicts, not a market
finding about 2024-2026. Refreshing those four concepts is a free EDGAR fetch and is now the top Tier-1 item.


## Method upgrades banked this session (these change every FUTURE verdict)

1. **Test non-linearly.** A linear rank-IC of ~0 does not license a null — GBM found +0.0098 IC that linear cannot represent,
   robustly across universes (D-419). Every prior null in this program was measured with the weaker instrument.
2. **Weight by conviction, not equally.** +0.22 Sharpe for free, at identical turnover (D-421).
3. **Do not reach for turnover reduction.** For month-horizon signals here it costs more gross than it saves (D-421).
4. **Multiple-testing bar is sqrt(2 ln N), not 2** — and OOS survival is NOT proof when the candidates are correlated
   (D-417: 286 of 1,404 pairs "survived OOS" and all were artifacts).
5. **Exclude non-synchronous pairs before reading any lead-lag** (foreign closes, futures settlement) (D-418).
6. **When a candidate correlates with a known effect, find the days they DISAGREE** — the only clean separation (D-418).
7. **A regime filter must revive the dead era**, not concentrate the live one (D-422).
8. **Coverage has a recency dimension.** Breadth alone let a 3-year-stale panel pass as green (D-420).
