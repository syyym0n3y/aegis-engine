# DATA FRONTIER (D-469, 2026-08-22) — the COMPLETE map of data not yet held

> Operator directive: before any public content, acquire ALL acquirable data and sweep thousands of strategies through
> the full gate battery. This file is the honest, exhaustive inventory. Per the COVERAGE LAW every entry states its
> status; "nonexistent" and "paid" are stated as such, never silently skipped.

## TIER A — free, allowlisted, ACQUIRING NOW (launched this session)
| dataset | source | span | why it matters | status |
|---|---|---|---|---|
| **EDGAR expansion: 24 more concepts** (Revenues, OperatingIncome, GrossProfit, R&D, SG&A, **OperatingCashFlow** — the guard's known-unfetched — CapEx, D&A, LongTermDebt, InterestExpense, Tax, Dividends, Buybacks…) | data.sec.gov frames | 2010–2026 | income-statement + cash-flow factor families never testable before (cash-flow-to-price, buyback yield, R&D intensity, leverage) | **ingesting** |
| **SEC fails-to-deliver** | sec.gov files (half-monthly zips) | 2004–2026 | settlement stress per symbol — squeeze/constraint signal, never held | **ingesting** |
| **Full current Binance perp universe** (exchangeInfo 698 vs 328 held) | fapi.binance.com | listing→now | breadth for the factory sweep | **ingesting** |
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
