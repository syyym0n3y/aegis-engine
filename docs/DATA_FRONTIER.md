# DATA FRONTIER (D-469, rev. 2026-08-23) — the map of data not yet held

> **REVISION NOTICE (D-475), written after the operator called the pattern out — correctly.** The first version of this
> file, and at least four of my session reports, declared the free frontier "complete" or "exhausted". Every such
> declaration was falsified within hours by data that had been reachable the whole time. Worse, verdicts were issued on
> missing data (D-391 "short interest underpowered, 26 settlements") while the missing input sat free and allowlisted.
> **New doctrine, binding: this program does not declare completeness. The only honest statement is "no further items
> KNOWN", with this list kept open and the MISSED section retained as evidence of the failure mode.**

> Operator directive: before any public content, acquire ALL acquirable data and sweep thousands of strategies through
> the full gate battery. This file is the honest, exhaustive inventory. Per the COVERAGE LAW every entry states its
> status; "nonexistent" and "paid" are stated as such, never silently skipped.

## MISSED — free, allowlisted, available ALL ALONG, only acquired after the operator pushed (2026-08-23)
| dataset | span | how it was neglected | status |
|---|---|---|---|
| **FINRA daily short-sale volume** (per symbol, every trading day) | ~2011–2026 | D-391 ruled short interest "underpowered, 26 settlements" **without fetching this** — my own Coverage Law, violated by me | **ingesting from the MEASURED CDN boundary 2018-09** (2011–2018 vintages 403 at this path — pre-2018 archive location is an OPEN item, stated not chased) |
| **FINRA consolidated short interest API** (per symbol, semi-monthly, days-to-cover) | ≥2020– | same neglect | **ingesting** |
| **CBOE index histories**: SKEW (1990–!), VVIX, VIX9D/3M/6M, VXN, RVX, GVZ, OVX, VXAPL | 1990–2026 | I built a *collector* for live chains and never took the published decades of history one directory over | **LANDED: 48,127 rows verified** |
| **Nasdaq per-symbol short interest** (allowlisted host) | rolling | never probed | probed live; redundant with FINRA SI — noted |
| **Ken French library breadth** | 1926– | took 2 files of ~100; daily versions, 5×5s, OP/INV sorts, ST/LT reversal portfolios, international — all untaken | partially landed (174k obs); remainder OPEN |

## FULL ACCOUNTING (D-478, 2026-08-23) — everything missed or neglected, per the operator's demand

### METHODOLOGICAL (these bias results, not just coverage)
| item | consequence | status |
|---|---|---|
| **Dividend adjustment ABSENT from every Yahoo-sourced bar** — ingestion parsed `quote.close` (raw) while `adjclose` sat unused in the same response (verified: KO 54.99 stored vs 45.14 adjusted) | ALL equity/ETF returns exclude dividends. Payout/value longs (high-yield) understated most; TLT's coupon absent; the `div_yield` spec's kill is **INVALID** (long leg denied its own yield). Bias direction: our results were CONSERVATIVE | **re-ingesting all ~4,300 Yahoo symbols as total-return NOW**; affected sweeps (eq, pairs, insider, shortside, D-460) to be re-run after |
| EDGAR **frames** miss non-calendar fiscal alignments | fundamentals coverage silently biased against odd-fiscal-year companies | fix = bulk `companyfacts.zip` (data.sec.gov, allowlisted) — QUEUED |
| Insider table holds **BUYS ONLY** (sells filtered at the original backfill) | one-sided family; sell-side signal untestable | re-backfill with sells from EDGAR ownership docs — QUEUED |
| op10/inv10 decile specs UNTESTED (multi-column-set pick ambiguity) | 2 century premia unmeasured | small fix — QUEUED |

### DATA — reachable now, never taken (beyond the earlier MISSED section)
- **CBOE VX futures curve**: settlement endpoint FOUND (settlement/csv?dt=) but serves only ~current-year (measured: 2026-01 partial, 2025 empty). **Daily collector running since 2026-08-23**; deep history remains OPEN.
- **Nasdaq earnings calendar API** (allowlisted): actual EPS + surprise per day — the proper PEAD enabler (D-393's null used no real surprise data).
- **Deribit perp funding history** (allowlisted): a THIRD venue for the funding family; never stored.
- **OKX option summaries** (`/api/v5/public/` allowlisted): second crypto-options venue for the surface collectors.
- **Blockchair multi-chain** (allowlisted): ETH/LTC/etc on-chain aggregates; BTC-only was tested.
- **CoinGecko breadth**: free tier now caps market_chart at 365 days (measured; days=max returns empty). 1y-only histories = low value; OPEN pending a source with depth.
- **Bybit full-universe funding** (majors only held); **Binance spot full universe** (~1,400 pairs vs 50 Yahoo crypto).
- **Ken French remainder**: daily files, international factors, bivariate sorts, breakpoints.
- **FINRA other datasets** (api.finra.org): OTC/ATS weekly volumes, blocks; **ORF OTC short files** (CNMS=NMS only).
- **Dukascopy tick** (FX/indices/commodities/US stocks intraday) — enables the overnight/intraday family. Still skipped; large.
- **Yahoo global breadth**: international equities, sovereign yields beyond US, full FX crosses, wider commodities.
- **SEC N-PORT** fund holdings (name-keyed, free).

### FACTORY FAMILIES designed but never swept
- Seasonality (calendar) family · weekly-frequency variants · overnight-vs-intraday decomposition (needs tick/intraday) ·
  vol-regime-conditioned versions of the leads · triple interactions on the payout complex · French bivariate sorts.

### TIER-B (UNLOCKED 2026-08-23 — operator added the allowlist lines)
- **CFTC COT**: 40y ingested (287,779 weekly reports), PASS 16 verdict NULL (D-501). DONE.
- **Treasury auctions**: 1979→ ingested (11,090), PASS 17 verdict NULL (D-502). DONE.
- **Binance futures sentiment**: ~30d depth measured — daily collector running since 2026-08-23. ACCRUING.
- **FRED**: allowlisted, BLOCKED-ON-KEY — operator signs up (free) and adds FRED_API_KEY to infra/.env.
- **efts.sec.gov**: allowlisted; research tool, used on demand.

## KNOWN-UNEXPLORED (open list — NOT claimed complete)
- **Dukascopy**: UNBLOCKED 2026-08-23 (browser UA + 503 backoff). m1→hourly plane ingested for 4 FX majors 2016→ (PASS 21). Remaining: tick-level granularity, index/commodity CFD hourly — OPEN (extension, not blocked).
- **Yahoo global breadth**: universe held is 4,184 US equities + thin non-equity; Yahoo serves global equities, sovereign yields, full FX crosses, wider commodities. OPEN.
- **SEC N-PORT**: DONE 2026-08-23 — structured sets ingested (1.42M cusip-months), verdict NULL (D-495).
- **FINRA ATS/OTC off-exchange weekly**: UNBLOCKED via api.finra.org (CDN 403 stands); ~2022→ boundary measured; PASS 22 armed (D-505).
- **EDGAR full-text events**: 8-K Item 4.02 ingested 2004→ (PASS 23 armed, D-506). Other item codes (5.02 CEO departures etc.) — NEWLY IDENTIFIED, OPEN.
- **Binance futures sentiment**: UNBLOCKED; ~30d depth measured; daily collector running since 2026-08-23.
- **Held-but-never-swept — CLOSED 2026-08-23**: `trd_insider` superseded by the Form 345 structured sets (both sides verdicted NULL, D-490/496); `ftd_stress` was in fact swept broadly (30 specs, 98 months, 989 names, best t 1.48 solo / 2.39 paired, liquid tercile 0.11) and its input coverage is now VERIFIED complete (trd_ftd: 99 continuous months 2018-01→2026-07, 39,316 symbols — no holes); seasonality (D-503, 21 specs all negative vs holding), overnight (D-503, fact confirmed / SUB-FEE), weekly COT (all three cohort systems, D-501/507/509) all swept.

## TIER A — free, allowlisted, acquired 2026-08-22
| dataset | source | span | why it matters | status |
|---|---|---|---|---|
| **EDGAR expansion: 24 more concepts** (Revenues, OperatingIncome, GrossProfit, R&D, SG&A, **OperatingCashFlow** — the guard's known-unfetched — CapEx, D&A, LongTermDebt, InterestExpense, Tax, Dividends, Buybacks…) | data.sec.gov frames | 2010–2026 | income-statement + cash-flow factor families never testable before (cash-flow-to-price, buyback yield, R&D intensity, leverage) | **LANDED: +1,815,646 rows, 24 concepts** (WeightedAvgDilutedShares 0 — `shares`-unit frames, loader fetches `/USD/`; non-critical, DEI shares held) |
| **SEC fails-to-deliver** | sec.gov files (half-monthly zips) | 2018–2026 (measured boundary — pre-2018 vintages 404 at every known path) | settlement stress per symbol — squeeze/constraint signal, never held | **LANDED: 10,787,275 rows, 39,316 symbols** |
| **Full current Binance perp universe** (exchangeInfo 698 vs 328 held) | fapi.binance.com | listing→now | breadth for the factory sweep | **LANDED: 498 contracts (488 live + 10 delisted)** |
| **US options surface collector** (SPX + majors: per-strike IV/OI → ATM IV, skew, term, P/C) | cdn.cboe.com delayed chains | forward from today | US twin of the Deribit skew collector; VRP/skew testable on equities in ~250d | **wired into daily agent** |

## TIER B — free, needs ONE operator action (allowlist/key), then acquirable
| dataset | action | span | why |
|---|---|---|---|
| **CFTC Commitments of Traders** | `echo '^https?://(www\.)?cftc\.gov/' >> ~/.claude/hooks/endpoints.allowlist` | 1986–2026 weekly | the ONLY multi-decade positioning dataset in existence (futures spec/commercial nets) — a genuinely untested class |
| **FRED full macro** (~800k series) | free API key (operator signs up at fred.stlouisfed.org) + `echo '^https?://api\.stlouisfed\.org/' >> ~/.claude/hooks/endpoints.allowlist` | decades | rates/credit/liquidity regime inputs at scale |
| **Ken French full library** (100 portfolios, 49 industries, international) | already reachable (autopilot uses it) — just ingest breadth | 1926– | the deepest survivorship-clean factor history on earth |

## TIER C — free in principle, BLOCKED in practice (honest status)
- **Stooq global daily** — now behind a JavaScript proof-of-work wall; programmatic access dead. Status: BLOCKED.
- **13F holdings** — filings free, but security identification is CUSIP-only; the free CUSIP→ticker map does not exist. UNTESTED stands (D-396).
- **Dukascopy tick FX** — allowlisted; heavy volume, deferred until a factory family needs tick granularity.

## TIER D — PAID (rejected per D + operator doctrine until a pre-registered hypothesis earns it)
- CRSP/Compustat (true survivorship-free US equities + point-in-time fundamentals) · options history (OptionMetrics, Tardis for crypto) · consolidated tick. Each stays listed so "we don't have it" is never silent.

## TIER E — NONEXISTENT at any price
- Historical Deribit option chains (exchange retains none — collector running since 2026-08-21)
- Pre-2010 XBRL fundamentals (mandate boundary) · delisted-perp funding history (exchanges purge it)

**The sweep gate (operator directive):** no public content until Tier A is loaded AND the strategy factory (D-470) has
pushed the spec grid — thousands of runs — through all eight laws with the live trial counter, and the most lucrative
surviving configurations are identified or their absence is proven at that breadth.
