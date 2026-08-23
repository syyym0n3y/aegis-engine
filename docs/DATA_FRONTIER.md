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
| **FINRA daily short-sale volume** (per symbol, every trading day) | ~2011–2026 | D-391 ruled short interest "underpowered, 26 settlements" **without fetching this** — my own Coverage Law, violated by me | **ingesting (~3,900 files)** |
| **FINRA consolidated short interest API** (per symbol, semi-monthly, days-to-cover) | ≥2020– | same neglect | **ingesting** |
| **CBOE index histories**: SKEW (1990–!), VVIX, VIX9D/3M/6M, VXN, RVX, GVZ, OVX, VXAPL | 1990–2026 | I built a *collector* for live chains and never took the published decades of history one directory over | **LANDED: 48,127 rows verified** |
| **Nasdaq per-symbol short interest** (allowlisted host) | rolling | never probed | probed live; redundant with FINRA SI — noted |
| **Ken French library breadth** | 1926– | took 2 files of ~100; daily versions, 5×5s, OP/INV sorts, ST/LT reversal portfolios, international — all untaken | partially landed (174k obs); remainder OPEN |

## KNOWN-UNEXPLORED (open list — NOT claimed complete)
- **Dukascopy tick data** (FX + indices + commodities, allowlisted): "deferred" in v1 of this file was a euphemism for skipped. Opens the intraday-equities/overnight-decomposition family. OPEN.
- **Yahoo global breadth**: universe held is 4,184 US equities + thin non-equity; Yahoo serves global equities, sovereign yields, full FX crosses, wider commodities. OPEN.
- **SEC N-PORT** fund holdings (free XML, name-keyed). OPEN.
- **Binance futures sentiment** (`/futures/data/*`: long-short ratios, taker ratios, OI history) — blocked by the allowlist's VERB list, not the host. Operator one-liner extends it.
- **Held-but-never-swept**: `trd_insider` (278k Form-4 events) never entered the factory; `ftd_stress` entered as ONE spec whose per-month coverage was never verified; seasonality/weekly-frequency/overnight families absent from the sweep.

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
